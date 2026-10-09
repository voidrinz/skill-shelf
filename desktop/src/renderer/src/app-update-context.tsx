import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { AppUpdateState } from '../../shared/desktop-contract'

const AppUpdateContext = createContext<{
  state: AppUpdateState | null
  setState: (state: AppUpdateState) => void
} | null>(null)

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState | null>(null)

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.skillShelf.onAppUpdateChanged((next) => {
      receivedEvent = true
      if (active) setState(next)
    })
    void window.skillShelf.getAppUpdate().then(
      (next) => {
        if (active && !receivedEvent) setState(next)
      },
      () => {
        if (active && !receivedEvent)
          setState({
            installMode: 'manual',
            status: 'error',
            version: null,
            percent: null,
            checkedAt: null,
          })
      }
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <AppUpdateContext value={{ state, setState }}>{children}</AppUpdateContext>
  )
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext)
  if (!context) throw new Error('Missing AppUpdateProvider')
  return context
}

export function hasAppUpdate(state: AppUpdateState | null) {
  return Boolean(
    state?.version && state.status !== 'disabled' && state.status !== 'current'
  )
}
