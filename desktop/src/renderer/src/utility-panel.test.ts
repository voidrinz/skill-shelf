import { describe, expect, it } from 'vitest'

import {
  clampUtilityPanelWidth,
  getUtilityPanelWidthBounds,
  toggleUtilityPanel,
} from './utility-panel'

describe('utility panel switching', () => {
  it('switches directly between AI and the task queue', () => {
    let current = toggleUtilityPanel(null, 'ai')
    expect(current).toBe('ai')
    current = toggleUtilityPanel(current, 'queue')
    expect(current).toBe('queue')
    current = toggleUtilityPanel(current, 'ai')
    expect(current).toBe('ai')
  })

  it('closes the currently active panel when its button is pressed again', () => {
    expect(toggleUtilityPanel('ai', 'ai')).toBeNull()
    expect(toggleUtilityPanel('queue', 'queue')).toBeNull()
  })
})

describe('utility panel width', () => {
  it('preserves enough workspace and expands the maximum when the sidebar collapses', () => {
    expect(getUtilityPanelWidthBounds(1_200, false)).toEqual({
      max: 640,
      min: 320,
    })
    expect(getUtilityPanelWidthBounds(1_200, true)).toEqual({
      max: 720,
      min: 320,
    })
  })

  it('clamps pointer and persisted widths to the current window', () => {
    expect(clampUtilityPanelWidth(600, 1_000, false)).toBe(440)
    expect(clampUtilityPanelWidth(100, 1_400, false)).toBe(320)
    expect(clampUtilityPanelWidth(Number.NaN, 1_400, false)).toBe(380)
  })
})
