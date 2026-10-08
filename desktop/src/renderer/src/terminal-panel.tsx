import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Eraser, Plus, RotateCcw, SquareTerminal, X } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import { getLocalizedErrorMessage } from './localized-error'
import {
  MAX_TERMINAL_TABS,
  getNextTerminalTabIdAfterClose,
} from './terminal-tabs'

interface TerminalPanelProps {
  open: boolean
  onClose: () => void
  projectId?: string
}

type TerminalPhase = 'error' | 'exited' | 'ready' | 'starting'

interface TerminalTabDefinition {
  id: string
  projectId?: string
}

interface TerminalTabStatus {
  phase: TerminalPhase
  restarting: boolean
  shell: string | null
}

interface TerminalTabHandle {
  clear: () => void
  focus: () => void
  restart: () => Promise<void>
}

const STARTING_STATUS: TerminalTabStatus = {
  phase: 'starting',
  restarting: false,
  shell: null,
}

export default function TerminalPanel({
  open,
  onClose,
  projectId,
}: TerminalPanelProps) {
  const { t } = useI18n()
  const [tabs, setTabs] = useState<TerminalTabDefinition[]>(() => [
    createTerminalTab(projectId),
  ])
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => tabs[0]?.id ?? null
  )
  const [tabStatuses, setTabStatuses] = useState<
    Record<string, TerminalTabStatus>
  >({})
  const tabHandlesRef = useRef(new Map<string, TerminalTabHandle>())
  const activeStatus = activeTabId
    ? (tabStatuses[activeTabId] ?? STARTING_STATUS)
    : null

  const registerTabHandle = useCallback(
    (tabId: string, handle: TerminalTabHandle | null) => {
      if (handle) tabHandlesRef.current.set(tabId, handle)
      else tabHandlesRef.current.delete(tabId)
    },
    []
  )

  const updateTabStatus = useCallback(
    (tabId: string, status: TerminalTabStatus) => {
      setTabStatuses((current) => {
        const previous = current[tabId]
        if (
          previous?.phase === status.phase &&
          previous.restarting === status.restarting &&
          previous.shell === status.shell
        ) {
          return current
        }
        return { ...current, [tabId]: status }
      })
    },
    []
  )

  function addTerminalTab() {
    if (tabs.length >= MAX_TERMINAL_TABS) return
    const tab = createTerminalTab(projectId)
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
  }

  function closeTerminalTab(tabId: string) {
    const tabIds = tabs.map((tab) => tab.id)
    const nextActiveTabId = getNextTerminalTabIdAfterClose(
      tabIds,
      activeTabId,
      tabId
    )
    setTabs((current) => current.filter((tab) => tab.id !== tabId))
    setTabStatuses((current) => {
      const next = { ...current }
      delete next[tabId]
      return next
    })
    tabHandlesRef.current.delete(tabId)
    setActiveTabId(nextActiveTabId)
  }

  function focusTab(tabId: string) {
    setActiveTabId(tabId)
    requestAnimationFrame(() => tabHandlesRef.current.get(tabId)?.focus())
  }

  function handleTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tabId: string
  ) {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId)
    if (currentIndex === -1) return
    let nextTab: TerminalTabDefinition | undefined
    if (event.key === 'ArrowLeft') {
      nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
    } else if (event.key === 'ArrowRight') {
      nextTab = tabs[(currentIndex + 1) % tabs.length]
    } else if (event.key === 'Home') {
      nextTab = tabs[0]
    } else if (event.key === 'End') {
      nextTab = tabs[tabs.length - 1]
    }
    if (!nextTab) return
    event.preventDefault()
    setActiveTabId(nextTab.id)
    requestAnimationFrame(() => {
      document.getElementById(`terminal-tab-${nextTab.id}`)?.focus()
    })
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  return (
    <section
      aria-label={t('desktop.terminal.title')}
      className="terminal-panel"
      data-open={open}
    >
      <header className="terminal-panel-toolbar">
        <div className="terminal-panel-identity">
          <SquareTerminal aria-hidden="true" />
          <strong>{t('desktop.terminal.title')}</strong>
        </div>
        <div
          aria-label={t('desktop.terminal.tabs')}
          className="terminal-tab-list"
          role="tablist"
        >
          {tabs.map((tab) => {
            const status = tabStatuses[tab.id] ?? STARTING_STATUS
            const label = status.shell ?? t('desktop.terminal.tab')
            const active = tab.id === activeTabId
            return (
              <div
                className="terminal-tab-item"
                data-active={active}
                data-phase={status.phase}
                key={tab.id}
              >
                <button
                  aria-controls={`terminal-tab-view-${tab.id}`}
                  aria-selected={active}
                  className="terminal-tab-trigger"
                  id={`terminal-tab-${tab.id}`}
                  onClick={() => focusTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  type="button"
                >
                  <span aria-hidden="true" className="terminal-tab-status" />
                  <span>{label}</span>
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={t('desktop.terminal.closeTab', {
                        name: label,
                      })}
                      className="terminal-tab-close"
                      onClick={() => closeTerminalTab(tab.id)}
                      tabIndex={active ? 0 : -1}
                      type="button"
                    >
                      <X />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('desktop.terminal.closeTab', { name: label })}
                  </TooltipContent>
                </Tooltip>
              </div>
            )
          })}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('desktop.terminal.newTab')}
              className="terminal-new-tab"
              disabled={tabs.length >= MAX_TERMINAL_TABS}
              onClick={addTerminalTab}
              type="button"
            >
              <Plus />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {tabs.length >= MAX_TERMINAL_TABS
              ? t('desktop.terminal.tabLimit', { count: MAX_TERMINAL_TABS })
              : t('desktop.terminal.newTab')}
          </TooltipContent>
        </Tooltip>
        <div className="terminal-panel-actions">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.terminal.clear')}
                className="size-7"
                disabled={!activeTab}
                onClick={() =>
                  activeTabId
                    ? tabHandlesRef.current.get(activeTabId)?.clear()
                    : undefined
                }
                size="icon-sm"
                variant="ghost"
              >
                <Eraser className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('desktop.terminal.clear')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.terminal.restart')}
                className="size-7"
                disabled={!activeTab || activeStatus?.restarting}
                onClick={() =>
                  activeTabId
                    ? void tabHandlesRef.current.get(activeTabId)?.restart()
                    : undefined
                }
                size="icon-sm"
                variant="ghost"
              >
                <RotateCcw
                  className={cn(
                    'size-3.5',
                    activeStatus?.restarting && 'animate-spin'
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('desktop.terminal.restart')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.terminal.close')}
                className="size-7"
                onClick={onClose}
                size="icon-sm"
                variant="ghost"
              >
                <X className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('desktop.terminal.close')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="terminal-tab-stack">
        {tabs.length === 0 ? (
          <div className="terminal-tabs-empty">
            <SquareTerminal aria-hidden="true" />
            <div>
              <strong>{t('desktop.terminal.emptyTitle')}</strong>
              <p>{t('desktop.terminal.emptyDescription')}</p>
            </div>
            <Button onClick={addTerminalTab} size="sm" variant="outline">
              <Plus />
              {t('desktop.terminal.newTab')}
            </Button>
          </div>
        ) : null}
        {tabs.map((tab) => (
          <TerminalTabView
            active={tab.id === activeTabId}
            key={tab.id}
            onHandle={registerTabHandle}
            onStatus={updateTabStatus}
            open={open}
            projectId={tab.projectId}
            tabId={tab.id}
          />
        ))}
      </div>
    </section>
  )
}

