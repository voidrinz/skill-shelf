import type { HTMLAttributes } from 'react'

import { brandMark } from './brand-mark'
import { cn } from './lib/cn'

export interface BrandProps extends HTMLAttributes<HTMLDivElement> {
  compact?: boolean
}

export function Brand({ className, compact = false, ...props }: BrandProps) {
  return (
    <div className={cn('ss-brand', className)} {...props}>
      <svg
        aria-hidden="true"
        className="ss-brand__mark"
        focusable="false"
        viewBox={`0 0 ${brandMark.size} ${brandMark.size}`}
      >
        <rect
          fill="var(--ss-ink-strong)"
          height={brandMark.size}
          rx={brandMark.radius}
          width={brandMark.size}
        />
        {brandMark.books.map((book) => (
          <path
            d={book.path}
            fill={book.color === 'accent' ? 'var(--primary)' : 'var(--ss-card)'}
            key={book.path}
          />
        ))}
      </svg>
      {compact ? null : (
        <span className="ss-brand__wordmark">
          <strong>Skill</strong> Shelf
        </span>
      )}
    </div>
  )
}
