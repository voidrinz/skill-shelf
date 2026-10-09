import { BookOpen, GitFork, Globe2, ArrowUpRight } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type { DesktopRuntimeInfo } from '../../shared/desktop-contract'
import { AppUpdateControls, AppUpdateStatus } from './app-update-controls'

export function AboutAppCard({
  runtime,
}: {
  runtime: DesktopRuntimeInfo | null
}) {
  const { t } = useI18n()
  return (
    <section
      className="about-app-card"
      aria-label={t('desktop.about.application')}
    >
      <div className="about-identity">
        <span className="about-mark" aria-hidden="true">
          <BookOpen />
        </span>
        <div>
          <h3>{runtime?.appName ?? 'Skill Shelf'}</h3>
          <p>
            {t('desktop.about.version', {
              version: runtime?.appVersion ?? '…',
            })}
          </p>
          <p>{t('desktop.about.appDescription')}</p>
        </div>
        <AppUpdateControls />
      </div>
      <AppUpdateStatus />
      <div className="about-app-links">
        <Button
          onClick={() => void window.skillShelf.openAppLink('github')}
          size="sm"
          variant="outline"
        >
          <GitFork />
          GitHub
        </Button>
        <Button
          onClick={() => void window.skillShelf.openAppLink('website')}
          size="sm"
          variant="outline"
        >
          <Globe2 />
          {t('desktop.about.officialWebsite')}
        </Button>
        <Button
          onClick={() => void window.skillShelf.openAppLink('releases')}
          size="sm"
          variant="outline"
        >
          <ArrowUpRight />
          {t('desktop.about.releaseNotes')}
        </Button>
      </div>
    </section>
  )
}
