import { describe, expect, it } from 'vitest'

import {
  clampTerminalPanelHeight,
  getTerminalPanelHeightBounds,
} from './terminal-panel-layout'

describe('terminal panel height', () => {
  it('leaves a usable workspace above the terminal', () => {
    expect(getTerminalPanelHeightBounds(800)).toEqual({
      max: 496,
      min: 160,
    })
    expect(getTerminalPanelHeightBounds(1_200)).toEqual({
      max: 640,
      min: 160,
    })
  })

  it('clamps pointer and persisted heights to the current window', () => {
    expect(clampTerminalPanelHeight(560, 800)).toBe(496)
    expect(clampTerminalPanelHeight(80, 800)).toBe(160)
    expect(clampTerminalPanelHeight(Number.NaN, 800)).toBe(280)
  })
})
