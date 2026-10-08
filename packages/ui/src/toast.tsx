import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/cn'

type ToastTone = 'error' | 'info' | 'success' | 'warning'

export interface ToastOptions {
  duration?: number
  title?: React.ReactNode
}

interface ToastEntry extends ToastOptions {
  description: React.ReactNode
  id: number
  tone: ToastTone
}

let nextToastId = 0
const listeners = new Set<(entry: ToastEntry) => void>()

function addToast(
  tone: ToastTone,
  description: React.ReactNode,
  options?: ToastOptions
) {
  const entry: ToastEntry = { description, id: ++nextToastId, tone, ...options }
  listeners.forEach((listener) => listener(entry))
  return entry.id
}

export const toast = {
  error: (description: React.ReactNode, options?: ToastOptions) =>
    addToast('error', description, options),
  info: (description: React.ReactNode, options?: ToastOptions) =>
    addToast('info', description, options),
  success: (description: React.ReactNode, options?: ToastOptions) =>
    addToast('success', description, options),
  warning: (description: React.ReactNode, options?: ToastOptions) =>
    addToast('warning', description, options),
}

export function Toaster({
  dismissLabel = 'Dismiss notification',
  label = 'Notifications',
  limit = 3,
}: {
  dismissLabel?: string
  label?: string
  limit?: number
}) {
  const [items, setItems] = React.useState<ToastEntry[]>([])

  React.useEffect(() => {
    const listener = (entry: ToastEntry) => {
      setItems((current) => [...current, entry].slice(-limit))
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== entry.id))
      }, entry.duration ?? 4000)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [limit])

  return (
    <div
      className="pointer-events-none fixed inset-x-4 top-4 z-[100] mx-auto grid w-auto max-w-sm gap-2 sm:w-full"
      role="region"
      aria-label={label}
    >
      {items.map((item) => (
        <div
          className="border-border/70 bg-popover text-popover-foreground animate-in fade-in slide-in-from-top-2 pointer-events-auto flex min-h-12 items-center gap-2.5 rounded-xl border px-3.5 py-3 shadow-[var(--ss-shadow-menu)]"
          key={item.id}
          role="status"
        >
          <ToastIcon tone={item.tone} />
          <div className="min-w-0 flex-1 text-[0.8125rem] leading-5">
            {item.title ? (
              <strong className="block font-semibold">{item.title}</strong>
            ) : null}
            <div className={cn(item.title && 'text-muted-foreground')}>
              {item.description}
            </div>
          </div>
          <button
            aria-label={dismissLabel}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
            onClick={() =>
              setItems((current) =>
                current.filter((entry) => entry.id !== item.id)
              )
            }
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  const Icon =
    tone === 'success'
      ? CircleCheck
      : tone === 'error'
        ? CircleX
        : tone === 'warning'
          ? TriangleAlert
          : Info
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full [&_svg]:size-3.5',
        tone === 'success' &&
          'bg-[var(--ss-success-soft)] text-[var(--ss-success)]',
        tone === 'error' && 'bg-[var(--ss-red-soft)] text-[var(--ss-red)]',
        tone === 'warning' &&
          'bg-[var(--ss-amber-soft)] text-[var(--ss-amber)]',
        tone === 'info' && 'bg-secondary text-[var(--chart-2)]'
      )}
    >
      <Icon />
    </span>
  )
}
