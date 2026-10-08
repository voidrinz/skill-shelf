import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@skill-shelf/ui'

type HoverCardDataAttributes = {
  [key: `data-${string}`]: boolean | number | string | undefined
}

export function MouseHoverCard({
  children,
  closeDelay = 140,
  content,
  contentProps,
  openDelay = 550,
}: {
  children: ReactElement
  closeDelay?: number
  content: ReactNode
  contentProps?: ComponentProps<typeof HoverCardContent> &
    HoverCardDataAttributes
  openDelay?: number
}) {
  const [open, setOpen] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  function clearTimer(timerRef: { current: number | null }) {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function clearTimers() {
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
  }

  function closeNow() {
    clearTimers()
    setOpen(false)
  }

  function scheduleOpen(event: ReactPointerEvent) {
    if (event.pointerType === 'touch') return
    clearTimers()
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      setOpen(true)
    }, openDelay)
  }

  function scheduleClose(event: ReactPointerEvent) {
    if (event.pointerType === 'touch') return
    clearTimer(openTimerRef)
    clearTimer(closeTimerRef)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, closeDelay)
  }

  useEffect(
    () => () => {
      clearTimers()
    },
    []
  )

  useEffect(() => {
    if (!open) return
    const closeForWindowChange = () => closeNow()
    const closeForWheel = (event: WheelEvent) => {
      const insideContent = event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            target.dataset.mouseHoverCardContent === 'true'
        )
      if (!insideContent) closeNow()
    }
    window.addEventListener('blur', closeForWindowChange)
    window.addEventListener('wheel', closeForWheel, { capture: true })
    return () => {
      window.removeEventListener('blur', closeForWindowChange)
      window.removeEventListener('wheel', closeForWheel, { capture: true })
    }
  }, [open])

  return (
    <HoverCard open={open}>
      <HoverCardTrigger
        asChild
        onPointerDown={closeNow}
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        {...contentProps}
        data-mouse-hover-card-content="true"
        onEscapeKeyDown={closeNow}
        onPointerDownOutside={closeNow}
        onPointerEnter={scheduleOpen}
        onPointerLeave={scheduleClose}
      >
        {content}
      </HoverCardContent>
    </HoverCard>
  )
}
