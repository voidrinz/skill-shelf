import { useState } from 'react'
import {
  Braces,
  HardDrive,
  Languages,
  LoaderCircle,
  LockKeyhole,
  RotateCw,
} from 'lucide-react'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import type {
  AiProviderSettingsStatus,
  InstalledSkill,
} from '../../shared/desktop-contract'
import { isLikelyIncompleteTranslation } from '../../shared/translation-completeness'
import { AI_LANGUAGE_OPTIONS } from './ai-language-options'
import { isDescriptionClearlyInTargetLanguage } from './description-language'
import { getStoredSkillTranslation } from './skill-description'

type DescriptionMode = 'original' | 'translation'

export default function SkillDescriptionPanel({
  onOpenAiSettings,
  onTranslate,
  settings,
  skill,
  translating,
}: {
  onOpenAiSettings: () => void
  onTranslate: (language: string) => boolean
  settings: AiProviderSettingsStatus | null
  skill: InstalledSkill
  translating: boolean
}) {
  const { locale, t } = useI18n()
  const initialLanguage = settings?.targetLanguage ?? locale
  const [language, setLanguage] = useState(initialLanguage)
  const [mode, setMode] = useState<DescriptionMode>(() => {
    const initialTranslation = getStoredSkillTranslation(skill, initialLanguage)
    return initialTranslation &&
      !isLikelyIncompleteTranslation(
        skill.description,
        initialTranslation.content
      )
      ? 'translation'
      : 'original'
  })
  const translation = getStoredSkillTranslation(skill, language)
  const translationIsIncomplete = Boolean(
    translation &&
    isLikelyIncompleteTranslation(skill.description, translation.content)
  )
  const translatedDescription = translationIsIncomplete
    ? ''
    : (translation?.content ?? '')
  const languageOption = AI_LANGUAGE_OPTIONS.find(
    (option) => option.id === language
  )
  const languageName = languageOption ? t(languageOption.key) : language
  const aiAvailable = Boolean(settings?.configured && settings.enabled)
  const originalDescription = skill.description.trim()
  const sourceMatchesTarget = isDescriptionClearlyInTargetLanguage(
    originalDescription,
    language
  )
  const translationIsStale = Boolean(
    translation &&
    (translation.sourceDescription !== originalDescription ||
      translationIsIncomplete)
  )

  function translateDescription() {
    if (
      translating ||
      !originalDescription ||
      (!aiAvailable && !sourceMatchesTarget)
    ) {
      return
    }
    if (onTranslate(language)) setMode('translation')
  }

  return (
    <section className="skill-description-card">
      <header className="skill-description-toolbar">
        <div className="skill-description-heading">
          <span>
            <Languages />
          </span>
          <div>
            <h3>{t('desktop.inspector.description')}</h3>
            <small>{t('desktop.inspector.descriptionHint')}</small>
          </div>
        </div>
        <div
          aria-label={t('desktop.inspector.descriptionView')}
          className="description-mode-switch"
        >
          <button
            aria-pressed={mode === 'original'}
            className={cn(mode === 'original' && 'is-active')}
            onClick={() => setMode('original')}
            type="button"
          >
            <Braces />
            {t('desktop.inspector.originalDescription')}
          </button>
          <button
            aria-pressed={mode === 'translation'}
            className={cn(mode === 'translation' && 'is-active')}
            onClick={() => setMode('translation')}
            type="button"
          >
            <Languages />
            {t('desktop.inspector.aiTranslation')}
          </button>
        </div>
      </header>

      {mode === 'original' ? (
        <div className="skill-description-body">
          <p className={cn(!originalDescription && 'is-empty')}>
            {originalDescription || t('desktop.inspector.noDescription')}
          </p>
          <div className="skill-description-provenance">
            <LockKeyhole />
            <span>{t('desktop.inspector.originalDescriptionSource')}</span>
          </div>
        </div>
      ) : (
        <div className="skill-description-body is-translation">
          <div className="skill-translation-controls">
            <Select
              disabled={translating}
              onValueChange={(value) => {
                setLanguage(value)
              }}
              value={language}
            >
              <SelectTrigger
                aria-label={t('desktop.inspector.translationLanguage')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_LANGUAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {t(option.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {aiAvailable || sourceMatchesTarget ? (
              <Button
                disabled={translating || !originalDescription}
                onClick={translateDescription}
                size="xs"
                variant={translatedDescription ? 'outline' : 'default'}
              >
                {translating ? (
                  <LoaderCircle className="animate-spin" />
                ) : sourceMatchesTarget ? (
                  <HardDrive />
                ) : (
                  <RotateCw />
                )}
                {translating
                  ? t('desktop.inspector.translatingDescription')
                  : sourceMatchesTarget
                    ? t('desktop.inspector.saveSourceDescription')
                    : translatedDescription
                      ? t('desktop.inspector.retranslateDescription')
                      : t('desktop.inspector.translateDescription')}
              </Button>
            ) : (
              <Button onClick={onOpenAiSettings} size="xs" variant="outline">
                {t('desktop.ai.setup')}
              </Button>
            )}
          </div>

          {translatedDescription ? (
            <>
              {translationIsStale ? (
                <div className="skill-translation-stale">
                  {t('desktop.inspector.translationStale')}
                </div>
              ) : null}
              <p>{translatedDescription}</p>
            </>
          ) : (
            <div className="skill-translation-empty">
              <Languages />
              <strong>
                {t('desktop.inspector.translationMissing', {
                  language: languageName,
                })}
              </strong>
              <span>
                {!originalDescription
                  ? t('desktop.inspector.translationNoSource')
                  : sourceMatchesTarget
                    ? t('desktop.inspector.translationSourceReady')
                    : aiAvailable
                      ? t('desktop.inspector.translationPrompt')
                      : t('desktop.inspector.translationSetup')}
              </span>
            </div>
          )}
          <div className="skill-description-provenance">
            <HardDrive />
            <span>
              {translation?.method === 'source-copy'
                ? t('desktop.inspector.descriptionSourceCopy')
                : t('desktop.inspector.translationLocalOnly')}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
