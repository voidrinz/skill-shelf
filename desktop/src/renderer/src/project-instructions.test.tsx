// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  CatalogProject,
  ProjectInstructions,
  SaveProjectInstructionInput,
  SkillShelfDesktopApi,
} from '../../shared/desktop-contract'
import { ProjectInstructionsButton } from './project-instructions'

afterEach(cleanup)

const project: CatalogProject = {
  id: 'demo',
  name: 'Demo project',
  path: '/home/demo/project',
  addedAt: '',
  skillCount: 0,
}

function snapshot(
  agents = '# Shared rules',
  claude = '# Claude rules'
): ProjectInstructions {
  return {
    projectId: project.id,
    projectPath: project.path,
    files: {
      'AGENTS.md': {
        name: 'AGENTS.md',
        content: agents,
        exists: Boolean(agents),
        readOnly: false,
        revision: agents ? 'agents-revision' : null,
      },
      'CLAUDE.md': {
        name: 'CLAUDE.md',
        content: claude,
        exists: Boolean(claude),
        readOnly: false,
        revision: claude ? 'claude-revision' : null,
      },
    },
    claudeUsesAgents: false,
  }
}

function setup(initial = snapshot()) {
  const api = {
    getProjectInstructions: vi.fn(async () => initial),
    saveProjectInstruction: vi.fn(
      async (input: SaveProjectInstructionInput) => ({
        ...initial,
        files: {
          ...initial.files,
          [input.name]: {
            ...initial.files[input.name],
            content: input.content,
            exists: true,
            revision: 'saved-revision',
          },
        },
      })
    ),
    connectProjectClaude: vi.fn(async () => ({
      ...initial,
      files: {
        ...initial.files,
        'CLAUDE.md': {
          ...initial.files['CLAUDE.md'],
          content: initial.files['CLAUDE.md'].content + '\n\n@AGENTS.md\n',
          exists: true,
          revision: 'connected-revision',
        },
      },
      claudeUsesAgents: true,
    })),
  }
  window.skillShelf = api as unknown as SkillShelfDesktopApi
  render(
    <I18nProvider defaultPreference="en">
      <ProjectInstructionsButton project={project} />
    </I18nProvider>
  )
  return api
}

async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Project instructions' }))
  await waitFor(() =>
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Edit AGENTS.md',
        }) as HTMLTextAreaElement
      ).disabled
    ).toBe(false)
  )
}

function switchFile(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), {
    button: 0,
    ctrlKey: false,
  })
}

it('only reads files when the editor opens and never writes on open', async () => {
  const api = setup()
  expect(api.getProjectInstructions).not.toHaveBeenCalled()
  await openEditor()
  expect(api.getProjectInstructions).toHaveBeenCalledWith('demo')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# Shared rules'
  )
  expect(api.saveProjectInstruction).not.toHaveBeenCalled()
  expect(api.connectProjectClaude).not.toHaveBeenCalled()
})

it('saves the selected file by revision and preserves the other tab draft', async () => {
  const api = setup()
  await openEditor()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# New shared rules' },
  })
  switchFile('CLAUDE.md')
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# Unsaved Claude draft' },
  })
  switchFile('AGENTS.md')
  fireEvent.click(screen.getByRole('button', { name: 'Save AGENTS.md' }))
  await waitFor(() =>
    expect(
      (screen.getByRole('tab', { name: 'CLAUDE.md' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  expect(api.saveProjectInstruction).toHaveBeenCalledWith({
    projectId: 'demo',
    name: 'AGENTS.md',
    content: '# New shared rules',
    expectedRevision: 'agents-revision',
  })
  switchFile('CLAUDE.md')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# Unsaved Claude draft'
  )
  expect(screen.getByText('Unsaved changes')).toBeTruthy()
})

it('connects Claude only by explicit action and shows the saved import', async () => {
  const api = setup()
  await openEditor()
  fireEvent.click(screen.getByRole('button', { name: 'Connect Claude' }))
  await screen.findByText('Connected')
  expect(api.connectProjectClaude).toHaveBeenCalledWith({
    projectId: 'demo',
    expectedRevision: 'claude-revision',
  })
  switchFile('CLAUDE.md')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# Claude rules\n\n@AGENTS.md\n'
  )
})

it('requires saving shared instructions before connecting and disables connection with any dirty draft', async () => {
  const api = setup(snapshot('', ''))
  await openEditor()
  const connect = () =>
    screen.getByRole('button', { name: 'Connect Claude' }) as HTMLButtonElement
  expect(connect().disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# Project rules' },
  })
  expect(connect().disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save AGENTS.md' }))
  await waitFor(() => expect(connect().disabled).toBe(false))
  switchFile('CLAUDE.md')
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# Local draft' },
  })
  expect(connect().disabled).toBe(true)
  expect(api.connectProjectClaude).not.toHaveBeenCalled()
})

it('keeps the draft and displays a conflict when the file changes externally', async () => {
  const api = setup()
  api.saveProjectInstruction.mockRejectedValueOnce(
    new Error('Project instructions changed externally')
  )
  await openEditor()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# My draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save AGENTS.md' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Your draft is preserved'
  )
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# My draft'
  )
})

it('requires an explicit discard before closing with unsaved changes', async () => {
  setup()
  await openEditor()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# My draft' },
  })
  fireEvent.click(
    within(screen.getByRole('dialog')).getAllByRole('button', {
      name: 'Close',
    })[0]!
  )
  expect(screen.getByRole('alert').textContent).toContain(
    'Discard your unsaved changes'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# My draft'
  )
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('allows retrying a failed initial read', async () => {
  const api = setup()
  api.getProjectInstructions.mockRejectedValueOnce(
    new Error('Permission denied')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Project instructions' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not read or save'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reload files' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(
      false
    )
  )
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# Shared rules'
  )
})

it('shows protected instructions as selectable text and permits editing the other file', async () => {
  const initial = snapshot()
  initial.files['AGENTS.md'].readOnly = true
  setup(initial)
  fireEvent.click(screen.getByRole('button', { name: 'Project instructions' }))
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(
      false
    )
  )
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(
    true
  )
  expect(
    (
      screen.getByRole('button', {
        name: 'Save AGENTS.md',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  switchFile('CLAUDE.md')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(
    false
  )
})

it('keeps the dialog open while a save is running', async () => {
  const api = setup()
  let complete!: (result: ProjectInstructions) => void
  api.saveProjectInstruction.mockImplementationOnce(
    () =>
      new Promise<ProjectInstructions>((resolve) => {
        complete = resolve
      })
  )
  await openEditor()
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: '# Pending save' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save AGENTS.md' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
  complete(snapshot('# Pending save'))
  await waitFor(() =>
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(
      false
    )
  )
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    '# Pending save'
  )
})
