import { describe, expect, it } from 'vitest'

import type {
  InstalledSkill,
  SkillUpdateCheck,
} from '../../shared/desktop-contract'
import {
  UPDATE_SCAN_FRESHNESS_MS,
  getUpdateScanState,
  isSkillUpdateCheckFresh,
} from './skill-update-policy'

const now = Date.parse('2026-08-28T10:00:00.000Z')

describe('skill update policy', () => {
  it('requires a scan when any Skill has not been checked', () => {
    expect(
      getUpdateScanState(
        [skill('current', now), skill('unchecked', undefined, 'second')],
        now
      )
    ).toBe('missing')
  })

  it('treats the whole scan as stale when its oldest result is too old', () => {
    expect(
      getUpdateScanState(
        [
          skill('current', now - UPDATE_SCAN_FRESHNESS_MS - 1),
          skill('update-available', now, 'second'),
        ],
        now
      )
    ).toBe('stale')
  })

  it('accepts fresh results including unavailable checks', () => {
    expect(
      getUpdateScanState(
        [skill('current', now), skill('unavailable', now, 'second')],
        now
      )
    ).toBe('fresh')
  })

  it('checks individual result freshness with the same threshold', () => {
    expect(isSkillUpdateCheckFresh(check('update-available', now), now)).toBe(
      true
    )
    expect(
      isSkillUpdateCheckFresh(
        check('update-available', now - UPDATE_SCAN_FRESHNESS_MS - 1),
        now
      )
    ).toBe(false)
  })
})

function skill(
  status: SkillUpdateCheck['status'],
  checkedAt?: number,
  id = 'first'
): InstalledSkill {
  return {
    agents: [],
    description: '',
    descriptions: {},
    groupId: null,
    position: null,
    id: `global:${id}`,
    installKind: 'directory',
    name: id,
    path: `/skills/${id}`,
    scope: 'global',
    tags: [],
    translations: {},
    updateCheck: check(status, checkedAt),
  }
}

function check(
  status: SkillUpdateCheck['status'],
  checkedAt?: number
): SkillUpdateCheck {
  return {
    ...(checkedAt === undefined
      ? {}
      : { checkedAt: new Date(checkedAt).toISOString() }),
    reason: status === 'unchecked' ? 'not-scanned' : 'up-to-date',
    status,
  }
}
