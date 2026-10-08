import * as React from 'react'

import { cn } from './lib/cn'

export function Textarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'bg-secondary/75 placeholder:text-muted-foreground focus-visible:border-ring/35 focus-visible:bg-card focus-visible:ring-ring/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20 flex min-h-24 w-full rounded-lg border border-transparent px-3 py-2.5 text-sm shadow-none outline-none transition-[color,border-color,box-shadow,background-color] focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      data-slot="textarea"
      {...props}
    />
  )
}
