import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ContextMenuTrigger, cn } from '@skill-shelf/ui'
import type { CanvasPosition } from '../../shared/desktop-contract'
import {
  getDraggedCanvasPosition,
  getGroupedCanvasPositions,
} from './finder-interactions'

export type FinderCanvasItemKey = `folder:${string}` | `skill:${string}`
export interface FinderCanvasDragItem {
  key: FinderCanvasItemKey
  position: CanvasPosition
}

export function FinderCanvasItem({
  canvasRef,
  children,
  dragItems,
  draggable = true,
  itemKey,
  kind,
  onDrop,
  onDragStart,
  onContextSelect,
  onOpen,
  onSelect,
  position,
  selected = false,
}: {
  canvasRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  dragItems: FinderCanvasDragItem[]
  draggable?: boolean
  itemKey: FinderCanvasItemKey
  kind: 'folder' | 'skill'
  onDrop: (folderId: string | null, items: FinderCanvasDragItem[]) => boolean
  onDragStart: (items: FinderCanvasDragItem[]) => void
  onContextSelect: () => void
  onOpen?: () => void
  onSelect: (event: ReactMouseEvent<HTMLDivElement>) => void
  position: CanvasPosition
  selected?: boolean
}) {
  const itemRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    lastItems: FinderCanvasDragItem[]
    members: Array<{
      element: HTMLElement
      key: FinderCanvasItemKey
      origin: CanvasPosition
    }>
    moved: boolean
    origin: CanvasPosition
    pointerId: number
    startX: number
    startY: number
    target: HTMLElement | null
  } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    if (!itemRef.current || dragRef.current) return
    itemRef.current.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`
  }, [position.x, position.y])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable || !event.isPrimary || event.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const elements = new Map(
      [...canvas.querySelectorAll<HTMLElement>('[data-finder-item-key]')].map(
        (element) => [element.dataset.finderItemKey, element]
      )
    )
    const members = dragItems.flatMap((item) => {
      const element = elements.get(item.key)
      return element ? [{ element, key: item.key, origin: item.position }] : []
    })
    dragRef.current = {
      lastItems: dragItems,
      members,
      moved: false,
      origin: position,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const canvas = canvasRef.current
    const item = itemRef.current
    if (!drag || !canvas || !item || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return
    if (!drag.moved) {
      drag.moved = true
      onDragStart(drag.lastItems)
    }
    for (const member of drag.members) {
      member.element.dataset.dragging =
        member.key === itemKey ? 'active' : 'group'
      member.element.style.pointerEvents = 'none'
    }
    const nextAnchorPosition = getDraggedCanvasPosition(
      drag.origin,
      { x: drag.startX, y: drag.startY },
      { x: event.clientX, y: event.clientY }
    )
    drag.lastItems = getGroupedCanvasPositions(
      drag.members.map((member) => ({
        key: member.key,
        position: member.origin,
      })),
      itemKey,
      nextAnchorPosition
    )
    for (const next of drag.lastItems) {
      const member = drag.members.find((item) => item.key === next.key)
      if (member) {
        member.element.style.transform = `translate3d(${next.position.x}px, ${next.position.y}px, 0)`
      }
    }
    const hit = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-finder-folder-id]')
    const hitKey = hit?.dataset.finderFolderId
      ? (`folder:${hit.dataset.finderFolderId}` as const)
      : null
    const target =
      hitKey && drag.lastItems.some((dragItem) => dragItem.key === hitKey)
        ? null
        : (hit ?? null)
    if (drag.target !== target) {
      drag.target?.removeAttribute('data-drop-target')
      target?.setAttribute('data-drop-target', 'true')
      drag.target = target
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const canvas = canvasRef.current
    const item = itemRef.current
    if (!drag || !canvas || !item || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    drag.target?.removeAttribute('data-drop-target')
    for (const member of drag.members) {
      member.element.removeAttribute('data-dragging')
      member.element.style.removeProperty('pointer-events')
    }
    if (!drag.moved) return
    suppressClick.current = true
    const accepted = onDrop(
      drag.target?.dataset.finderFolderId ?? null,
      drag.lastItems
    )
    if (!accepted) {
      for (const member of drag.members) {
        member.element.style.transform = `translate3d(${member.origin.x}px, ${member.origin.y}px, 0)`
      }
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const item = itemRef.current
    if (!drag || !item || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    drag.target?.removeAttribute('data-drop-target')
    for (const member of drag.members) {
      member.element.removeAttribute('data-dragging')
      member.element.style.removeProperty('pointer-events')
      member.element.style.transform = `translate3d(${member.origin.x}px, ${member.origin.y}px, 0)`
    }
  }

  return (
    <ContextMenuTrigger asChild>
      <div
        className={cn('finder-canvas-item', selected && 'is-selected')}
        data-finder-item-key={itemKey}
        data-finder-item-kind={kind}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault()
            event.stopPropagation()
            suppressClick.current = false
            return
          }
          onSelect(event)
        }}
        onContextMenu={(event) => {
          event.stopPropagation()
          onContextSelect()
        }}
        onDoubleClick={onOpen}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={itemRef}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
      >
        {children}
      </div>
    </ContextMenuTrigger>
  )
}
