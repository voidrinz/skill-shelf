import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { Input, cn } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

// Radix handles Escape in capture phase, before the input can clear its query.
export function preserveSearchOnEscape(event: KeyboardEvent) {
  if (
    event.target instanceof HTMLInputElement &&
    event.target.closest('[data-search-active="true"]')
  ) {
    event.preventDefault()
  }
}

export function SearchField({
  appliedValue = '',
  autoFocus,
  className,
  clearLabel,
  label,
  onChange,
  onClear,
  placeholder,
  value,
}: {
  appliedValue?: string
  autoFocus?: boolean
  className?: string
  clearLabel?: string
  label: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
  value: string
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const canClear = Boolean(value || appliedValue)
  const clearSearchLabel = clearLabel ?? t('common.clearSearch')

  function clearSearch() {
    onClear()
    inputRef.current?.focus()
  }

  return (
    <div
      className={cn('search-control-field', className)}
      data-search-active={canClear}
    >
      <Search aria-hidden="true" />
      <Input
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => {
          const next = event.target.value
          // Empty drafts must also cancel a previously submitted search.
          if (next === '') onClear()
          else onChange(next)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !canClear) return
          event.preventDefault()
          event.stopPropagation()
          clearSearch()
        }}
        placeholder={placeholder ?? label}
        ref={inputRef}
        type="search"
        value={value}
      />
      {canClear ? (
        <button
          aria-label={clearSearchLabel}
          onClick={clearSearch}
          title={clearSearchLabel}
          type="button"
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
