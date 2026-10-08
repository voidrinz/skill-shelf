import { describe, expect, it } from 'vitest'

import {
  MAX_TERMINAL_TABS,
  getNextTerminalTabIdAfterClose,
} from './terminal-tabs'

describe('terminal tabs', () => {
  it('keeps the active tab when a background tab closes', () => {
    expect(
      getNextTerminalTabIdAfterClose(['one', 'two', 'three'], 'two', 'one')
    ).toBe('two')
  })

  it('selects the tab to the right after the active tab closes', () => {
    expect(
      getNextTerminalTabIdAfterClose(['one', 'two', 'three'], 'two', 'two')
    ).toBe('three')
  })

  it('falls back to the tab on the left when the last tab closes', () => {
    expect(getNextTerminalTabIdAfterClose(['one', 'two'], 'two', 'two')).toBe(
      'one'
    )
  })

  it('returns null after the only tab closes', () => {
    expect(getNextTerminalTabIdAfterClose(['one'], 'one', 'one')).toBeNull()
  })

  it('matches the backend terminal session limit', () => {
    expect(MAX_TERMINAL_TABS).toBe(8)
  })
})
