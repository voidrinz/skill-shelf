export function isLikelyIncompleteTranslation(
  source: string,
  output: string,
  finishReason?: string
): boolean {
  const normalizedSource = source.trim()
  const normalizedOutput = output.trim()
  if (!normalizedOutput) return true
  if (normalizedOutput === normalizedSource) return false
  if (finishReason === 'length') return true
  if (/[,，、;；]$/u.test(normalizedOutput)) return true
  if (hasUnclosedDelimiters(normalizedOutput)) return true

  const sourceLength = normalizedSource.replace(/\s/gu, '').length
  const outputLength = normalizedOutput.replace(/\s/gu, '').length
  return sourceLength >= 200 && outputLength < sourceLength * 0.15
}

function hasUnclosedDelimiters(value: string): boolean {
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['（', '）'],
    ['【', '】'],
    ['《', '》'],
    ['“', '”'],
    ['‘', '’'],
  ] as const
  if ((value.match(/`/gu)?.length ?? 0) % 2 !== 0) return true
  return pairs.some(
    ([opening, closing]) =>
      countOccurrences(value, opening) > countOccurrences(value, closing)
  )
}

function countOccurrences(value: string, character: string): number {
  return value.split(character).length - 1
}
