import { basename } from 'node:path'

import type { WebContents } from 'electron'
import { spawn, type IDisposable, type IPty } from 'node-pty'

import { desktopIpcChannels } from '../../shared/desktop-contract'
import type {
  TerminalCreateInput,
  TerminalSessionInfo,
} from '../../shared/desktop-contract'

interface TerminalSession {
  dataListener: IDisposable
  exitListener: IDisposable
  owner: WebContents
  process: IPty
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  create(
    owner: WebContents,
    input: TerminalCreateInput,
    cwd: string
  ): TerminalSessionInfo {
    if (this.sessions.has(input.sessionId)) {
      throw new Error('Terminal session already exists')
    }
    const ownerSessions = [...this.sessions.values()].filter(
      (session) => session.owner.id === owner.id
    )
    if (ownerSessions.length >= 8) {
      throw new Error('Too many terminal sessions')
    }

    const shell = getDefaultShell()
    const terminalProcess = spawn(shell, getShellArgs(shell), {
      cols: input.cols,
      cwd,
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'Skill Shelf',
      },
      name: 'xterm-256color',
      rows: input.rows,
    })

    const dataListener = terminalProcess.onData((data) => {
      if (owner.isDestroyed()) return
      owner.send(desktopIpcChannels.terminalData, {
        data,
        sessionId: input.sessionId,
      })
    })
    let exitListener: IDisposable
    exitListener = terminalProcess.onExit(({ exitCode, signal }) => {
      const session = this.sessions.get(input.sessionId)
      if (!session || session.process !== terminalProcess) return
      this.sessions.delete(input.sessionId)
      dataListener.dispose()
      exitListener.dispose()
      if (owner.isDestroyed()) return
      owner.send(desktopIpcChannels.terminalExit, {
        exitCode,
        sessionId: input.sessionId,
        ...(signal === undefined ? {} : { signal }),
      })
    })

    this.sessions.set(input.sessionId, {
      dataListener,
      exitListener,
      owner,
      process: terminalProcess,
    })
    owner.once('destroyed', () => this.closeOwner(owner.id))

    return {
      cwd,
      sessionId: input.sessionId,
      shell: basename(shell),
    }
  }

  write(ownerId: number, sessionId: string, data: string) {
    this.getOwnedSession(ownerId, sessionId).process.write(data)
  }

  resize(ownerId: number, sessionId: string, cols: number, rows: number) {
    this.getOwnedSession(ownerId, sessionId).process.resize(cols, rows)
  }

  close(ownerId: number, sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.owner.id !== ownerId) {
      throw new Error('Terminal session not found')
    }
    this.disposeSession(sessionId, session)
  }

  closeAll() {
    for (const [sessionId, session] of this.sessions) {
      this.disposeSession(sessionId, session)
    }
  }

  private closeOwner(ownerId: number) {
    for (const [sessionId, session] of this.sessions) {
      if (session.owner.id === ownerId) this.disposeSession(sessionId, session)
    }
  }

  private getOwnedSession(ownerId: number, sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session || session.owner.id !== ownerId) {
      throw new Error('Terminal session not found')
    }
    return session
  }

  private disposeSession(sessionId: string, session: TerminalSession) {
    this.sessions.delete(sessionId)
    session.dataListener.dispose()
    session.exitListener.dispose()
    try {
      session.process.kill()
    } catch {
      // The shell may already have exited between the lookup and cleanup.
    }
  }
}

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/zsh'
}

function getShellArgs(shell: string): string[] {
  if (process.platform !== 'darwin') return []
  const shellName = basename(shell)
  return shellName === 'zsh' || shellName === 'bash' ? ['-l'] : []
}
