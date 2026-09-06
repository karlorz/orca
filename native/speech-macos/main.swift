import Foundation
import Speech
import AVFoundation

// Ensure unbuffered standard output so JSON lines flush immediately
setbuf(stdout, nil)

func emitJson(_ dict: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
     let str = String(data: data, encoding: .utf8) {
    print(str)
    fflush(stdout)
  }
}

func logDebug(_ msg: String) {
  fputs("[orca-speech] \(msg)\n", stderr)
  fflush(stderr)
}

// 1. Locale resolution
// Try com.apple.speech.recognition.AppleSpeechRecognition.prefs:
// DictationIMLocaleIdentifier -> DictationIMNetworkBasedLocaleIdentifier -> DictationIMPreferredLanguageIdentifiers.first
// Else fallback to Locale.current
func resolveAddsPunctuation() -> (enabled: Bool, source: String) {
  let domain = "com.apple.assistant.support" as CFString
  let key = "Dictation Auto Punctuation Enabled" as CFString
  if let flag = CFPreferencesCopyAppValue(key, domain) as? Bool {
    return (flag, "assistant-support")
  }
  if let number = CFPreferencesCopyAppValue(key, domain) as? NSNumber {
    return (number.boolValue, "assistant-support")
  }
  // Why: System Settings default is on; fail open to that rather than stripping
  // punctuation when the undocumented key is missing.
  return (true, "default-on")
}

func resolveDictationLocale() -> (locale: Locale, source: String, identifier: String)? {
  let supported = SFSpeechRecognizer.supportedLocales()

  func findSupported(identifier: String) -> Locale? {
    let normalized = identifier.replacingOccurrences(of: "_", with: "-")
    if let exact = supported.first(where: {
      $0.identifier.caseInsensitiveCompare(normalized) == .orderedSame ||
      $0.identifier.caseInsensitiveCompare(identifier) == .orderedSame
    }) {
      return exact
    }
    let loc = Locale(identifier: normalized)
    if supported.contains(loc) {
      return loc
    }
    return nil
  }

  let prefsDomain = "com.apple.speech.recognition.AppleSpeechRecognition.prefs" as CFString
  var candidateId: String?
  var source = "dictation-prefs"

  if let val = CFPreferencesCopyAppValue("DictationIMLocaleIdentifier" as CFString, prefsDomain) as? String, !val.isEmpty {
    candidateId = val
  } else if let val = CFPreferencesCopyAppValue("DictationIMNetworkBasedLocaleIdentifier" as CFString, prefsDomain) as? String, !val.isEmpty {
    candidateId = val
  } else if let arr = CFPreferencesCopyAppValue("DictationIMPreferredLanguageIdentifiers" as CFString, prefsDomain) as? [String], let first = arr.first, !first.isEmpty {
    candidateId = first
  }

  if candidateId == nil {
    candidateId = Locale.current.identifier
    source = "system-fallback"
  }

  guard let chosenId = candidateId else {
    emitJson(["type": "error", "error": "apple_speech_locale_unsupported:unknown"])
    exit(1)
  }

  if let matched = findSupported(identifier: chosenId) {
    return (matched, source, chosenId)
  }

  // Not supported by SFSpeechRecognizer: fail closed
  emitJson(["type": "error", "error": "apple_speech_locale_unsupported:\(chosenId)"])
  exit(1)
}

// 2. Perform Handshake: Read first line from stdin for {"sampleRate": 16000}
func readHandshake() -> Int {
  let handle = FileHandle.standardInput
  var lineData = Data()
  while true {
    let byteData = handle.readData(ofLength: 1)
    if byteData.isEmpty {
      break
    }
    if byteData[0] == 0x0A {
      break
    }
    lineData.append(byteData)
  }

  if !lineData.isEmpty,
     let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
     let rate = json["sampleRate"] as? Int {
    return rate
  }
  return 16000
}

let sampleRate = readHandshake()

