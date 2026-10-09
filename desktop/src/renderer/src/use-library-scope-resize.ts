import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  clampLibraryScopeWidth,
  DEFAULT_LIBRARY_SCOPE_WIDTH,
  getLibraryScopeWidthBounds,
  LIBRARY_SCOPE_WIDTH_STORAGE_KEY,
} from './library-scope-layout'

function readPreferredWidth() {
  try {
    const stored = window.localStorage.getItem(LIBRARY_SCOPE_WIDTH_STORAGE_KEY)
    const width = stored === null ? Number.NaN : Number(stored)
    return Number.isFinite(width) && width > 0
      ? width
      : DEFAULT_LIBRARY_SCOPE_WIDTH
  } catch {
    return DEFAULT_LIBRARY_SCOPE_WIDTH
  }
}

export function useLibraryScopeResize(collapsed: boolean) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [preferredWidth, setPreferredWidth] = useState(readPreferredWidth)
  const [containerWidth, setContainerWidth] = useState(window.innerWidth)
  const cleanupRef = useRef<(() => void) | null>(null)
  const width = clampLibraryScopeWidth(preferredWidth, containerWidth)
  const bounds = getLibraryScopeWidthBounds(containerWidth)

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const syncWidth = () => setContainerWidth(workspace.clientWidth)
    syncWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncWidth)
      return () => window.removeEventListener('resize', syncWidth)
    }
    const observer = new ResizeObserver(syncWidth)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => cleanupRef.current?.()
  }, [collapsed])

  function commitWidth(requestedWidth: number) {
    const nextWidth = clampLibraryScopeWidth(
      requestedWidth,
      workspaceRef.current?.clientWidth ?? containerWidth
    )
    setPreferredWidth(nextWidth)
    try {
      window.localStorage.setItem(
        LIBRARY_SCOPE_WIDTH_STORAGE_KEY,
        String(nextWidth)
      )
    } catch {
      // Resizing remains available when local storage is disabled.
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const workspace = workspaceRef.current
    if (event.button !== 0 || collapsed || !workspace) return
    event.preventDefault()
    cleanupRef.current?.()
    const startX = event.clientX
    const startWidth = width
    const pointerId = event.pointerId
    let latestWidth = startWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    workspace.dataset.scopeResizing = 'true'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      latestWidth = clampLibraryScopeWidth(
        startWidth + pointerEvent.clientX - startX,
        workspace.clientWidth
      )
      // Update layout directly while dragging instead of rendering the Skill list.
      workspace.style.setProperty('--library-scope-width', `${latestWidth}px`)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      delete workspace.dataset.scopeResizing
      workspace.style.setProperty('--library-scope-width', `${width}px`)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      cleanupRef.current = null
    }
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      move(pointerEvent)
      cleanup()
      commitWidth(latestWidth)
    }
    const cancel = () => cleanup()
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth: number
    switch (event.key) {
      case 'ArrowLeft':
        nextWidth = width - 24
        break
      case 'ArrowRight':
        nextWidth = width + 24
        break
      case 'Home':
        nextWidth = bounds.min
        break
      case 'End':
        nextWidth = bounds.max
        break
      default:
        return
    }
    event.preventDefault()
    commitWidth(nextWidth)
  }

  return {
    bounds,
    handleKeyDown,
    handlePointerDown,
    resetWidth: () => commitWidth(DEFAULT_LIBRARY_SCOPE_WIDTH),
    style: { '--library-scope-width': `${width}px` } as CSSProperties,
    width,
    workspaceRef,
  }
}
