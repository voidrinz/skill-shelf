import * as React from 'react'

import { cn } from './lib/cn'

export function Input({
  className,
  type,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'bg-secondary/75 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex h-9 w-full min-w-0 rounded-lg border border-transparent px-3 py-1.5 text-base shadow-none outline-none transition-[color,border-color,box-shadow,background-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring/35 focus-visible:bg-card focus-visible:ring-ring/20 focus-visible:ring-2',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  )
}
