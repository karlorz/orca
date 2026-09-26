import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SkillScanRoot } from './skill-discovery-sources'
import { classifyHomeSkillTopology, isCcSwitchSkillMaster } from './skill-installation-topology'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function codexRoot(path: string): SkillScanRoot {
  return {
    id: 'home-codex',
    label: 'Codex',
    path,
    sourceKind: 'home',
    providers: ['codex'],
    owner: 'codex'
  }
}

describe('isCcSwitchSkillMaster', () => {
  it('matches only the CC-Switch skill directory for that name', () => {
    expect(isCcSwitchSkillMaster('/Users/karlchow/.cc-switch/skills/orca-cli', 'orca-cli')).toBe(
      true
    )
    expect(
      isCcSwitchSkillMaster('/Users/karlchow/.cc-switch/skills/orca-cli-extra', 'orca-cli')
    ).toBe(false)
    expect(isCcSwitchSkillMaster('/tmp/orca-cli', 'orca-cli')).toBe(false)
  })
})

describe('classifyHomeSkillTopology', () => {
  it('treats a symlink into the CC-Switch skill master as a provider alias', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-cc-switch-'))
    roots.push(home)
    const master = join(home, '.cc-switch', 'skills', 'orca-cli')
    const codexSkills = join(home, '.codex', 'skills')
    await mkdir(master, { recursive: true })
    await mkdir(codexSkills, { recursive: true })
    await writeFile(join(master, 'SKILL.md'), '# orca-cli\n')
    await symlink(master, join(codexSkills, 'orca-cli'))

    const classified = await classifyHomeSkillTopology(
      codexRoot(codexSkills),
      join(codexSkills, 'orca-cli'),
      join(home, '.agents', 'skills')
    )

    expect(classified.topology).toBe('provider-alias')
    expect(classified.resolvedPath).toBe(await realpath(master))
  })

  it('keeps a symlink to anywhere else an external link', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orca-external-skill-'))
    roots.push(home)
    const elsewhere = join(home, 'elsewhere', 'orca-cli')
    const codexSkills = join(home, '.codex', 'skills')
    await mkdir(elsewhere, { recursive: true })
    await mkdir(codexSkills, { recursive: true })
    await writeFile(join(elsewhere, 'SKILL.md'), '# orca-cli\n')
    await symlink(elsewhere, join(codexSkills, 'orca-cli'))

    const classified = await classifyHomeSkillTopology(
      codexRoot(codexSkills),
      join(codexSkills, 'orca-cli'),
      join(home, '.agents', 'skills')
    )

    expect(classified.topology).toBe('external-link')
  })
})
