import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE_ROOT = join(import.meta.dirname, '..')
const SCAN_ROOTS = [join(MOBILE_ROOT, 'src'), join(MOBILE_ROOT, 'app')]

const BANNED = [
  { name: 'toSorted', pattern: /\.toSorted\s*\(/ },
  { name: 'toReversed', pattern: /\.toReversed\s*\(/ },
  { name: 'toSpliced', pattern: /\.toSpliced\s*\(/ },
  { name: 'findLast', pattern: /\.findLast\s*\(/ },
  { name: 'findLastIndex', pattern: /\.findLastIndex\s*\(/ }
]

function isProductionSource(filename: string): boolean {
  return /\.(ts|tsx)$/.test(filename) && !/\.test\.(ts|tsx)$/.test(filename)
}

function walk(dir: string, acc: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') {
      continue
    }
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      walk(path, acc)
      continue
    }
    if (isProductionSource(name)) {
      acc.push(path)
    }
  }
}

describe('Hermes ES2023 array ban', () => {
  it('forbids toSorted/toReversed/toSpliced/findLast in production mobile src and app', () => {
    const files: string[] = []
    for (const root of SCAN_ROOTS) {
      walk(root, files)
    }
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const rule of BANNED) {
        if (rule.pattern.test(text)) {
          hits.push(`${relative(MOBILE_ROOT, file)}: ${rule.name}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})
