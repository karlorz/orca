import EventEmitter from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn()
  }
})

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    this.killed = true
    this.emit('exit', 0, signal ?? 'SIGTERM')
    return true
  })

  constructor() {
    super()
    vi.spyOn(this.stdin, 'end')
  }
}

import { AppleSpeechSession } from './apple-speech-session'
import type { SttEvent } from './stt-service'

describe('AppleSpeechSession', () => {
  let mockChild: FakeChildProcess

  beforeEach(() => {
    mockChild = new FakeChildProcess()
    spawnMock.mockReset()
    spawnMock.mockReturnValue(mockChild)
  })

  it('performs sample-rate handshake on spawn and emits ready', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech'
    })

    let stdinData = ''
    mockChild.stdin.on('data', (chunk) => {
      stdinData += chunk.toString()
    })

    await session.start()

    expect(spawnMock).toHaveBeenCalledWith('/custom/path/orca-speech', [], expect.any(Object))
    expect(stdinData).toContain('{"sampleRate":16000}\n')

    // Simulate helper replying with ready event
    mockChild.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`)

    expect(events).toContainEqual({ type: 'ready' })
  })

  it('translates partial, final, and error events to the event sink', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech'
    })
    await session.start()

    mockChild.stdout.write(`${JSON.stringify({ type: 'partial', text: '你好' })}\n`)
    expect(events).toContainEqual({ type: 'partial', text: '你好' })

    mockChild.stdout.write(`${JSON.stringify({ type: 'final', text: '你好世界' })}\n`)
    expect(events).toContainEqual({ type: 'final', text: '你好世界' })

    mockChild.stdout.write(
      `${JSON.stringify({ type: 'error', error: 'apple_speech_locale_unsupported:xx-YY' })}\n`
    )
    expect(events).toContainEqual({
      type: 'error',
      error: 'apple_speech_locale_unsupported:xx-YY'
    })
  })

  it('feeds Float32Array PCM audio chunks over stdin', async () => {
    const session = new AppleSpeechSession('mac-system-speech', vi.fn(), {
      helperPath: '/custom/path/orca-speech'
    })
    const chunksWritten: Buffer[] = []
    mockChild.stdin.on('data', (chunk: Buffer) => {
      // First chunk is handshake JSON
      if (!chunk.toString().startsWith('{')) {
        chunksWritten.push(chunk)
      }
    })

    await session.start()

    const pcm = new Float32Array([0.1, -0.2, 0.3, -0.4])
    session.feedAudio(pcm, 16000)

    const totalWritten = Buffer.concat(chunksWritten)
    expect(totalWritten.length).toBe(pcm.byteLength)
  })

  it('resamples feedAudio if incoming sample rate differs from 16000', async () => {
    const session = new AppleSpeechSession('mac-system-speech', vi.fn(), {
      helperPath: '/custom/path/orca-speech'
    })
    const chunksWritten: Buffer[] = []
    mockChild.stdin.on('data', (chunk: Buffer) => {
      if (!chunk.toString().startsWith('{')) {
        chunksWritten.push(chunk)
      }
    })

    await session.start()

    // 48000Hz 480 samples = 10ms -> resampled to 16000Hz 160 samples = 640 bytes
    const pcm = new Float32Array(480)
    session.feedAudio(pcm, 48000)

    const totalWritten = Buffer.concat(chunksWritten)
    expect(totalWritten.length).toBe(160 * 4)
  })

  it('tears down child process and closes stdin when stopped', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech',
      stopFlushTimeoutMs: 0
    })

    await session.start()
    await session.stop()

    expect(mockChild.stdin.end).toHaveBeenCalled()
    expect(mockChild.kill).toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'stopped' })
  })

  it('promotes the last partial to final on stop when the helper never finalizes', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech',
      stopFlushTimeoutMs: 0
    })
    await session.start()
    mockChild.stdout.write(`${JSON.stringify({ type: 'partial', text: 'Testing Testing' })}\n`)

    await session.stop()

    expect(events).toContainEqual({ type: 'final', text: 'Testing Testing' })
    const types = events.map((event) => event.type)
    expect(types.lastIndexOf('final')).toBeLessThan(types.lastIndexOf('stopped'))
  })

  it('does not synthesize a final on stop when there was no partial', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech',
      stopFlushTimeoutMs: 0
    })
    await session.start()
    await session.stop()

    expect(events.filter((event) => event.type === 'final')).toEqual([])
    expect(events).toContainEqual({ type: 'stopped' })
  })

  it('keeps a helper-provided final instead of duplicating the last partial', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech',
      stopFlushTimeoutMs: 0
    })
    await session.start()
    mockChild.stdout.write(`${JSON.stringify({ type: 'partial', text: 'hello' })}\n`)
    mockChild.stdout.write(`${JSON.stringify({ type: 'final', text: 'hello world' })}\n`)

    await session.stop()

    expect(events.filter((event) => event.type === 'final')).toEqual([
      { type: 'final', text: 'hello world' }
    ])
  })

  it('uses a helper final that arrives after stdin closes', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech',
      stopFlushTimeoutMs: 40
    })
    await session.start()
    mockChild.stdout.write(`${JSON.stringify({ type: 'partial', text: 'hello' })}\n`)
    mockChild.kill.mockImplementation(() => {
      mockChild.killed = true
      return true
    })

    const stopPromise = session.stop()
    setTimeout(() => {
      mockChild.stdout.write(`${JSON.stringify({ type: 'final', text: 'hello world' })}\n`)
    }, 10)
    await stopPromise

    expect(events.filter((event) => event.type === 'final')).toEqual([
      { type: 'final', text: 'hello world' }
    ])
    const types = events.map((event) => event.type)
    expect(types.lastIndexOf('final')).toBeLessThan(types.lastIndexOf('stopped'))
  })

  it('emits final then stopped when the helper exits after an endpoint final', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech'
    })
    await session.start()
    mockChild.stdout.write(`${JSON.stringify({ type: 'final', text: '喂今日天氣好唔好' })}\n`)
    mockChild.emit('exit', 0, null)

    expect(events).toContainEqual({ type: 'final', text: '喂今日天氣好唔好' })
    expect(events).toContainEqual({ type: 'stopped' })
    const types = events.map((event) => event.type)
    expect(types.lastIndexOf('final')).toBeLessThan(types.lastIndexOf('stopped'))
  })

  it('promotes the last partial when the helper exits without an explicit stop', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech'
    })
    await session.start()
    mockChild.stdout.write(`${JSON.stringify({ type: 'partial', text: '喂今日天氣好唔好' })}\n`)
    mockChild.emit('exit', 0, null)

    expect(events).toContainEqual({ type: 'final', text: '喂今日天氣好唔好' })
    expect(events).toContainEqual({ type: 'stopped' })
  })

  it('emits error if child exits unexpectedly with non-zero exit code', async () => {
    const events: SttEvent[] = []
    const session = new AppleSpeechSession('mac-system-speech', (e) => events.push(e), {
      helperPath: '/custom/path/orca-speech'
    })
    await session.start()

    mockChild.emit('exit', 1, null)

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.stringContaining('orca-speech exited with code 1')
      })
    )
  })
})
