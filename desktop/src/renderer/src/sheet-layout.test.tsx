// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { Sheet, SheetContent, SheetTitle } from '@skill-shelf/ui'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

describe('scoped non-modal Sheet', () => {
  it('stays inside its workspace without hiding a sibling sidebar', () => {
    const workspace = document.createElement('main')
    const aiSidebar = document.createElement('aside')
    document.body.append(workspace, aiSidebar)

    render(
      createElement(
        Sheet,
        { modal: false, open: true },
        createElement(
          SheetContent,
          {
            overlayMode: 'scoped',
            portalContainer: workspace,
          },
          createElement(SheetTitle, null, 'Skill details')
        )
      )
    )

    expect(workspace.querySelector('[data-slot="sheet-overlay"]')).toBeTruthy()
    expect(workspace.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
    expect(aiSidebar.getAttribute('aria-hidden')).toBeNull()
    expect(aiSidebar.hasAttribute('inert')).toBe(false)
  })
})
