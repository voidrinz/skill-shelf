// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@skill-shelf/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchField, preserveSearchOnEscape } from './search-field'

afterEach(cleanup)

function SearchHarness() {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setQuery(draft.trim())
      }}
    >
      <SearchField
        appliedValue={query}
        label="Search Skills"
        onChange={setDraft}
        onClear={() => {
          setDraft('')
          setQuery('')
        }}
        value={draft}
      />
      <button type="submit">Search</button>
      <output>{query ? `Results for ${query}` : 'All Skills'}</output>
    </form>
  )
}

it.each(['button', 'delete', 'escape'])(
  'restores results immediately when a submitted search is cleared with %s',
  (action) => {
    render(
      <I18nProvider defaultPreference="en">
        <SearchHarness />
      </I18nProvider>
    )
    const input = screen.getByRole('searchbox')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    fireEvent.change(input, { target: { value: 'codex' } })
    expect(screen.getByText('All Skills')).toBeTruthy()
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByText('Results for codex')).toBeTruthy()
    input.focus()
    if (action === 'button') {
      screen.getByRole('button', { name: 'Clear search' }).focus()
      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    } else if (action === 'delete') {
      fireEvent.change(input, { target: { value: '' } })
    } else {
      fireEvent.keyDown(input, { key: 'Escape' })
    }
    expect(screen.getByText('All Skills')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  }
)

it('keeps clearing available when an applied search has an empty draft', () => {
  const onClear = vi.fn()
  render(
    <I18nProvider defaultPreference="en">
      <SearchField
        appliedValue="codex"
        label="Search Skills"
        onChange={vi.fn()}
        onClear={onClear}
        value=""
      />
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(onClear).toHaveBeenCalledOnce()
})

it('clears a focused dialog search on Escape and closes the dialog on the next Escape', () => {
  const onOpenChange = vi.fn()
  render(
    <I18nProvider defaultPreference="en">
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent onEscapeKeyDown={preserveSearchOnEscape}>
          <DialogTitle>Find Skills</DialogTitle>
          <DialogDescription>Choose an installed Skill.</DialogDescription>
          <SearchHarness />
        </DialogContent>
      </Dialog>
    </I18nProvider>
  )
  const input = screen.getByRole('searchbox')
  fireEvent.change(input, { target: { value: 'codex' } })
  fireEvent.submit(input.closest('form')!)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByText('All Skills')).toBeTruthy()
  expect(onOpenChange).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