function TerminalTabView({
  active,
  onHandle,
  onStatus,
  open,
  projectId,
  tabId,
}: {
  active: boolean
  onHandle: (tabId: string, handle: TerminalTabHandle | null) => void
  onStatus: (tabId: string, status: TerminalTabStatus) => void
  open: boolean
  projectId?: string
  tabId: string
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const restartingRef = useRef(false)
  const phaseRef = useRef<TerminalPhase>('starting')
  const shellRef = useRef<string | null>(null)
  const activeRef = useRef(active)
  const openRef = useRef(open)
  const tRef = useRef(t)
  activeRef.current = active
  openRef.current = open
  tRef.current = t
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const publishStatus = useCallback(
    (phase = phaseRef.current) => {
      phaseRef.current = phase
      onStatus(tabId, {
        phase,
        restarting: restartingRef.current,
        shell: shellRef.current,
      })
    },
    [onStatus, tabId]
  )

  const fitTerminal = useCallback((focus = false) => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container || container.clientHeight < 24) return
    fitAddonRef.current?.fit()
    if (focus) terminal.focus()
  }, [])

  const startSession = useCallback(async () => {
    const terminal = terminalRef.current
    if (!terminal) return
    fitTerminal()
    const sessionId = crypto.randomUUID()
    sessionIdRef.current = sessionId
    setError(null)
    publishStatus('starting')
    try {
      const next = await window.skillShelf.createTerminal({
        cols: terminal.cols,
        ...(projectId ? { projectId } : {}),
        rows: terminal.rows,
        sessionId,
      })
      if (!mountedRef.current || sessionIdRef.current !== sessionId) {
        void window.skillShelf.closeTerminal(sessionId).catch(() => undefined)
        return
      }
      shellRef.current = next.shell
      publishStatus('ready')
      if (activeRef.current && openRef.current) {
        requestAnimationFrame(() => fitTerminal(true))
      }
    } catch (caught) {
      if (sessionIdRef.current === sessionId) sessionIdRef.current = null
      setError(getLocalizedErrorMessage(caught, tRef.current))
      publishStatus('error')
    }
  }, [fitTerminal, projectId, publishStatus])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    mountedRef.current = true
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: getTerminalFontFamily(),
      fontSize: 12.5,
      lineHeight: 1.24,
      macOptionClickForcesSelection: true,
      minimumContrastRatio: 4.5,
      scrollback: 5_000,
      theme: getTerminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const inputListener = terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void window.skillShelf
        .writeTerminal({ data, sessionId })
        .catch(() => undefined)
    })
    const resizeListener = terminal.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void window.skillShelf
        .resizeTerminal({ cols, rows, sessionId })
        .catch(() => undefined)
    })
    const unsubscribeData = window.skillShelf.onTerminalData((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      terminal.write(event.data)
    })
    const unsubscribeExit = window.skillShelf.onTerminalExit((event) => {
      if (event.sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      publishStatus('exited')
      terminal.write(
        `\r\n\x1b[2m${tRef.current('desktop.terminal.processExited', {
          code: event.exitCode,
        })}\x1b[0m\r\n`
      )
    })
    const resizeObserver = new ResizeObserver(() => fitTerminal())
    resizeObserver.observe(container)
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = getTerminalTheme()
      terminal.options.fontFamily = getTerminalFontFamily()
    })
    themeObserver.observe(document.documentElement, {
      attributeFilter: ['class', 'data-theme', 'style'],
      attributes: true,
    })

    void startSession()
    return () => {
      mountedRef.current = false
      const sessionId = sessionIdRef.current
      sessionIdRef.current = null
      if (sessionId) {
        void window.skillShelf.closeTerminal(sessionId).catch(() => undefined)
      }
      resizeObserver.disconnect()
      themeObserver.disconnect()
      unsubscribeData()
      unsubscribeExit()
      inputListener.dispose()
      resizeListener.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [fitTerminal, publishStatus, startSession])

  useEffect(() => {
    if (!active || !open) return
    const frame = requestAnimationFrame(() => fitTerminal(true))
    return () => cancelAnimationFrame(frame)
  }, [active, fitTerminal, open])

  const restartSession = useCallback(async () => {
    if (restartingRef.current) return
    restartingRef.current = true
    setRestarting(true)
    publishStatus()
    const currentSessionId = sessionIdRef.current
    sessionIdRef.current = null
    terminalRef.current?.reset()
    if (currentSessionId) {
      await window.skillShelf
        .closeTerminal(currentSessionId)
        .catch(() => undefined)
    }
    await startSession()
    restartingRef.current = false
    setRestarting(false)
    publishStatus()
  }, [publishStatus, startSession])

  const clearTerminal = useCallback(() => {
    const sessionId = sessionIdRef.current
    if (!sessionId) {
      terminalRef.current?.clear()
      return
    }
    void window.skillShelf
      .writeTerminal({ data: '\x0c', sessionId })
      .catch(() => undefined)
    terminalRef.current?.focus()
  }, [])

  useEffect(() => {
    onHandle(tabId, {
      clear: clearTerminal,
      focus: () => fitTerminal(true),
      restart: restartSession,
    })
    return () => onHandle(tabId, null)
  }, [clearTerminal, fitTerminal, onHandle, restartSession, tabId])

  return (
    <div
      aria-hidden={!active}
      aria-labelledby={`terminal-tab-${tabId}`}
      className="terminal-tab-view"
      data-active={active}
      data-error={Boolean(error)}
      id={`terminal-tab-view-${tabId}`}
      inert={!active}
      role="tabpanel"
    >
      {error ? (
        <div className="terminal-panel-error">
          <SquareTerminal aria-hidden="true" />
          <div>
            <strong>{t('desktop.terminal.failed')}</strong>
            <p>{error}</p>
          </div>
          <Button
            disabled={restarting}
            onClick={() => void restartSession()}
            size="sm"
            variant="outline"
          >
            {t('desktop.terminal.tryAgain')}
          </Button>
        </div>
      ) : null}
      <div
        aria-hidden={Boolean(error)}
        className={cn('terminal-xterm-host', error && 'is-hidden')}
        ref={containerRef}
      />
    </div>
  )
}

