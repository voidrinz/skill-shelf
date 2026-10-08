import * as React from 'react'

import { cn } from './lib/cn'

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-muted text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 font-sans text-[0.625rem] font-medium leading-none [&_svg:not([class*=size-])]:size-3 [&_svg]:shrink-0',
        className
      )}
      data-slot="kbd"
      {...props}
    />
  )
}

export function KbdGroup({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      data-slot="kbd-group"
      {...props}
    />
  )
}
