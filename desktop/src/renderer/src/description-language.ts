const HAN_PATTERN = /\p{Script=Han}/gu
const HANGUL_PATTERN = /\p{Script=Hangul}/gu
const KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const LETTER_PATTERN = /\p{L}/gu
const LATIN_WORD_PATTERN = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu

const LANGUAGE_MARKERS: Record<'de' | 'en' | 'es' | 'fr', Set<string>> = {
  de: new Set([
    'das',
    'der',
    'die',
    'ein',
    'eine',
    'für',
    'ist',
    'mit',
    'und',
    'von',
    'zu',
  ]),
  en: new Set([
    'a',
    'an',
    'and',
    'for',
    'from',
    'helps',
    'is',
    'of',
    'or',
    'that',
    'the',
    'this',
    'to',
    'with',
  ]),
  es: new Set([
    'con',
    'de',
    'del',
    'el',
    'en',
    'es',
    'la',
    'las',
    'los',
    'para',
    'por',
    'una',
    'y',
  ]),
  fr: new Set([
    'avec',
    'dans',
    'de',
    'des',
    'du',
    'est',
    'et',
    'la',
    'le',
    'les',
    'pour',
    'une',
  ]),
}

const DISTINCTIVE_LATIN_PATTERN: Record<'de' | 'es' | 'fr', RegExp> = {
  de: /[äöüß]/iu,
  es: /[áéíóúüñ¿¡]/iu,
  fr: /[àâçéèêëîïôùûüÿœæ]/iu,
}

export function isDescriptionClearlyInTargetLanguage(
  text: string,
  targetLanguage: string
): boolean {
  const description = text.trim()
  if (!description) return false

  const language = getBaseLanguage(targetLanguage)
  const hanCount = countMatches(description, HAN_PATTERN)
  const kanaCount = countMatches(description, KANA_PATTERN)
  const hangulCount = countMatches(description, HANGUL_PATTERN)
  const letterCount = countMatches(description, LETTER_PATTERN)

  if (language === 'zh') {
    return (
      kanaCount === 0 &&
      hangulCount === 0 &&
      hanCount >= 2 &&
      hanCount / letterCount >= 0.35
    )
  }
  if (language === 'ja') {
    return (
      hangulCount === 0 &&
      kanaCount >= 2 &&
      (kanaCount + hanCount) / letterCount >= 0.35
    )
  }
  if (language === 'ko') {
    return (
      kanaCount === 0 && hangulCount >= 2 && hangulCount / letterCount >= 0.35
    )
  }
  if (!['de', 'en', 'es', 'fr'].includes(language)) return false
  if (hanCount > 0 || kanaCount > 0 || hangulCount > 0) return false

  const words = description
    .match(LATIN_WORD_PATTERN)
    ?.map((word) => word.toLocaleLowerCase())
  if (!words || words.length < 3) return false

  const markerCount = words.filter((word) =>
    LANGUAGE_MARKERS[language as keyof typeof LANGUAGE_MARKERS].has(word)
  ).length
  if (language === 'en') return markerCount >= 2

  return (
    DISTINCTIVE_LATIN_PATTERN[
      language as keyof typeof DISTINCTIVE_LATIN_PATTERN
    ].test(description) || markerCount >= 2
  )
}

function countMatches(value: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  return value.match(pattern)?.length ?? 0
}

function getBaseLanguage(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0]?.split('-')[0] ?? ''
  } catch {
    return ''
  }
}
