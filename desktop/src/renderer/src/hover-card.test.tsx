// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MouseHoverCard } from './mouse-hover-card'

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('mouse-only Skill Hover Card', () => {
  it('opens only from its explicit information trigger', () => {
    vi.useFakeTimers()
    render(
      <div>
        <span>Skill item body</span>
        <MouseHoverCard content="Description preview" openDelay={320}>
          <button type="button">Skill information</button>
        </MouseHoverCard>
      </div>
    )

    fireEvent.pointerEnter(screen.getByText('Skill item body'), {
      pointerType: 'mouse',
    })
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByText('Description preview')).toBeNull()

    fireEvent.pointerEnter(
      screen.getByRole('button', { name: 'Skill information' }),
      { pointerType: 'mouse' }
    )
    act(() => vi.advanceTimersByTime(320))
    expect(screen.getByText('Description preview')).toBeTruthy()
  })

  it('ignores retained button focus and opens only after mouse hover', () => {
    vi.useFakeTimers()
    render(
      <MouseHoverCard content="Description preview">
        <button type="button">Example Skill</button>
      </MouseHoverCard>
    )

    const trigger = screen.getByRole('button', { name: 'Example Skill' })
    fireEvent.focus(trigger)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByText('Description preview')).toBeNull()

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(549))
    expect(screen.queryByText('Description preview')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('Description preview')).toBeTruthy()
  })

  it('closes after the pointer leaves and immediately when the window blurs', () => {
    vi.useFakeTimers()
    render(
      <MouseHoverCard content="Description preview">
        <button type="button">Example Skill</button>
      </MouseHoverCard>
    )

    const trigger = screen.getByRole('button', { name: 'Example Skill' })
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(550))
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(139))
    expect(screen.getByText('Description preview')).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByText('Description preview')).toBeNull()

    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(550))
    fireEvent.blur(window)
    expect(screen.queryByText('Description preview')).toBeNull()
  })
})
