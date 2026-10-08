import * as React from 'react'

import { cn } from './lib/cn'

export interface PageHeaderProps extends Omit<
  React.ComponentProps<'header'>,
  'title'
> {
  actions?: React.ReactNode
  description?: React.ReactNode
  eyebrow: React.ReactNode
  title: React.ReactNode
}

export function PageHeader({
  actions,
  children,
  className,
  description,
  eyebrow,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        'grid gap-5 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start',
        className
      )}
      {...props}
    >
      <div className="min-w-0" data-slot="page-header-heading">
        <p
          className="text-muted-foreground font-mono text-xs leading-4"
          data-slot="page-header-eyebrow"
        >
          {eyebrow}
        </p>
        <h1 className="mt-1.5 text-balance text-2xl font-semibold leading-8 tracking-[-0.035em]">
          {title}
        </h1>
        {description ? (
          <p
            className="text-muted-foreground mt-1.5 max-w-3xl text-sm leading-6"
            data-slot="page-header-description"
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 items-center gap-2 sm:pt-0.5"
          data-slot="page-header-actions"
        >
          {actions}
        </div>
      ) : null}
      {children ? (
        <div className="sm:col-span-2" data-slot="page-header-content">
          {children}
        </div>
      ) : null}
    </header>
  )
}

export interface SectionHeaderProps extends Omit<
  React.ComponentProps<'header'>,
  'title'
> {
  actions?: React.ReactNode
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  title: React.ReactNode
}

export function SectionHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
  ...props
}: SectionHeaderProps) {
  return (
    <header
      data-slot="section-header"
      className={cn('flex items-start justify-between gap-4', className)}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-muted-foreground font-mono text-xs leading-4">
            {eyebrow}
          </p>
        ) : null}
        <h2
          className={cn(
            'text-lg font-semibold leading-7 tracking-[-0.025em]',
            eyebrow && 'mt-1'
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-3xl text-sm leading-6">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export function Toolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        'bg-card flex min-h-11 flex-wrap items-center gap-2 rounded-xl p-2',
        className
      )}
      {...props}
    />
  )
}

export interface NavItemProps extends React.ComponentProps<'button'> {
  active?: boolean
  icon?: React.ReactNode
  tone?: 'brand' | 'neutral'
  trailing?: React.ReactNode
}

export function NavItem({
  active = false,
  children,
  className,
  icon,
  tone = 'brand',
  trailing,
  ...props
}: NavItemProps) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      data-active={active ? '' : undefined}
      data-slot="nav-item"
      data-tone={tone}
      className={cn(
        'focus-visible:ring-ring focus-visible:ring-offset-sidebar flex h-10 w-full shrink-0 items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        active
          ? tone === 'neutral'
            ? 'text-foreground bg-[var(--ss-nav-active)]'
            : 'bg-sidebar-primary text-sidebar-primary-foreground'
          : tone === 'neutral'
            ? 'text-foreground hover:bg-[var(--ss-nav-hover)]'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        className
      )}
      type="button"
      {...props}
    >
      {icon ? (
        <span
          className="grid shrink-0 place-items-center"
          data-slot="nav-item-icon"
        >
          {icon}
        </span>
      ) : null}
      {children !== null && children !== undefined ? (
        <span className="min-w-0 flex-1 truncate" data-slot="nav-item-label">
          {children}
        </span>
      ) : null}
      {trailing ? (
        <span
          className="ml-auto shrink-0 font-mono text-[0.68rem] opacity-75"
          data-slot="nav-item-trailing"
        >
          {trailing}
        </span>
      ) : null}
    </button>
  )
}
