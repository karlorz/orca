import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resampleToRate } from './stt-audio-resample'
import type { SttEventSink } from './stt-service'

const HELPER_EXECUTABLE = 'orca-speech'
const HELPER_SAMPLE_RATE = 16000

export function resolveAppleSpeechHelperPath(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  // Check next to Electron binary or in release build location
  const candidateNextToExec = join(dirname(process.execPath), HELPER_EXECUTABLE)
  if (existsSync(candidateNextToExec)) {
    return candidateNextToExec
  }
  // Check build output in repo
  const repoCandidate = join(
    __dirname,
    '../../../native/speech-macos/.build/release',
    HELPER_EXECUTABLE
  )
  if (existsSync(repoCandidate)) {
    return repoCandidate
  }
  return null
}

export type AppleSpeechSessionOptions = {
  helperPath?: string
}

export class AppleSpeechSession {
  private child: ChildProcess | null = null
  private stdoutBuffer = ''
  private stopped = false

  constructor(
    readonly modelId: string,
    private readonly sink: SttEventSink,
    private readonly options: AppleSpeechSessionOptions = {}
  ) {}

  async start(): Promise<void> {
    const helperPath = this.options.helperPath ?? resolveAppleSpeechHelperPath()
    if (!helperPath) {
      throw new Error(`Apple speech helper executable not found: ${HELPER_EXECUTABLE}`)
    }

    const child = spawn(helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString('utf8'))
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      // Diagnostic logging on stderr
      const text = chunk.toString('utf8').trim()
      if (text) {
        console.warn(`[apple-speech] ${text}`)
      }
    })

    child.on('error', (err) => {
      if (!this.stopped) {
        this.sink({ type: 'error', error: err.message })
      }
    })

    child.on('exit', (code, signal) => {
      if (!this.stopped) {
        if (code !== 0 && code !== null) {
          this.sink({
            type: 'error',
            error: `orca-speech exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`
          })
        }
        this.sink({ type: 'stopped' })
      }
    })

    // Perform handshake: write sampleRate JSON
    const handshake = `${JSON.stringify({ sampleRate: HELPER_SAMPLE_RATE })}\n`
    child.stdin?.write(handshake)
  }

  feedAudio(samples: Float32Array, sampleRate: number): void {
    if (this.stopped || !this.child?.stdin?.writable) {
      return
    }
    const normalized =
      sampleRate === HELPER_SAMPLE_RATE
        ? samples
        : resampleToRate(samples, sampleRate, HELPER_SAMPLE_RATE)

    const buffer = Buffer.from(normalized.buffer, normalized.byteOffset, normalized.byteLength)
    this.child.stdin.write(buffer)
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    const child = this.child
    this.child = null

    if (child) {
      child.stdin?.end()
      child.kill('SIGTERM')
    }
    this.sink({ type: 'stopped' })
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      try {
        const parsed = JSON.parse(trimmed)
        if (!parsed || typeof parsed !== 'object') {
          continue
        }

        switch (parsed.type) {
          case 'ready':
            this.sink({ type: 'ready' })
            break
          case 'locale':
            console.log(
              `[apple-speech] resolved locale: ${parsed.locale} (source: ${parsed.source})`
            )
            break
          case 'partial':
            this.sink({ type: 'partial', text: parsed.text ?? '' })
            break
          case 'final':
            this.sink({ type: 'final', text: parsed.text ?? '' })
            break
          case 'error':
            this.sink({ type: 'error', error: parsed.error ?? 'Apple speech recognition error' })
            break
          default:
            break
        }
      } catch {
        // Ignore unparseable lines
      }
    }
  }
}
