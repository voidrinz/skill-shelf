import {
  DEFAULT_TERMINAL_PANEL_HEIGHT,
  MAX_TERMINAL_PANEL_HEIGHT,
  MIN_TERMINAL_PANEL_HEIGHT,
} from '../../shared/desktop-contract'

const STATUS_BAR_HEIGHT = 44
const MIN_WORKSPACE_HEIGHT = 260

export function getTerminalPanelHeightBounds(viewportHeight: number) {
  const availableHeight = Math.max(
    MIN_TERMINAL_PANEL_HEIGHT,
    viewportHeight - STATUS_BAR_HEIGHT - MIN_WORKSPACE_HEIGHT
  )
  return {
    max: Math.min(MAX_TERMINAL_PANEL_HEIGHT, availableHeight),
    min: MIN_TERMINAL_PANEL_HEIGHT,
  }
}

export function clampTerminalPanelHeight(
  height: number,
  viewportHeight: number
) {
  const bounds = getTerminalPanelHeightBounds(viewportHeight)
  const safeHeight = Number.isFinite(height)
    ? height
    : DEFAULT_TERMINAL_PANEL_HEIGHT
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, safeHeight)))
}