function createTerminalTab(projectId?: string): TerminalTabDefinition {
  return {
    id: crypto.randomUUID(),
    ...(projectId ? { projectId } : {}),
  }
}

function getTerminalTheme() {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    background: read('--background', '#ffffff'),
    black: read('--foreground', '#20201e'),
    blue: read('--ss-info', '#4078c0'),
    brightBlack: read('--muted-foreground', '#7b7b76'),
    brightBlue: read('--ss-info', '#5a8fd4'),
    brightCyan: read('--ss-success', '#4c9c7c'),
    brightGreen: read('--ss-success', '#4c9c7c'),
    brightMagenta: read('--primary', '#71665a'),
    brightRed: read('--destructive', '#d35b53'),
    brightWhite: read('--foreground', '#20201e'),
    brightYellow: read('--ss-warning', '#b98127'),
    cursor: read('--foreground', '#20201e'),
    cyan: read('--ss-success', '#358b68'),
    foreground: read('--foreground', '#20201e'),
    green: read('--ss-success', '#358b68'),
    magenta: read('--primary', '#71665a'),
    red: read('--destructive', '#c84b42'),
    selectionBackground: read('--accent', '#e9e6e1'),
    white: read('--foreground', '#20201e'),
    yellow: read('--ss-warning', '#a36e18'),
  }
}

function getTerminalFontFamily() {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--ss-font-mono')
      .trim() || 'ui-monospace, monospace'
  )
}
