// Live validation against the real `grok` CLI on PATH.
// Why: bogus effort flag fails before any model or network call, proving valid sets per model.

import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { GROK_SESSION_OPTION_CATALOG } from './agent-session-option-catalog-grok'
import type { CatalogOption } from './agent-session-option-catalog-types'

const REAL_GROK_CLI_TEST_ENV = 'ORCA_REAL_GROK_CLI_TEST'

function isGrokOnPath(): boolean {
  try {
    return spawnSync('grok', ['--version']).status === 0
  } catch {
    return false
  }
}

const grokAvailable = process.env[REAL_GROK_CLI_TEST_ENV] === '1' && isGrokOnPath()

function effortChoicesForModel(modelId: string): string[] {
  const model = GROK_SESSION_OPTION_CATALOG.models.find((candidate) => candidate.id === modelId)
  const option = model?.options.find(
    (candidate): candidate is CatalogOption => candidate.id === 'effort'
  )
  return option?.kind.type === 'select' ? option.kind.choices.map((choice) => choice.value) : []
}

function parseValidEffortsFromGrokOutput(output: string): string[] | null {
  const match = /use one of:\s*([a-z, ]+)/i.exec(output)
  if (!match) {
    return null
  }
  return match[1]
    .split(',')
    .map((tier) => tier.trim())
    .filter(Boolean)
}

describe.skipIf(!grokAvailable)('grok real CLI reasoning effort catalog validation', () => {
  for (const model of GROK_SESSION_OPTION_CATALOG.models) {
    it(`matches valid effort set for ${model.id}`, () => {
      // Why 25s timeout: CLI cold start or network handshake before the argument gate.
      const result = spawnSync(
        'grok',
        ['-m', model.id, '--reasoning-effort', 'bogus', '-p', 'hi'],
        {
          timeout: 25_000,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )

      const expectedChoices = effortChoicesForModel(model.id)
      if (model.id === 'flash-non-reasoning') {
        // Why: flash-non-reasoning ignores the flag (never validates it), expecting empty menu.
        const output = `${result.stdout || ''}\n${result.stderr || ''}`
        expect(parseValidEffortsFromGrokOutput(output)).toBeNull()
        expect(expectedChoices).toEqual([])
        return
      }

      const output = `${result.stdout || ''}\n${result.stderr || ''}`
      const parsedTiers = parseValidEffortsFromGrokOutput(output)
      expect(parsedTiers).not.toBeNull()
      expect(new Set(parsedTiers)).toEqual(new Set(expectedChoices))
    }, 30_000)
  }
})
