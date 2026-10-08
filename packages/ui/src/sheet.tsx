import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/cn'

const sheetOverlayClassName =
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/25 backdrop-blur-[1px] motion-reduce:animate-none dark:bg-black/55'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close
export const SheetPortal = DialogPrimitive.Portal

export function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(sheetOverlayClassName, className)}
      data-slot="sheet-overlay"
      {...props}
    />
  )
}

const sideClasses = {
  bottom:
    'inset-x-0 bottom-0 max-h-[90vh] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
  right:
    'inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
  top: 'inset-x-0 top-0 max-h-[90vh] border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
} as const

export function SheetContent({
  children,
  className,
  closeLabel = 'Close',
  overlayMode = 'modal',
  overlayClassName,
  portalContainer,
  showCloseButton = true,
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeLabel?: string
  overlayMode?: 'modal' | 'none' | 'scoped'
  overlayClassName?: string
  portalContainer?: HTMLElement | null
  showCloseButton?: boolean
  side?: keyof typeof sideClasses
}) {
  return (
    <SheetPortal container={portalContainer ?? undefined}>
      {overlayMode === 'modal' ? (
        <SheetOverlay className={overlayClassName} />
      ) : overlayMode === 'scoped' ? (
        <div
          aria-hidden="true"
          className={cn(sheetOverlayClassName, overlayClassName)}
          data-slot="sheet-overlay"
          data-state="open"
        />
      ) : null}
      <DialogPrimitive.Content
        className={cn(
          'bg-card data-[state=closed]:animate-out data-[state=open]:animate-in fixed z-50 flex flex-col gap-4 overflow-hidden p-5 shadow-[var(--ss-shadow-menu)] duration-200 ease-out motion-reduce:animate-none',
          sideClasses[side],
          className
        )}
        data-slot="sheet-content"
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2">
            <X className="size-4" />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
}

export function SheetHeader({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 text-left', className)}
      data-slot="sheet-header"
      {...props}
    />
  )
}

export function SheetFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-auto flex flex-col-reverse gap-2 sm:flex-row',
        className
      )}
      data-slot="sheet-footer"
      {...props}
    />
  )
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold leading-tight', className)}
      data-slot="sheet-title"
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm leading-relaxed', className)}
      data-slot="sheet-description"
      {...props}
    />
  )
}
