import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  FileCode2,
  Folder,
  FolderTree,
  Globe2,
  HardDrive,
  Languages,
  LibraryBig,
  Link2,
  Menu,
  Moon,
  PackageOpen,
  Search,
  ShieldCheck,
  Sun,
  TerminalSquare,
  X,
  RefreshCcw,
  ScanSearch,
} from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { useI18n } from '@skill-shelf/i18n/react'
import { Brand } from '../../packages/ui/src/brand'
import { macDownloads } from './downloads'

const features = [
  ['diagnose', ScanSearch],
  ['organize', FolderTree],
  ['operate', RefreshCcw],
  ['understand', Languages],
  ['discover', Search],
  ['packs', PackageOpen],
] as const
const views = ['library', 'discover', 'packs'] as const
type View = (typeof views)[number]
const skills = [
  { name: 'frontend-design', icon: FolderTree },
  { name: 'design-motion-principles', icon: FileCode2 },
  { name: 'vercel-react-best-practices', icon: FileCode2 },
  { name: 'expo-native-ui', icon: FileCode2 },
] as const
type SkillName = (typeof skills)[number]['name']

function initialTheme() {
  if (typeof localStorage === 'undefined') return 'system'
  const saved = localStorage.getItem('skill-shelf-website-theme')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

export function App() {
  const { locale, t } = useI18n()
  const [theme, setTheme] = useState(initialTheme)
  const [isDark, setIsDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.title = t('website.meta.title')
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('website.meta.description'))
  }, [locale, t])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      setIsDark(dark)
      document.documentElement.classList.toggle('dark', dark)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#171719' : '#fafafa')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        document.getElementById('menu-toggle')?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [menuOpen])

  function toggleTheme() {
    const next = isDark ? 'light' : 'dark'
    localStorage.setItem('skill-shelf-website-theme', next)
    setTheme(next)
  }

  return (
    <>
      <a className="skip-link" href="#main">
        {t('website.skip')}
      </a>
      <header className="site-header">
        <nav className="site-nav wrap" aria-label={t('website.nav.label')}>
          <a className="home-link" aria-label={t('website.home')} href="#top">
            <Brand />
          </a>
          <div
            className={`nav-links ${menuOpen ? 'is-open' : ''}`}
            id="navigation"
          >
            <a href="#capabilities" onClick={() => setMenuOpen(false)}>
              {t('website.nav.capabilities')}
            </a>
            <a href="#workspace" onClick={() => setMenuOpen(false)}>
              {t('website.nav.workspace')}
            </a>
            <a href="#packs" onClick={() => setMenuOpen(false)}>
              {t('website.nav.packs')}
            </a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>
              {t('website.nav.faq')}
            </a>
          </div>
          <div className="nav-tools">
            <a
              className="icon-button language-switch"
              aria-label={t('website.language')}
              href={`${import.meta.env.BASE_URL}${locale === 'en' ? 'zh-CN/' : ''}`}
              hrefLang={locale === 'en' ? 'zh-CN' : 'en'}
            >
              <Globe2 size={16} />
              <span>{locale === 'en' ? '中文' : 'EN'}</span>
            </a>
            <button
              className="icon-button"
              aria-label={t(
                isDark ? 'website.theme.light' : 'website.theme.dark'
              )}
              onClick={toggleTheme}
              type="button"
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <a
              className="button button-small nav-cta"
              href={macDownloads.arm64}
            >
              {t('website.download.appleSilicon')}
              <Download size={13} />
            </a>
            <button
              className="icon-button menu-toggle"
              id="menu-toggle"
              aria-label={t('website.nav.menu')}
              aria-expanded={menuOpen}
              aria-controls="navigation"
              onClick={() => setMenuOpen(!menuOpen)}
              type="button"
            >
              {menuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </nav>
      </header>

      <main className="wrap" id="main">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" />
              {t('website.hero.eyebrow')}
            </p>
            <h1>
              {t('website.hero.line1')}
              <span>{t('website.hero.line2')}</span>
            </h1>
            <p className="lede">{t('website.hero.description')}</p>
            <DownloadActions />
            <p className="hero-meta">
              {t('website.hero.localOnly')}
              <span>·</span>
              {t('website.hero.untouched')}
              <span>·</span>
              {t('website.hero.cliBased')}
            </p>
          </div>
          <HeroPreview />
        </section>

        <section
          className="agents-strip"
          aria-label={t('website.agents.label')}
        >
          <p>{t('website.agents.title')}</p>
          <div>
            {['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'OpenCode'].map(
              (name) => (
                <span key={name}>
                  <TerminalSquare size={17} />
                  {name}
                </span>
              )
            )}
            <span className="agents-more">{t('website.agents.more')}</span>
          </div>
        </section>

        <section className="section capabilities" id="capabilities">
          <p className="eyebrow">{t('website.capabilities.eyebrow')}</p>
          <h2>{t('website.capabilities.title')}</h2>
          <p className="section-description">
            {t('website.capabilities.description')}
          </p>
          <div className="feature-grid">
            {features.map(([id, Icon]) => (
              <article className="feature" key={id}>
                <Icon size={21} strokeWidth={1.5} />
                <h3>{t(`website.capabilities.${id}.title`)}</h3>
                <p>{t(`website.capabilities.${id}.description`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section workspace-section" id="workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('website.workspace.eyebrow')}</p>
              <h2>{t('website.workspace.title')}</h2>
            </div>
            <p>{t('website.workspace.description')}</p>
          </div>
          <WorkspacePreview />
        </section>

        <section className="section split-section" id="packs">
          <div className="split-copy">
            <p className="eyebrow">{t('website.packs.eyebrow')}</p>
            <h2>{t('website.packs.title')}</h2>
            <p className="section-description">
              {t('website.packs.description')}
            </p>
            <ul className="check-list">
              {(['import', 'group', 'deploy'] as const).map((key) => (
                <li key={key}>
                  <Check size={16} />
                  {t(`website.packs.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <PacksPreview />
        </section>

        <section className="section local-section" id="local">
          <div className="local-copy">
            <ShieldCheck size={27} strokeWidth={1.5} />
            <p className="eyebrow">{t('website.local.eyebrow')}</p>
            <h2>{t('website.local.title')}</h2>
            <p className="section-description">
              {t('website.local.description')}
            </p>
          </div>
          <div className="local-details">
            <div>
              <HardDrive size={19} />
              <h3>{t('website.local.reads')}</h3>
              <p>
                {t('website.local.readFolders')}
                <br />
                {t('website.local.readLinks')}
              </p>
            </div>
            <div>
              <LibraryBig size={19} />
              <h3>{t('website.local.saves')}</h3>
              <p>
                {t('website.local.saveOrganization')}
                <br />
                {t('website.local.saveTranslations')}
              </p>
            </div>
            <p className="local-note">
              <Check size={16} />
              <span>
                <strong>{t('website.local.neverTitle')}</strong>
                {t('website.local.neverDescription')}
              </span>
            </p>
          </div>
        </section>

        <section className="section faq-section" id="faq">
          <div>
            <p className="eyebrow">{t('website.faq.eyebrow')}</p>
            <h2>{t('website.faq.title')}</h2>
          </div>
          <div className="faq-list">
            {(['web', 'files', 'ai', 'cli'] as const).map((id) => (
              <details key={id}>
                <summary>
                  {t(`website.faq.${id}.question`)}
                  <ChevronRight size={17} />
                </summary>
                <p>{t(`website.faq.${id}.answer`)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing-section" id="download">
          <Brand compact />
          <h2>{t('website.closing.title')}</h2>
          <p>{t('website.closing.description')}</p>
          <DownloadActions />
        </section>
      </main>

      <footer className="wrap site-footer">
        <a aria-label={t('website.home')} href="#top">
          <Brand />
        </a>
        <p>{t('website.footer.description')}</p>
        <a href="https://skills.sh" target="_blank" rel="noreferrer">
          skills.sh
          <ArrowUpRight size={14} />
        </a>
      </footer>
    </>
  )
}

function DownloadActions() {
  const { t } = useI18n()
  return (
    <div className="download-actions">
      <div className="hero-actions">
        <a className="button" href={macDownloads.arm64}>
          <Download size={16} />
          {t('website.download.appleSilicon')}
        </a>
        <a className="button button-ghost" href={macDownloads.x64}>
          <Download size={16} />
          {t('website.download.intel')}
        </a>
      </div>
      <p className="download-caption">{t('website.download.chips')}</p>
    </div>
  )
}

function WindowBar({ label }: { label: string }) {
  return (
    <div className="window-bar">
      <div className="window-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span>{label}</span>
      <div className="window-spacer" />
    </div>
  )
}

function HeroPreview() {
  const { t } = useI18n()
  return (
    <figure className="hero-preview">
      <div className="product-window hero-window">
        <WindowBar label="Skill Shelf" />
        <div className="hero-window-body">
          <div className="hero-window-heading">
            <div>
              <p>{t('website.demo.library')}</p>
              <h3>{t('website.demo.all')}</h3>
            </div>
            <span className="quiet-badge">
              <HardDrive size={12} />
              {t('website.demo.global')}
            </span>
          </div>
          <div className="preview-search">
            <Search size={15} />
            <span>{t('website.demo.search')}</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="hero-folder">
            <Folder size={20} />
            <span>
              {t('website.demo.folderName')}
              <small>{t('website.heroPreview.folder')}</small>
            </span>
            <ChevronRight size={15} />
          </div>
          <div className="hero-skill-list">
            {skills.slice(0, 3).map(({ name }, index) => (
              <div
                className={`hero-skill-row ${index === 0 ? 'is-selected' : ''}`}
                key={name}
              >
                <span className="file-icon">
                  <FileCode2 size={19} strokeWidth={1.5} />
                </span>
                <span>
                  <strong>{name}</strong>
                  <small>{t(`website.skill.${name}.summary`)}</small>
                </span>
                {index === 0 ? <Check size={14} /> : null}
              </div>
            ))}
          </div>
          <div className="hero-window-footer">
            <span>
              <span className="status-dot" />
              {t('website.heroPreview.health')}
            </span>
            <span>SKILL.md</span>
          </div>
        </div>
      </div>
      <figcaption>
        <span className="preview-label">{t('website.preview.label')}</span>
        {t('website.heroPreview.caption')}
      </figcaption>
    </figure>
  )
}

function WorkspacePreview() {
  const { t } = useI18n()
  const [view, setView] = useState<View>('library')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SkillName>('frontend-design')
  const [translated, setTranslated] = useState(false)
  const results = skills.filter((skill) =>
    `${skill.name} ${t(`website.skill.${skill.name}.summary`)}`
      .toLowerCase()
      .includes(query.toLowerCase().trim())
  )

  function changeView(next: View) {
    setView(next)
    setQuery('')
  }

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % views.length
    else if (event.key === 'ArrowLeft')
      next = (index + views.length - 1) % views.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = views.length - 1
    else return
    event.preventDefault()
    changeView(views[next]!)
    document.getElementById(`view-${views[next]}`)?.focus()
  }

  return (
    <div className="workspace-demo">
      <div
        className="demo-tabs"
        role="tablist"
        aria-label={t('website.workspace.tabs')}
      >
        {views.map((id, index) => {
          const Icon =
            id === 'library'
              ? FolderTree
              : id === 'discover'
                ? Search
                : PackageOpen
          return (
            <button
              id={`view-${id}`}
              aria-selected={view === id}
              aria-controls="workspace-panel"
              role="tab"
              tabIndex={view === id ? 0 : -1}
              onClick={() => changeView(id)}
              onKeyDown={(event) => navigateTabs(event, index)}
              key={id}
              type="button"
            >
              <Icon size={16} />
              {t(`website.workspace.${id}`)}
            </button>
          )
        })}
      </div>
      <div
        className="product-window workspace-window"
        id="workspace-panel"
        role="tabpanel"
        aria-labelledby={`view-${view}`}
        tabIndex={0}
      >
        <WindowBar label={t('website.demo.status')} />
        <div className="workspace-body">
          <aside className="demo-sidebar">
            <Brand compact />
            <div className="demo-nav">
              {views.map((id) => (
                <button
                  className={view === id ? 'is-active' : ''}
                  key={id}
                  onClick={() => changeView(id)}
                  type="button"
                >
                  {id === 'library' ? (
                    <LibraryBig size={16} />
                  ) : id === 'discover' ? (
                    <Search size={16} />
                  ) : (
                    <PackageOpen size={16} />
                  )}
                  {t(`website.workspace.nav.${id}`)}
                </button>
              ))}
            </div>
            <p>{t('website.demo.scope')}</p>
            <span className="demo-location">
              <HardDrive size={14} />
              {t('website.demo.global')}
            </span>
            <span className="demo-location">
              <Folder size={14} />
              website
            </span>
            <div className="sidebar-bottom">
              <ShieldCheck size={14} />
              {t('website.hero.localOnly')}
            </div>
          </aside>
          <div className="demo-content">
            <div className="demo-content-heading">
              <span>{t(`website.workspace.nav.${view}`)}</span>
              <span className="quiet-badge">{t('website.preview.label')}</span>
            </div>
            <h3>{t(`website.workspace.heading.${view}`)}</h3>
            {view !== 'packs' ? (
              <>
                <label className="demo-search">
                  <Search size={16} />
                  <input
                    aria-label={t('website.workspace.search')}
                    placeholder={t(
                      view === 'discover'
                        ? 'website.mini.marketSearch'
                        : 'website.demo.search'
                    )}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query ? (
                    <button
                      aria-label={t('website.workspace.clear')}
                      onClick={() => setQuery('')}
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </label>
                <div className="demo-breadcrumb">
                  <Folder size={14} />
                  {t(
                    view === 'discover'
                      ? 'website.mini.popular'
                      : 'website.demo.folderName'
                  )}
                  <span>
                    {results.length} {t('website.demo.skills')}
                  </span>
                </div>
                <div className="demo-skill-list">
                  {results.length ? (
                    results.map(({ name, icon: Icon }) => (
                      <button
                        className={`demo-skill ${selected === name ? 'is-selected' : ''}`}
                        key={name}
                        onClick={() => setSelected(name)}
                        aria-pressed={selected === name}
                        type="button"
                      >
                        <span className="file-icon">
                          <Icon size={21} strokeWidth={1.5} />
                        </span>
                        <span>
                          <strong>{name}</strong>
                          <small>{t(`website.skill.${name}.summary`)}</small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))
                  ) : (
                    <div className="demo-empty">
                      <Search size={22} />
                      <strong>{t('website.workspace.empty')}</strong>
                      <p>{t('website.workspace.emptyHint')}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="demo-pack-content">
                <div className="demo-pack-title">
                  <span className="file-icon">
                    <PackageOpen size={24} />
                  </span>
                  <div>
                    <strong>frontend-toolkit</strong>
                    <p>{t('website.workspace.packDescription')}</p>
                  </div>
                </div>
                {skills.slice(0, 3).map(({ name }) => (
                  <div className="demo-pack-file" key={name}>
                    <FileCode2 size={16} />
                    <span>{name}</span>
                    <Check size={14} />
                  </div>
                ))}
                <div className="demo-pack-target">
                  <Link2 size={17} />
                  <span>
                    {t('website.workspace.packTarget')}
                    <code>new-project/.agents/skills</code>
                  </span>
                </div>
              </div>
            )}
          </div>
          <aside className="demo-inspector">
            {view === 'packs' ? (
              <>
                <PackageOpen size={25} strokeWidth={1.5} />
                <p className="inspector-label">
                  {t('website.workspace.packDetails')}
                </p>
                <h4>frontend-toolkit</h4>
                <p>{t('website.packs.localCopy')}</p>
                <div className="inspector-note">
                  <ShieldCheck size={15} />
                  <span>{t('website.workspace.packNote')}</span>
                </div>
              </>
            ) : (
              <>
                <span className="file-icon">
                  <FileCode2 size={23} strokeWidth={1.5} />
                </span>
                <p className="inspector-label">SKILL.md</p>
                <h4>{selected}</h4>
                <div
                  className="translation-switch"
                  role="group"
                  aria-label={t('website.demo.description')}
                >
                  <button
                    aria-pressed={!translated}
                    onClick={() => setTranslated(false)}
                    type="button"
                  >
                    {t('website.demo.original')}
                  </button>
                  <button
                    aria-pressed={translated}
                    onClick={() => setTranslated(true)}
                    type="button"
                  >
                    <Languages size={12} />
                    {t('website.demo.translation')}
                  </button>
                </div>
                <p className="skill-description">
                  {translated
                    ? t(`website.skill.${selected}.description`)
                    : originalDescriptions[selected]}
                </p>
                <div className="inspector-note">
                  <Check size={14} />
                  <span>
                    {t(
                      translated
                        ? 'website.demo.savedLocally'
                        : 'website.workspace.originalNote'
                    )}
                  </span>
                </div>
                <div className="inspector-files">
                  <span>{t('website.demo.files')}</span>
                  <p>
                    <FileCode2 size={14} />
                    SKILL.md
                  </p>
                  <p>
                    <Folder size={14} />
                    references/
                  </p>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
      <p className="demo-caption">
        <span>{t('website.workspace.interactive')}</span>
        {t(`website.workspace.caption.${view}`)}
      </p>
    </div>
  )
}

const originalDescriptions: Record<SkillName, string> = {
  'frontend-design':
    'Build distinctive, production-grade interfaces with a deliberate visual direction. Covers typography, color, layout, and the details that make a product feel considered.',
  'design-motion-principles':
    'Design purposeful interface motion. Choose transitions, easing, and timing that help people understand changes and keep interactions responsive.',
  'vercel-react-best-practices':
    'React and Next.js performance guidelines. Reduce request waterfalls, keep bundles small, and avoid unnecessary rendering.',
  'expo-native-ui':
    'Build native-feeling Expo screens with platform controls, semantic colors, thoughtful navigation, and accessible interactions.',
}

function PacksPreview() {
  const { t } = useI18n()
  const [mode, setMode] = useState<'symlink' | 'copy'>('symlink')
  return (
    <div className="packs-preview">
      <div className="pack-source">
        <Folder size={18} />
        <div>
          <small>{t('website.packs.source')}</small>
          <strong>website / .agents / skills</strong>
        </div>
      </div>
      <div className="pack-connector">
        <ArrowDown size={17} />
        <span>{t('website.packs.importAction')}</span>
      </div>
      <div className="pack-main">
        <PackageOpen size={25} />
        <div>
          <small>{t('website.demo.packs')}</small>
          <strong>frontend-toolkit</strong>
          <span>{t('website.packs.localCopy')}</span>
        </div>
        <span className="quiet-badge">3 Skills</span>
      </div>
      <div className="pack-connector">
        <ArrowDown size={17} />
        <span>{t('website.packs.preview.deploy')}</span>
      </div>
      <div className="pack-destination">
        <div
          className="pack-mode"
          role="group"
          aria-label={t('website.packs.preview.mode')}
        >
          {(['symlink', 'copy'] as const).map((value) => (
            <button
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              key={value}
              type="button"
            >
              {value === 'symlink' ? (
                <Link2 size={14} />
              ) : (
                <FileCode2 size={14} />
              )}
              {t(`website.packs.${value}`)}
            </button>
          ))}
        </div>
        <p>
          <Folder size={16} />
          <code>new-project/.agents/skills</code>
        </p>
        <small>{t(`website.packs.preview.${mode}`)}</small>
      </div>
    </div>
  )
}
