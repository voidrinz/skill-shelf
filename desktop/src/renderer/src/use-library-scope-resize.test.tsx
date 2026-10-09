// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LIBRARY_SCOPE_WIDTH_STORAGE_KEY } from './library-scope-layout'
import { useLibraryScopeResize } from './use-library-scope-resize'

let containerWidth = 900
let notifyResize: () => void

function ResizeHarness({ collapsed = false }: { collapsed?: boolean }) {
  const resize = useLibraryScopeResize(collapsed)
  return (
    <div data-testid="workspace" ref={resize.workspaceRef} style={resize.style}>
      {!collapsed ? (
        <div
          aria-valuenow={resize.width}
          onDoubleClick={resize.resetWidth}
          onKeyDown={resize.handleKeyDown}
          onPointerDown={resize.handlePointerDown}
          role="separator"
          tabIndex={0}
        />
      ) : null}
    </div>
  )
}

beforeEach(() => {
  containerWidth = 900
  window.localStorage.clear()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => containerWidth
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notifyResize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      readonly pointerId: number
      constructor(type: string, init: PointerEventInit) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
      }
    }
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('drags the left sidebar wider, saves on release, and restores after reopening', () => {
  const { unmount } = render(<ResizeHarness />)
  const workspace = screen.getByTestId('workspace')
  fireEvent.pointerDown(screen.getByRole('separator'), {
    button: 0,
    clientX: 200,
    pointerId: 1,
  })
  fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 })
  expect(workspace.style.getPropertyValue('--library-scope-width')).toBe(
    '300px'
  )
  expect(
    window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)
  ).toBeNull()
  fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 })
  expect(window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)).toBe(
    '300'
  )
  expect(document.body.style.cursor).toBe('')
  unmount()
  render(<ResizeHarness />)
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '300'
  )
})

it('limits the width on smaller workspaces and restores the preferred width when space returns', () => {
  window.localStorage.setItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY, '340')
  render(<ResizeHarness />)
  containerWidth = 550
  act(() => notifyResize())
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '220'
  )
  expect(window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)).toBe(
    '340'
  )
  containerWidth = 900
  act(() => notifyResize())
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '340'
  )
})

it('supports keyboard resizing, bounds, and double-click reset', () => {
  render(<ResizeHarness />)
  const separator = screen.getByRole('separator')
  fireEvent.keyDown(separator, { key: 'ArrowRight' })
  expect(separator.getAttribute('aria-valuenow')).toBe('224')
  fireEvent.keyDown(separator, { key: 'End' })
  expect(separator.getAttribute('aria-valuenow')).toBe('360')
  fireEvent.keyDown(separator, { key: 'Home' })
  expect(separator.getAttribute('aria-valuenow')).toBe('180')
  fireEvent.doubleClick(separator)
  expect(separator.getAttribute('aria-valuenow')).toBe('200')
})

it('keeps space for content even when dragged far beyond the sidebar limits', () => {
  containerWidth = 600
  render(<ResizeHarness />)
  fireEvent.pointerDown(screen.getByRole('separator'), {
    button: 0,
    clientX: 200,
  })
  fireEvent.pointerMove(window, { clientX: 900 })
  fireEvent.pointerUp(window, { clientX: 900 })
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '240'
  )
})

it('falls back to the default when a saved width is invalid', () => {
  window.localStorage.setItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY, 'invalid')
  render(<ResizeHarness />)
  expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe(
    '200'
  )
})

it('cancels an interrupted drag without saving it or leaving the cursor locked', () => {
  render(<ResizeHarness />)
  document.body.style.cursor = 'default'
  fireEvent.pointerDown(screen.getByRole('separator'), {
    button: 0,
    clientX: 200,
  })
  fireEvent.pointerMove(window, { clientX: 310 })
  fireEvent.pointerCancel(window)
  expect(
    screen
      .getByTestId('workspace')
      .style.getPropertyValue('--library-scope-width')
  ).toBe('200px')
  expect(
    window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)
  ).toBeNull()
  expect(document.body.style.cursor).toBe('default')
  document.body.style.cursor = ''
})

it('cleans up an in-progress drag when collapsed or unmounted', () => {
  const { rerender, unmount } = render(<ResizeHarness />)
  fireEvent.pointerDown(screen.getByRole('separator'), {
    button: 0,
    clientX: 200,
  })
  rerender(<ResizeHarness collapsed />)
  expect(document.body.style.userSelect).toBe('')
  fireEvent.pointerMove(window, { clientX: 330 })
  expect(
    screen
      .getByTestId('workspace')
      .style.getPropertyValue('--library-scope-width')
  ).toBe('200px')
  rerender(<ResizeHarness />)
  fireEvent.pointerDown(screen.getByRole('separator'), {
    button: 0,
    clientX: 200,
  })
  unmount()
  expect(document.body.style.cursor).toBe('')
})
