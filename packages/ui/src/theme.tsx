import { Monitor, Moon, Sun } from 'lucide-react'
import * as React from 'react'

import { cn } from './lib/cn'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<Theme, 'system'>

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  theme: Theme
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#222222' : '#f2f2f0')
  return resolved
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  onThemeChange,
  theme: controlledTheme,
}: {
  children: React.ReactNode
  defaultTheme?: Theme
  onThemeChange?: (theme: Theme) => void
  theme?: Theme
}) {
  const [internalTheme, setInternalTheme] = React.useState(defaultTheme)
  const [resolvedTheme, setResolvedTheme] =
    React.useState<ResolvedTheme>('light')
  const theme = controlledTheme ?? internalTheme

  React.useEffect(() => {
    setResolvedTheme(applyTheme(theme))
    if (theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setResolvedTheme(applyTheme('system'))
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  const setTheme = React.useCallback(
    (next: Theme) => {
      if (controlledTheme === undefined) setInternalTheme(next)
      onThemeChange?.(next)
    },
    [controlledTheme, onThemeChange]
  )

  const value = React.useMemo(
    () => ({ resolvedTheme, setTheme, theme }),
    [resolvedTheme, setTheme, theme]
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}

export function ThemeToggle({
  className,
  labels = { dark: 'Dark', light: 'Light', system: 'System' },
  showLabel = false,
}: {
  className?: string
  labels?: Record<Theme, string>
  showLabel?: boolean
}) {
  const { setTheme, theme } = useTheme()
  const options = [
    { icon: Monitor, label: labels.system, value: 'system' },
    { icon: Sun, label: labels.light, value: 'light' },
    { icon: Moon, label: labels.dark, value: 'dark' },
  ] as const

  return (
    <div
      className={cn(
        'bg-secondary inline-flex h-9 items-center gap-0.5 rounded-full p-1',
        showLabel ? 'w-full' : 'w-fit',
        className
      )}
      role="radiogroup"
    >
      {options.map(({ icon: Icon, label, value }) => (
        <button
          aria-checked={theme === value}
          aria-label={label}
          className={cn(
            'text-muted-foreground focus-visible:ring-ring flex h-7 items-center justify-center gap-1.5 rounded-full px-2 text-xs outline-none transition focus-visible:ring-2',
            showLabel && 'min-w-0 flex-1',
            theme === value
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/60 hover:text-foreground'
          )}
          key={value}
          onClick={() => setTheme(value)}
          role="radio"
          type="button"
        >
          <Icon className="size-3.5" />
          {showLabel ? <span>{label}</span> : null}
        </button>
      ))}
    </div>
  )
}