guard let resolved = resolveDictationLocale() else {
  emitJson(["type": "error", "error": "apple_speech_locale_unsupported:unknown"])
  exit(1)
}

// Log locale and source as per protocol:
// {type: "locale", locale: "<locale>", source: "dictation-prefs" | "system-fallback"}
emitJson(["type": "locale", "locale": resolved.locale.identifier, "source": resolved.source])
let punctuation = resolveAddsPunctuation()
emitJson([
  "type": "config",
  "addsPunctuation": punctuation.enabled,
  "source": punctuation.source
])

guard let recognizer = SFSpeechRecognizer(locale: resolved.locale), recognizer.isAvailable else {
  emitJson(["type": "error", "error": "apple_speech_locale_unsupported:\(resolved.identifier)"])
  exit(1)
}

func isCjkScalar(_ scalar: Unicode.Scalar) -> Bool {
  switch scalar.value {
  case 0x3040...0x30FF,        // Hiragana + Katakana
       0x3400...0x4DBF,        // Han extension A
       0x4E00...0x9FFF,        // Han
       0xF900...0xFAFF,        // Han compatibility
       0x20000...0x2FA1F,      // Han extensions B+
       0xAC00...0xD7AF,        // Hangul syllables
       0x3000...0x303F,        // CJK punctuation
       0xFF00...0xFFEF:        // fullwidth forms
    return true
  default:
    return false
  }
}

// Join the carried roll prefix with newly recognized text. Latin gets a
// separating space; CJK boundaries (the Cantonese path) must not.
func joinWithPrefix(_ prefix: String, _ recognized: String) -> String {
  if prefix.isEmpty { return recognized }
  if recognized.isEmpty { return prefix }
  guard let last = prefix.unicodeScalars.last, let first = recognized.unicodeScalars.first else {
    return prefix + recognized
  }
  if CharacterSet.whitespaces.contains(last) || CharacterSet.whitespaces.contains(first) {
    return prefix + recognized
  }
  if isCjkScalar(last) || isCjkScalar(first) {
    return prefix + recognized
  }
  return prefix + " " + recognized
}

// Session model:
// - A dictation run is ONE helper process that stays alive until stdin closes.
// - An Apple endpoint pause (isFinal) is a SEGMENT boundary: emit `final`,
//   reset state, re-arm a new recognition request, keep listening.
// - The 50s rolling re-arm (Apple ~1min server request limit) is invisible:
//   its isFinal emits nothing; the finalized text is carried as a prefix so
//   partials keep showing the whole in-progress utterance.
// - Only stdin EOF (user stop) or a fatal error ends the process.
class SpeechCoordinator {
  private let recognizer: SFSpeechRecognizer
  private let sampleRate: Double
  private let audioFormat: AVAudioFormat
  private let addsPunctuation: Bool

  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  // Text finalized by 50s rolls, carried within the current segment.
  private var currentPrefix = ""
  // Latest full text (prefix + recognized) for the active segment.
  private var lastPartialText = ""
  private var requestGeneration = 0
  private var rollingFromGeneration: Int?
  private var rearmTimer: DispatchSourceTimer?
  private var rollTimeoutTimer: DispatchSourceTimer?
  private var stopFlushTimer: DispatchSourceTimer?
  // Audio arriving during the roll/pause re-arm seam, replayed after arming.
  private var pendingAudio: [Data] = []
  private var pendingAudioBytes = 0
  // 10 seconds of float32 mono at the handshake rate.
  private let maxPendingAudioBytes: Int
  private let queue = DispatchQueue(label: "com.stablyai.orca.speech-coordinator")
  private var isStopped = false
  private var stopCompleted = false

  init(recognizer: SFSpeechRecognizer, sampleRate: Double, addsPunctuation: Bool) {
    self.recognizer = recognizer
    self.sampleRate = sampleRate
    self.addsPunctuation = addsPunctuation
    self.audioFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    self.maxPendingAudioBytes = Int(sampleRate) * MemoryLayout<Float>.size * 10
  }

