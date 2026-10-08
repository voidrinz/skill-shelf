import type {
  InstalledSkill,
  SkillUpdateCheck,
} from '../../shared/desktop-contract'

export const UPDATE_SCAN_FRESHNESS_MS = 30 * 60_000

export type UpdateScanState = 'fresh' | 'missing' | 'stale'

export function getUpdateScanState(
  skills: InstalledSkill[],
  now = Date.now()
): UpdateScanState {
  if (skills.length === 0) return 'fresh'

  let oldestCheck = Number.POSITIVE_INFINITY
  for (const skill of skills) {
    if (skill.updateCheck.status === 'unchecked') return 'missing'
    const checkedAt = parseCheckedAt(skill.updateCheck)
    if (checkedAt === null) return 'missing'
    oldestCheck = Math.min(oldestCheck, checkedAt)
  }

  return now - oldestCheck > UPDATE_SCAN_FRESHNESS_MS ? 'stale' : 'fresh'
}

export function isSkillUpdateCheckFresh(
  check: SkillUpdateCheck,
  now = Date.now()
): boolean {
  if (check.status === 'unchecked') return false
  const checkedAt = parseCheckedAt(check)
  return checkedAt !== null && now - checkedAt <= UPDATE_SCAN_FRESHNESS_MS
}

function parseCheckedAt(check: SkillUpdateCheck): number | null {
  if (!check.checkedAt) return null
  const checkedAt = Date.parse(check.checkedAt)
  return Number.isFinite(checkedAt) ? checkedAt : null
}
