import type {
  InstalledSkill,
  SkillDescriptionTranslation,
} from '../../shared/desktop-contract'
import { isLikelyIncompleteTranslation } from '../../shared/translation-completeness'

export type SkillDescriptionSource =
  'ai-description' | 'ai-translation' | 'original' | 'source-copy'

export interface ResolvedSkillDescription {
  content: string
  source: SkillDescriptionSource
  staleTranslation: boolean
}

export function getSkillDescription(
  skill: InstalledSkill,
  locale: string
): string {
  return resolveSkillDescription(skill, locale).content
}

export function resolveSkillDescription(
  skill: InstalledSkill,
  locale: string
): ResolvedSkillDescription {
  const originalDescription = skill.description.trim()
  const translation = getStoredSkillTranslation(skill, locale)
  const translationIsCurrent = Boolean(
    translation &&
    translation.sourceDescription.trim() === originalDescription &&
    translation.content.trim() &&
    !isLikelyIncompleteTranslation(
      originalDescription,
      translation.content.trim()
    )
  )

  if (translation && translationIsCurrent) {
    return {
      content: translation.content,
      source:
        translation.method === 'source-copy' ? 'source-copy' : 'ai-translation',
      staleTranslation: false,
    }
  }

  const storedDescription = getStoredSkillDescription(skill, locale)
  if (storedDescription) {
    return {
      content: storedDescription,
      source: 'ai-description',
      staleTranslation: Boolean(translation),
    }
  }

  return {
    content: originalDescription,
    source: 'original',
    staleTranslation: Boolean(translation),
  }
}

export function getStoredSkillDescription(
  skill: InstalledSkill,
  locale: string
): string {
  const canonical = canonicalizeLocale(locale)
  const exact = skill.descriptions[canonical]
  if (exact) return exact

  const baseLanguage = canonical.split('-')[0]
  const localized = Object.entries(skill.descriptions).find(
    ([language]) => canonicalizeLocale(language).split('-')[0] === baseLanguage
  )?.[1]
  return localized || ''
}

export function getStoredSkillTranslation(
  skill: InstalledSkill,
  locale: string
): SkillDescriptionTranslation | null {
  const canonical = canonicalizeLocale(locale)
  const exact = skill.translations[canonical]
  if (exact) return exact

  const baseLanguage = canonical.split('-')[0]
  return (
    Object.entries(skill.translations).find(
      ([language]) =>
        canonicalizeLocale(language).split('-')[0] === baseLanguage
    )?.[1] ?? null
  )
}

function canonicalizeLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? locale
  } catch {
    return locale
  }
}
