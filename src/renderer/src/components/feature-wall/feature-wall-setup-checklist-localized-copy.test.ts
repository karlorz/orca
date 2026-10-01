import { describe, expect, it } from 'vitest'
import { FEATURE_WALL_SETUP_STEPS } from '../../../../shared/feature-wall-setup-steps'
import { getLocalizedFeatureWallSetupChecklistCopy } from './feature-wall-setup-checklist-localized-copy'
import ko from '../../i18n/locales/ko.json'
import en from '../../i18n/locales/en.json'

describe('feature-wall-setup-checklist-localized-copy', () => {
  it('returns non-empty localized name and description for all setup checklist steps', () => {
    for (const step of FEATURE_WALL_SETUP_STEPS) {
      const localized = getLocalizedFeatureWallSetupChecklistCopy(step)
      expect(localized.name).toBeTruthy()
      expect(localized.description).toBeTruthy()
    }
  })

  it('has valid Korean and English catalog entries for all setup checklist steps', () => {
    const enKeys = en.auto.components.feature.wall.feature.wall.setup.checklist.localized.copy
    const koKeys = ko.auto.components.feature.wall.feature.wall.setup.checklist.localized.copy
    const referencedKeys = [
      'workOnTwoTasks',
      '62bac8f43c',
      '908898c3ee',
      '43781563c3',
      '29aa2c2077',
      '71bd9a8c95',
      '46db810da8',
      'b8e5bae17f',
      'agentSkillsName',
      'agentSkillsDescription',
      'ad342dd4c6',
      '06fe30fdb0',
      'eddc532e58',
      '56049b74c2',
      '2cf795433b',
      '42525ba8a4'
    ]
    for (const key of referencedKeys) {
      expect(Object.entries(enKeys)).toContainEqual([key, expect.any(String)])
      expect(Object.entries(koKeys)).toContainEqual([key, expect.any(String)])
    }
  })
})
