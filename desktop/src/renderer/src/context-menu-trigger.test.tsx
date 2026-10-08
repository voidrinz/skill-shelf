// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@skill-shelf/ui'
import { describe, expect, it, vi } from 'vitest'

describe('nested Finder context menus', () => {
  it('opens the item menu without falling through to the canvas menu', () => {
    const canvasPointerDown = vi.fn()
    const itemPointerDown = vi.fn()
    const rename = vi.fn()
    render(
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onPointerDown={canvasPointerDown}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  onContextMenu={(event) => event.stopPropagation()}
                  onPointerDown={itemPointerDown}
                >
                  <button type="button">Folder</button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                onPointerDown={(event) => event.stopPropagation()}
              >
                <ContextMenuItem onSelect={rename}>
                  Rename folder
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>New folder</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Folder' }), {
      clientX: 80,
      clientY: 60,
    })

    const renameItem = screen.getByText('Rename folder')
    expect(renameItem).toBeTruthy()
    expect(screen.queryByText('New folder')).toBeNull()
    fireEvent.pointerDown(renameItem)
    fireEvent.click(renameItem)
    expect(canvasPointerDown).not.toHaveBeenCalled()
    expect(itemPointerDown).not.toHaveBeenCalled()
    expect(rename).toHaveBeenCalledOnce()
  })

  it('uses one leading slot for an unchecked icon or checked indicator', () => {
    const { rerender } = render(
      <ContextMenu>
        <ContextMenuTrigger>Open</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={false}
            icon={<span data-testid="group-icon" />}
          >
            Use groups
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('Open'))
    const uncheckedItem = screen.getByRole('menuitemcheckbox')
    expect(
      uncheckedItem.firstElementChild?.contains(
        screen.getByTestId('group-icon')
      )
    ).toBe(true)

    rerender(
      <ContextMenu>
        <ContextMenuTrigger>Open</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked
            icon={<span data-testid="group-icon" />}
          >
            Use groups
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    expect(screen.queryByTestId('group-icon')).toBeNull()
    expect(
      screen.getByRole('menuitemcheckbox').getAttribute('data-state')
    ).toBe('checked')
  })
})
