import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'

import { cn } from './lib/cn'

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'bg-input shadow-xs data-[state=checked]:bg-primary focus-visible:ring-3 focus-visible:ring-ring/40 peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-background pointer-events-none block size-4 rounded-full shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}
