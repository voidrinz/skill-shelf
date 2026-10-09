import { useId, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Languages,
  LoaderCircle,
  RotateCw,
  Settings2,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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

export default function SkillDescriptionPanel({
  onOpenAiSettings,
  onTranslate,
  settings,
  skill,
  translating,
}: {
  onOpenAiSettings: () => void
  onTranslate: (language: string, force?: boolean) => boolean
  settings: AiProviderSettingsStatus | null
  skill: InstalledSkill
  translating: boolean
}) {
  const { locale, t } = useI18n()
  const [selectedLanguage, setLanguage] = useState<string | null>(null)
  const language = selectedLanguage ?? settings?.targetLanguage ?? locale
  const [mode, setMode] = useState<'original' | 'translation'>('translation')
  const headingId = useId()
  const translation = getStoredSkillTranslation(skill, language)
  const originalDescription = skill.description.trim()
  const translationIsStale = Boolean(
    translation &&
    (translation.sourceDescription.trim() !== originalDescription ||
      isLikelyIncompleteTranslation(originalDescription, translation.content))
  )
  const hasTranslation = Boolean(
    translation &&
    !translationIsStale &&
    translation.content.trim() !== originalDescription
  )
  const showTranslation = mode === 'translation' && hasTranslation
  const languageOption = AI_LANGUAGE_OPTIONS.find(
    (option) => option.id === language
  )
  const languageName = languageOption ? t(languageOption.key) : language
  const aiAvailable = Boolean(settings?.configured && settings.enabled)
  const sourceMatchesTarget = isDescriptionClearlyInTargetLanguage(
    originalDescription,
    language
  )
  const provenance = showTranslation
    ? t('desktop.inspector.translationLocalOnly')
    : t('desktop.inspector.originalDescriptionSource')

  function translateDescription(force = false) {
    if (translating || !originalDescription) return
    if (!aiAvailable && !sourceMatchesTarget) {
      onOpenAiSettings()
      return
    }
    if (onTranslate(language, force)) setMode('translation')
  }

  return (
    <section aria-labelledby={headingId} className="skill-description-card">
      <header className="skill-description-toolbar">
        <div className="skill-description-heading">
          <h3 id={headingId}>{t('desktop.inspector.description')}</h3>
          <span className="skill-description-source" title={provenance}>
            {showTranslation
              ? t('desktop.inspector.translatedLanguage', {
                  language: languageName,
                })
              : t('desktop.inspector.originalDescription')}
          </span>
        </div>
        {originalDescription ? (
          <div className="skill-description-actions">
            {translating ? (
              <Button disabled size="xs" variant="ghost">
                <LoaderCircle className="animate-spin" />
                {t('desktop.inspector.translatingDescription')}
              </Button>
            ) : hasTranslation ? (
              <Button
                onClick={() =>
                  setMode(showTranslation ? 'original' : 'translation')
                }
                size="xs"
                variant="ghost"
              >
                {t(
                  showTranslation
                    ? 'desktop.inspector.viewOriginal'
                    : 'desktop.inspector.viewTranslation'
                )}
              </Button>
            ) : !sourceMatchesTarget ? (
              <Button
                onClick={() => translateDescription()}
                size="xs"
                variant="ghost"
              >
                <Languages />
                {aiAvailable
                  ? t('desktop.inspector.translateToLanguage', {
                      language: languageName,
                    })
                  : t('desktop.inspector.setupTranslation')}
              </Button>
            ) : null}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t('desktop.inspector.translationOptions')}
                  className={cn(
                    'skill-description-options',
                    sourceMatchesTarget && !hasTranslation && 'has-language'
                  )}
                  disabled={translating}
                  size="xs"
                  variant="ghost"
                >
                  {sourceMatchesTarget && !hasTranslation ? languageName : null}
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="skill-translation-menu"
              >
                <DropdownMenuLabel>
                  {t('desktop.inspector.translationLanguage')}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  onValueChange={(value) => {
                    setLanguage(value)
                    setMode('translation')
                  }}
                  value={language}
                >
                  {AI_LANGUAGE_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {t(option.key)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {translation || sourceMatchesTarget ? (
                  <DropdownMenuItem
                    disabled={!aiAvailable && !sourceMatchesTarget}
                    onSelect={() => translateDescription(true)}
                  >
                    <RotateCw />
                    {t(
                      sourceMatchesTarget
                        ? 'desktop.inspector.saveSourceDescription'
                        : 'desktop.inspector.retranslateDescription'
                    )}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onOpenAiSettings}>
                  <Settings2 />
                  {t('desktop.inspector.translationSettings')}
                </DropdownMenuItem>
                <p className="skill-translation-menu-note">{provenance}</p>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </header>
      <DescriptionText
        key={`${language}:${showTranslation ? 'translation' : 'original'}`}
        empty={!originalDescription}
        text={
          showTranslation
            ? translation!.content
            : originalDescription || t('desktop.inspector.noDescription')
        }
      />
      {translationIsStale && !translating ? (
        <p className="skill-translation-stale" role="status">
          {t('desktop.inspector.translationNeedsRefresh')}
        </p>
      ) : null}
    </section>
  )
}

function DescriptionText({ empty, text }: { empty: boolean; text: string }) {
  const { t } = useI18n()
  const id = useId()
  const textRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight)
      setOverflows(element.scrollHeight > lineHeight * 4 + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  return (
    <div className="skill-description-body">
      <p
        className={cn(!expanded && 'is-collapsed', empty && 'is-empty')}
        id={id}
        ref={textRef}
      >
        {text}
      </p>
      {overflows ? (
        <Button
          aria-controls={id}
          aria-expanded={expanded}
          className="skill-description-expand"
          onClick={() => setExpanded(!expanded)}
          size="xs"
          variant="ghost"
        >
          {t(
            expanded
              ? 'desktop.inspector.showLess'
              : 'desktop.inspector.showFullDescription'
          )}
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      ) : null}
    </div>
  )
}
