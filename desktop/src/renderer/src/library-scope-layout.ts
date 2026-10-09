export const DEFAULT_LIBRARY_SCOPE_WIDTH = 200
export const LIBRARY_SCOPE_WIDTH_STORAGE_KEY =
  'skill-shelf:library-scope-width:v1'

export function getLibraryScopeWidthBounds(containerWidth: number) {
  const available = Math.max(0, containerWidth)
  const contentWidth = Math.min(360, available * 0.6)
  const max = Math.floor(Math.min(360, available - contentWidth))
  return { min: Math.min(180, max), max }
}

export function clampLibraryScopeWidth(width: number, containerWidth: number) {
  const { min, max } = getLibraryScopeWidthBounds(containerWidth)
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_LIBRARY_SCOPE_WIDTH
  return Math.round(Math.min(max, Math.max(min, safeWidth)))
}
