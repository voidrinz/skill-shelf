// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { TooltipProvider } from '@skill-shelf/ui'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type {
  CatalogSnapshot,
  DiscoverySnapshot,
  SkillFileContent,
  SkillFileTree,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import DiscoveryCatalogPanel from './discovery-catalog-panel'
import ProjectsWorkspace from './projects-workspace'
import SkillFilesPanel from './skill-files-panel'

const scrollToDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollTo'
)
afterEach(() => {
  cleanup()
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider defaultPreference="en">
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

it('waits for the project catalog before showing the empty state', () => {
  const props = { onCatalogChange: vi.fn(), onOpenProject: vi.fn() }
  const view = render(<ProjectsWorkspace {...props} catalog={null} />, {
    wrapper: Providers,
  })
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('No projects added')).toBeNull()
  view.rerender(
    <ProjectsWorkspace
      {...props}
      catalog={{ projects: [] } as unknown as CatalogSnapshot}
    />
  )
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('No projects added')).toBeTruthy()
})

it('shows discovery loading again during an initial-load retry and replaces it with data', async () => {
  const retry = deferred<DiscoverySnapshot>()
  const getDiscoverySnapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockReturnValueOnce(retry.promise)
  window.skillShelf = {
    getDiscoverySnapshot,
  } as unknown as SkillShelfDesktopApi
  render(
    <DiscoveryCatalogPanel
      catalog={null}
      onInstall={vi.fn()}
      section="official"
    />,
    { wrapper: Providers }
  )
  expect(screen.getByRole('status')).toBeTruthy()
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () =>
    retry.resolve({
      section: 'official',
      sources: [],
      fetchedAt: new Date().toISOString(),
      sourceUrl: 'https://skills.sh',
      stale: false,
    })
  )
  expect(screen.queryByRole('status')).toBeNull()
  expect(getDiscoverySnapshot).toHaveBeenLastCalledWith('official', true)
})

it('keeps discovered skills visible during a refresh', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  })
  const refresh = deferred<DiscoverySnapshot>()
  const snapshot: DiscoverySnapshot = {
    section: 'home',
    fetchedAt: new Date().toISOString(),
    sourceUrl: 'https://skills.sh',
    stale: false,
    collections: [
      {
        id: 'trending',
        skills: [
          {
            name: 'example-skill',
            repo: 'example/skills',
            displayRepo: 'example/skills',
            url: 'https://skills.sh/example/skills/example-skill',
          },
        ],
      },
    ],
  }
  window.skillShelf = {
    getDiscoverySnapshot: vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(refresh.promise),
  } as unknown as SkillShelfDesktopApi
  render(
    <DiscoveryCatalogPanel catalog={null} onInstall={vi.fn()} section="home" />,
    { wrapper: Providers }
  )
  await screen.findByText('example-skill')
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh discovery data' })
  )
  expect(screen.getByText('example-skill')).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  await act(async () => refresh.resolve(snapshot))
})

it('replaces the file browser skeleton with the tree, then replaces the preview skeleton with content', async () => {
  const tree = deferred<SkillFileTree>()
  const file = deferred<SkillFileContent>()
  window.skillShelf = {
    getSkillFiles: vi.fn(() => tree.promise),
    readSkillFile: vi.fn(() => file.promise),
  } as unknown as SkillShelfDesktopApi
  render(<SkillFilesPanel skillId="example" />, { wrapper: Providers })
  expect(
    screen.getByRole('status', { name: 'Reading skill files' })
  ).toBeTruthy()
  await act(async () =>
    tree.resolve({
      entries: [{ kind: 'file', name: 'SKILL.md', path: 'SKILL.md' }],
      fileCount: 1,
      truncated: false,
    })
  )
  expect(screen.getByRole('tree')).toBeTruthy()
  expect(
    screen.queryByRole('status', { name: 'Reading skill files' })
  ).toBeNull()
  expect(screen.getByRole('status', { name: 'Opening file' })).toBeTruthy()
  await act(async () =>
    file.resolve({
      name: 'SKILL.md',
      path: 'SKILL.md',
      language: 'markdown',
      previewKind: 'text',
      size: 12,
      content: '# Example skill',
    })
  )
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Example skill' })).toBeTruthy()
})
