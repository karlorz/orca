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
    return nil
  }

  if let matched = findSupported(identifier: chosenId) {
    return (matched, source, chosenId)
  }

  // Not supported by SFSpeechRecognizer
  return (Locale(identifier: chosenId), source, chosenId)
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

guard let recognizer = SFSpeechRecognizer(locale: resolved.locale), recognizer.isAvailable else {
  emitJson(["type": "error", "error": "apple_speech_locale_unsupported:\(resolved.identifier)"])
  exit(1)
}

class SpeechCoordinator {
  private let recognizer: SFSpeechRecognizer
  private let sampleRate: Double
  private let audioFormat: AVAudioFormat

  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var lastDeliveredText = ""
  private var rearmTimer: DispatchSourceTimer?
  private let queue = DispatchQueue(label: "com.stablyai.orca.speech-coordinator")
  private var isStopped = false

  init(recognizer: SFSpeechRecognizer, sampleRate: Double) {
    self.recognizer = recognizer
    self.sampleRate = sampleRate
    self.audioFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
  }

  func start() {
    queue.async {
      self.armRequest()
      emitJson(["type": "ready"])
    }
  }

  private func armRequest() {
    guard !isStopped else { return }

    // Cancel old timer if active
    rearmTimer?.cancel()
    rearmTimer = nil

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(macOS 10.15, *) {
      if recognizer.supportsOnDeviceRecognition {
        request.requiresOnDeviceRecognition = false
      }
    }
    self.recognitionRequest = request

    let currentPrefix = lastDeliveredText

    self.recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self = self else { return }
      self.queue.async {
        if let error = error as? NSError {
          // If stopped or canceled as part of re-arm, ignore cancellation error
          if self.isStopped {
            return
          }
          let isCancelled = error.domain == "kAFAssistantErrorDomain" && (error.code == 203 || error.code == 216)
            || error.domain == "kLSRErrorDomain" && error.code == 201
          if isCancelled {
            return
          }
          emitJson(["type": "error", "error": error.localizedDescription])
          return
        }

        if let result = result {
          let recognized = result.bestTranscription.formattedString
          let fullText = currentPrefix.isEmpty ? recognized : (currentPrefix + " " + recognized)
          if result.isFinal {
            self.lastDeliveredText = fullText
            emitJson(["type": "final", "text": fullText])
          } else {
            emitJson(["type": "partial", "text": fullText])
          }
        }
      }
    }

    // Schedule rolling re-arm at 50 seconds (before Apple 60s cloud limit)
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 50.0)
    timer.setEventHandler { [weak self] in
      self?.rollRequest()
    }
    timer.resume()
    self.rearmTimer = timer
  }

  private func rollRequest() {
    guard !isStopped else { return }
    logDebug("Rolling recognition request re-arm")
    recognitionRequest?.endAudio()
    armRequest()
  }

  func feedAudio(data: Data) {
    queue.async {
      guard !self.isStopped, let request = self.recognitionRequest else { return }
      let frameCount = UInt32(data.count / MemoryLayout<Float>.size)
      guard frameCount > 0,
            let pcmBuffer = AVAudioPCMBuffer(pcmFormat: self.audioFormat, frameCapacity: frameCount) else {
        return
      }
      pcmBuffer.frameLength = frameCount
      data.withUnsafeBytes { raw in
        if let base = raw.baseAddress?.assumingMemoryBound(to: Float.self),
           let channel = pcmBuffer.floatChannelData?[0] {
          channel.initialize(from: base, count: Int(frameCount))
        }
      }
      request.append(pcmBuffer)
    }
  }

  func stop() {
    queue.async {
      guard !self.isStopped else { return }
      self.isStopped = true
      self.rearmTimer?.cancel()
      self.rearmTimer = nil
      self.recognitionRequest?.endAudio()
      self.recognitionTask?.finish()
      exit(0)
    }
  }
}

let coordinator = SpeechCoordinator(recognizer: recognizer, sampleRate: Double(sampleRate))
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
