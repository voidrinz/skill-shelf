import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from './lib/cn'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-semibold outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 [&_svg]:shrink-0 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default:
          'border border-transparent bg-primary text-primary-foreground hover:bg-[var(--ss-accent-strong)]',
        primary:
          'border border-transparent bg-primary text-primary-foreground hover:bg-[var(--ss-accent-strong)]',
        destructive:
          'border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/85 focus-visible:ring-destructive',
        danger:
          'border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/85 focus-visible:ring-destructive',
        outline:
          'border border-input bg-card text-foreground hover:border-transparent hover:bg-accent',
        secondary:
          'border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost:
          'border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-[var(--ss-link)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5 py-2 has-[>svg]:px-3',
        md: 'h-9 px-3.5 py-2 has-[>svg]:px-3',
        xs: 'h-7 gap-1 rounded-md px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*="size-"])]:size-3',
        sm: 'h-8 gap-1 px-3 text-xs has-[>svg]:px-2.5',
        lg: 'h-11 px-5 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: { size: 'default', variant: 'default' },
  }
)

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({
  asChild = false,
  className,
  size,
  type,
  variant,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ size, variant }), className)}
      data-slot="button"
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    />
  )
}

export { buttonVariants }
