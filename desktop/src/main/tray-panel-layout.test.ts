import { describe, expect, it } from 'vitest'
import { getTrayPanelBounds } from './tray-panel-layout'

describe('tray panel placement', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 }

  it('opens below a macOS menu bar and clamps at the right edge', () => {
    expect(
      getTrayPanelBounds({ x: 1410, y: 0, width: 20, height: 25 }, workArea)
    ).toEqual({ x: 1040, y: 33, width: 392, height: 540 })
  })

  it('opens above a bottom system tray', () => {
    expect(
      getTrayPanelBounds({ x: 900, y: 900, width: 20, height: 40 }, workArea)
    ).toEqual({ x: 714, y: 352, width: 392, height: 540 })
  })

  it('supports a monitor left of the primary display', () => {
    expect(
      getTrayPanelBounds(
        { x: -1400, y: 0, width: 20, height: 25 },
        { ...workArea, x: -1440 }
      )
    ).toEqual({ x: -1432, y: 33, width: 392, height: 540 })
  })

  it('fits a small display without extending beyond its work area', () => {
    expect(
      getTrayPanelBounds(
        { x: 0, y: 0, width: 0, height: 0 },
        { x: 0, y: 0, width: 320, height: 480 }
      )
    ).toEqual({ x: 8, y: 8, width: 304, height: 464 })
  })
})
