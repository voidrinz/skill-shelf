import {
  DEFAULT_UTILITY_PANEL_WIDTH,
  MAX_UTILITY_PANEL_WIDTH,
  MIN_UTILITY_PANEL_WIDTH,
} from '../../shared/desktop-contract'

export type UtilityPanelMode = 'ai' | 'queue' | null

const EXPANDED_SIDEBAR_WIDTH = 200
const COLLAPSED_SIDEBAR_WIDTH = 64
const MAIN_WORKSPACE_MIN_WIDTH = 360

export function getUtilityPanelWidthBounds(
  containerWidth: number,
  sidebarCollapsed: boolean
) {
  const sidebarWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : EXPANDED_SIDEBAR_WIDTH
  const availableWidth = Math.max(
    MIN_UTILITY_PANEL_WIDTH,
    containerWidth - sidebarWidth - MAIN_WORKSPACE_MIN_WIDTH
  )
  return {
    max: Math.min(MAX_UTILITY_PANEL_WIDTH, availableWidth),
    min: MIN_UTILITY_PANEL_WIDTH,
  }
}

export function clampUtilityPanelWidth(
  width: number,
  containerWidth: number,
  sidebarCollapsed: boolean
) {
  const bounds = getUtilityPanelWidthBounds(containerWidth, sidebarCollapsed)
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_UTILITY_PANEL_WIDTH
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, safeWidth)))
}

export function toggleUtilityPanel(
  current: UtilityPanelMode,
  target: Exclude<UtilityPanelMode, null>
): UtilityPanelMode {
  return current === target ? null : target
}
