import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tag = process.env.TAG_NAME
if (!tag || !/^v\d+\.\d+\.\d+-\d+$/.test(tag)) {
  throw new Error('Protocol metadata requires an immutable fork desktop tag')
}
const source = readFileSync(resolve('src/main/daemon/daemon-protocol-version.ts'), 'utf8')
const match = source.match(/^export const PROTOCOL_VERSION = (\d+)\s*$/m)
if (!match) {
  throw new Error('Cannot resolve the release daemon protocol')
}
const output = process.argv[2]
if (!output) {
  throw new Error('Protocol metadata requires an output filename')
}
writeFileSync(
  output,
  `${JSON.stringify({ schemaVersion: 1, tag, daemonProtocol: Number(match[1]) })}\n`,
  { flag: 'wx' }
)