  func start() {
    queue.async {
      self.armRequest()
      emitJson(["type": "ready"])
    }
  }

  private func armRequest() {
    guard !isStopped else { return }

    rearmTimer?.cancel()
    rearmTimer = nil
    rollTimeoutTimer?.cancel()
    rollTimeoutTimer = nil

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    if #available(macOS 13.0, *) {
      request.addsPunctuation = addsPunctuation
    }
    recognitionRequest = request

    let prefix = currentPrefix
    requestGeneration += 1
    let generation = requestGeneration

    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self = self else { return }
      self.queue.async {
        if let error = error as NSError? {
          self.handleRecognitionError(generation: generation, error: error)
          return
        }
        guard let result = result else { return }
        let recognized = result.bestTranscription.formattedString
        let fullText = joinWithPrefix(prefix, recognized)
        if result.isFinal {
          self.handleFinal(generation: generation, fullText: fullText)
        } else if generation == self.requestGeneration {
          self.lastPartialText = fullText
          if !self.isStopped {
            emitJson(["type": "partial", "text": fullText])
          }
        }
      }
    }

    flushPendingAudio()

    // Schedule rolling re-arm at 50 seconds (before Apple's ~60s cloud limit).
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 50.0)
    timer.setEventHandler { [weak self] in
      self?.rollRequest()
    }
    timer.resume()
    rearmTimer = timer
  }

  private func handleFinal(generation: Int, fullText: String) {
    if generation == rollingFromGeneration {
      // 50s re-arm: not a user pause. Carry the finalized text as the prefix
      // and keep the same segment going. Nothing is emitted.
      rollingFromGeneration = nil
      currentPrefix = fullText
      lastPartialText = fullText
      if isStopped {
        completeStop(with: fullText)
        return
      }
      armRequest()
      return
    }
    if isStopped {
      completeStop(with: fullText)
      return
    }
    if generation != requestGeneration {
      // Stale final from a generation the roll timeout already replaced.
      return
    }
    // Genuine endpoint pause: commit the segment, keep listening.
    if !fullText.isEmpty {
      emitJson(["type": "final", "text": fullText])
    }
    currentPrefix = ""
    lastPartialText = ""
    armRequest()
  }

  private func handleRecognitionError(generation: Int, error: NSError) {
    if isStopped {
      if generation == requestGeneration || generation == rollingFromGeneration {
        completeStop(with: nil)
      }
      return
    }
    if generation == rollingFromGeneration {
      // The rolling window ended in an error (e.g. silence): keep the best
      // known text as the prefix and continue the segment.
      rollingFromGeneration = nil
      currentPrefix = lastPartialText
      armRequest()
      return
    }
    if generation != requestGeneration {
      return
    }
    let isCancelled = (error.domain == "kAFAssistantErrorDomain" && error.code == 216)
      || (error.domain == "kLSRErrorDomain" && error.code == 201)
    let isNoSpeech = error.domain == "kAFAssistantErrorDomain" && (error.code == 203 || error.code == 1110)
    if isCancelled || isNoSpeech {
      // Silence or a benign request end: commit anything we heard, keep listening.
      if !lastPartialText.isEmpty {
        emitJson(["type": "final", "text": lastPartialText])
      }
      currentPrefix = ""
      lastPartialText = ""
      armRequest()
      return
    }
    emitJson(["type": "error", "error": error.localizedDescription])
    exit(1)
  }

  private func rollRequest() {
    guard !isStopped, recognitionRequest != nil else { return }
    logDebug("Rolling recognition request re-arm")
    rollingFromGeneration = requestGeneration
    recognitionRequest?.endAudio()
    // Buffer audio during the seam; the rolling final's text becomes the prefix.
    recognitionRequest = nil

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 2.0)
    timer.setEventHandler { [weak self] in
      guard let self = self, !self.isStopped, self.rollingFromGeneration != nil else { return }
      logDebug("Roll final timed out; carrying last partial as prefix")
      self.rollingFromGeneration = nil
      self.currentPrefix = self.lastPartialText
      self.armRequest()
    }
    timer.resume()
    rollTimeoutTimer = timer
  }

  func feedAudio(data: Data) {
    queue.async {
      guard !self.isStopped else { return }
      guard let request = self.recognitionRequest else {
        self.stashPendingAudio(data)
        return
      }
      if let buffer = self.makePcmBuffer(from: data) {
        request.append(buffer)
      }
    }
  }

  private func stashPendingAudio(_ data: Data) {
    pendingAudio.append(data)
    pendingAudioBytes += data.count
    while pendingAudioBytes > maxPendingAudioBytes, !pendingAudio.isEmpty {
      let dropped = pendingAudio.removeFirst()
      pendingAudioBytes -= dropped.count
    }
  }

  private func flushPendingAudio() {
    guard let request = recognitionRequest, !pendingAudio.isEmpty else { return }
    for data in pendingAudio {
      if let buffer = makePcmBuffer(from: data) {
        request.append(buffer)
      }
    }
    pendingAudio.removeAll()
    pendingAudioBytes = 0
  }

  private func makePcmBuffer(from data: Data) -> AVAudioPCMBuffer? {
    let frameCount = UInt32(data.count / MemoryLayout<Float>.size)
    guard frameCount > 0,
          let pcmBuffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: frameCount) else {
      return nil
    }
    pcmBuffer.frameLength = frameCount
    data.withUnsafeBytes { raw in
      if let base = raw.baseAddress?.assumingMemoryBound(to: Float.self),
         let channel = pcmBuffer.floatChannelData?[0] {
        channel.initialize(from: base, count: Int(frameCount))
      }
    }
    return pcmBuffer
  }

  func stop() {
    queue.async {
      guard !self.isStopped else { return }
      self.isStopped = true
      self.rearmTimer?.cancel()
      self.rearmTimer = nil
      self.rollTimeoutTimer?.cancel()
      self.rollTimeoutTimer = nil
      if let request = self.recognitionRequest {
        request.endAudio()
        self.recognitionTask?.finish()
      }
      // Why: Apple emits isFinal asynchronously after endAudio(); exiting
      // immediately dropped the last partial and made desktop dictation toast
      // "No speech detected." SuperCmd waits 2s for the same flush.
      let timer = DispatchSource.makeTimerSource(queue: self.queue)
      timer.schedule(deadline: .now() + 2.0)
      timer.setEventHandler { [weak self] in
        self?.completeStop(with: nil)
      }
      timer.resume()
      self.stopFlushTimer = timer
    }
  }

  private func completeStop(with finalText: String?) {
    guard !stopCompleted else { return }
    stopCompleted = true
    let text = (finalText?.isEmpty == false) ? finalText! : lastPartialText
    if !text.isEmpty {
      emitJson(["type": "final", "text": text])
    }
    finishAndExit()
  }

  private func finishAndExit() {
    stopFlushTimer?.cancel()
    stopFlushTimer = nil
    recognitionTask = nil
    recognitionRequest = nil
    exit(0)
  }
}

let coordinator = SpeechCoordinator(
  recognizer: recognizer,
  sampleRate: Double(sampleRate),
  addsPunctuation: punctuation.enabled
)
coordinator.start()

// Background thread to read binary Float32 PCM from stdin
DispatchQueue.global(qos: .userInitiated).async {
  let stdinHandle = FileHandle.standardInput
  let chunkSize = 4096 // 1024 float samples = 256ms @ 16kHz
  while true {
    let chunk = stdinHandle.readData(ofLength: chunkSize)
    if chunk.isEmpty {
      coordinator.stop()
      break
    }
    coordinator.feedAudio(data: chunk)
  }
}

dispatchMain()
