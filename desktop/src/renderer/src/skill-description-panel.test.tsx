// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { I18nProvider } from '@skill-shelf/i18n/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiProviderSettingsStatus,
  InstalledSkill,
} from '../../shared/desktop-contract'
import SkillDescriptionPanel from './skill-description-panel'

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const original =
  'Manage email messages, drafts, contacts and folders from your workspace.'
const translated = '管理工作区中的邮件、草稿、联系人和文件夹。'
const skill: InstalledSkill = {
  id: 'global:lark-mail',
  name: 'lark-mail',
  description: original,
  descriptions: {},
  translations: {},
  groupId: null,
  position: null,
  tags: [],
  agents: ['Codex'],
  installKind: 'directory',
  path: '/tmp/lark-mail',
  scope: 'global',
  updateCheck: { reason: 'not-scanned', status: 'unchecked' },
}
const cached: InstalledSkill = {
  ...skill,
  translations: {
    'zh-CN': {
      content: translated,
      sourceDescription: original,
      method: 'ai',
      translatedAt: '2026-10-09T00:00:00.000Z',
    },
  },
}
const settings = {
  configured: true,
  enabled: true,
  targetLanguage: 'zh-CN',
} as AiProviderSettingsStatus

function setup(
  selected = skill,
  aiSettings: AiProviderSettingsStatus | null = settings
) {
  const onTranslate = vi.fn(() => true)
  const onOpenAiSettings = vi.fn()
  function panel(value: InstalledSkill, translating = false) {
    return (
      <I18nProvider defaultPreference="zh-CN">
        <SkillDescriptionPanel
          onOpenAiSettings={onOpenAiSettings}
          onTranslate={onTranslate}
          settings={aiSettings}
          skill={value}
          translating={translating}
        />
      </I18nProvider>
    )
  }
  const view = render(panel(selected))
  return {
    onTranslate,
    onOpenAiSettings,
    rerender: (value: InstalledSkill, translating = false) =>
      view.rerender(panel(value, translating)),
  }
}

async function openOptions() {
  fireEvent.keyDown(screen.getByRole('button', { name: '翻译选项' }), {
    key: 'ArrowDown',
  })
  return screen.findByRole('menu')
}

describe('compact skill description', () => {
  it('translates with one click and keeps the source readable while waiting for the result', async () => {
    const { onTranslate, rerender } = setup()
    const translate = await screen.findByRole('button', {
      name: '翻译为简体中文',
    })
    expect(screen.getByText(original)).toBeTruthy()
    expect(onTranslate).not.toHaveBeenCalled()
    fireEvent.click(translate)
    expect(onTranslate).toHaveBeenCalledExactlyOnceWith('zh-CN', false)
    rerender(skill, true)
    expect(screen.getByText(original)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '正在翻译…' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: '翻译选项' }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    rerender(cached)
    expect(screen.getByText(translated)).toBeTruthy()
    expect(screen.queryByText(original)).toBeNull()
    expect(screen.getByRole('button', { name: '查看原文' })).toBeTruthy()
  })

  it('opens a saved translation directly and switches to the original without another request', async () => {
    const { onTranslate } = setup(cached)
    const originalButton = await screen.findByRole('button', {
      name: '查看原文',
    })
    expect(screen.getByText(translated)).toBeTruthy()
    fireEvent.click(originalButton)
    expect(screen.getByText(original)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看译文' }))
    expect(screen.getByText(translated)).toBeTruthy()
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('keeps reading the original after selecting an untranslated language until translation is requested', async () => {
    const { onTranslate } = setup(cached)
    await screen.findByRole('button', { name: '查看原文' })
    await openOptions()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '日语' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByText(original)).toBeTruthy()
    expect(onTranslate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '翻译为日语' }))
    expect(onTranslate).toHaveBeenCalledExactlyOnceWith('ja', false)
  })

  it('requests a fresh translation from the options menu even when a saved one exists', async () => {
    const { onTranslate } = setup(cached)
    await screen.findByRole('button', { name: '查看原文' })
    await openOptions()
    fireEvent.click(screen.getByRole('menuitem', { name: '重新翻译' }))
    expect(onTranslate).toHaveBeenCalledExactlyOnceWith('zh-CN', true)
    expect(screen.getByText(translated)).toBeTruthy()
  })

  it.each(['changed source', 'incomplete output'])(
    'shows the source and a compact refresh notice for %s',
    async (reason) => {
      const selected =
        reason === 'changed source'
          ? {
              ...cached,
              description: 'A newer description of the email tools.',
            }
          : {
              ...cached,
              translations: {
                'zh-CN': {
                  ...cached.translations['zh-CN']!,
                  content: '管理邮件、',
                },
              },
            }
      setup(selected)
      await screen.findByRole('button', { name: '翻译为简体中文' })
      expect(screen.getByText(selected.description)).toBeTruthy()
      expect(
        screen.queryByText(selected.translations['zh-CN']!.content)
      ).toBeNull()
      expect(screen.getByRole('status').textContent).toContain('译文需要更新')
    }
  )

  it('opens AI settings directly when translation is not configured', async () => {
    const { onTranslate, onOpenAiSettings } = setup(skill, null)
    fireEvent.click(await screen.findByRole('button', { name: '设置翻译' }))
    expect(onOpenAiSettings).toHaveBeenCalledOnce()
    expect(onTranslate).not.toHaveBeenCalled()
    expect(screen.getByText(original)).toBeTruthy()
  })

  it('does not require translation or copying when the original already matches the reading language', async () => {
    const { onTranslate } = setup({ ...skill, description: translated })
    await screen.findByRole('button', { name: '翻译选项' })
    expect(screen.getByText(translated)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /翻译为/ })).toBeNull()
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('offers no translation controls for an empty description', async () => {
    setup({ ...skill, description: '' })
    await screen.findByText('这个 Skill 没有声明描述。')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lets the reader expand and collapse text that overflows the preview', async () => {
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computedStyle(element)
      if (element instanceof HTMLParagraphElement) style.lineHeight = '20px'
      return style
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200)
    setup()
    const expand = await screen.findByRole('button', { name: '展开描述' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(
      document.getElementById(expand.getAttribute('aria-controls')!)
        ?.textContent
    ).toBe(original)
    fireEvent.click(expand)
    const collapse = screen.getByRole('button', { name: '收起' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(
      screen
        .getByRole('button', { name: '展开描述' })
        .getAttribute('aria-expanded')
    ).toBe('false')
  })
})
