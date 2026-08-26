#!/usr/bin/env node
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = join(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'dist-own-mobile-relay')
const ENTRY = join(ROOT, 'src/main/runtime/relay/own-mobile-relay-main.ts')
const OUT_FILE = join(OUT_DIR, 'own-mobile-relay.cjs')

mkdirSync(OUT_DIR, { recursive: true })

try {
  await build({
    entryPoints: [ENTRY],
    outfile: OUT_FILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: false,
    sourcemap: true,
    target: 'node18'
  })
  process.stdout.write(`[build-own-mobile-relay] Successfully built ${OUT_FILE}\n`)
} catch (error) {
  process.stderr.write(`[build-own-mobile-relay] Build failed: ${String(error)}\n`)
  process.exit(1)
}
