import { ChevronDown, FolderOpen, HardDrive, Link2 } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type { WorkbenchSnapshot } from '../../shared/desktop-contract'

export function WorkbenchOverview({
  snapshot,
  onOpenDirectory,
}: {
  snapshot: WorkbenchSnapshot
  onOpenDirectory: (id: string) => void
}) {
  const { number, t } = useI18n()
  const exclusiveNames = [
    ...new Set(
      snapshot.agentCoverage.flatMap((agent) => agent.exclusiveSkillNames)
    ),
  ]
  return (
    <section className="workbench-inventory">
      <header>
        <HardDrive />
        <h2>{t('desktop.workbench.inventory.title')}</h2>
        <span>
          {t('desktop.workbench.inventory.total', {
            count: number(snapshot.stats.totalSkills),
          })}
        </span>
      </header>
      <div className="workbench-inventory-locations">
        <div className="workbench-shared-location">
          <div className="workbench-location-heading">
            <h3>{t('desktop.workbench.inventory.shared')}</h3>
            <strong>
              {number(snapshot.stats.sharedSkills)}
              <small>Skills</small>
            </strong>
          </div>
          <div className="workbench-directory-path">
            <code>{snapshot.sharedDirectory.path}</code>
            <Button
              disabled={!snapshot.sharedDirectory.exists}
              onClick={() => onOpenDirectory('shared')}
              size="xs"
              variant="outline"
            >
              <FolderOpen />
              {t('desktop.workbench.openDirectory')}
            </Button>
          </div>
          <p>{t('desktop.workbench.inventory.sharedDescription')}</p>
          {!snapshot.sharedDirectory.exists ? (
            <small>{t('desktop.workbench.inventory.noSharedDirectory')}</small>
          ) : null}
        </div>
        <div>
          <div className="workbench-location-heading">
            <h3>{t('desktop.workbench.inventory.exclusive')}</h3>
            <strong>
              {number(snapshot.stats.exclusiveSkills)}
              <small>Skills</small>
            </strong>
          </div>
          <p>{t('desktop.workbench.inventory.exclusiveDescription')}</p>
          <div className="workbench-exclusive-preview">
            {exclusiveNames.slice(0, 3).map((name) => (
              <span key={name}>{name}</span>
            ))}
            {exclusiveNames.length > 3 ? (
              <span>+{number(exclusiveNames.length - 3)}</span>
            ) : null}
          </div>
          <small>{t('desktop.workbench.inventory.counting')}</small>
        </div>
      </div>
    </section>
  )
}

export function WorkbenchFileChecks({
  snapshot,
  onOpenDirectory,
}: {
  snapshot: WorkbenchSnapshot
  onOpenDirectory: (id: string) => void
}) {
  const { number, t } = useI18n()
  const files = snapshot.symlinkHealth
  return (
    <details className="workbench-file-checks">
      <summary>
        <Link2 />
        <strong>{t('desktop.workbench.files.title')}</strong>
        <span>
          {files.issues.length
            ? t('desktop.workbench.files.issueCount', {
                count: number(files.issues.length),
              })
            : t('desktop.workbench.files.clear')}
        </span>
        <ChevronDown />
      </summary>
      <div className="workbench-file-checks-body">
        <p>{t('desktop.workbench.files.method')}</p>
        <div className="workbench-file-counts">
          <span>
            {t('desktop.workbench.files.valid', { count: number(files.valid) })}
          </span>
          <span>
            {t('desktop.workbench.files.broken', {
              count: number(files.broken),
            })}
          </span>
          <span>
            {t('desktop.workbench.files.unreadable', {
              count: number(files.inaccessible),
            })}
          </span>
          <span>
            {t('desktop.workbench.files.missing', {
              count: number(files.missingDocuments),
            })}
          </span>
        </div>
        {files.issues.length ? (
          <ul className="workbench-file-issues">
            {files.issues.map((issue) => {
              const agentId =
                snapshot.agentCoverage.find((agent) =>
                  issue.agentNames.includes(agent.name)
                )?.id ?? 'shared'
              return (
                <li key={`${issue.path}:${issue.status}`}>
                  <div>
                    <strong>{issue.skillName}</strong>
                    <span>
                      {t(`desktop.workbench.files.status.${issue.status}`)}
                    </span>
                    <small>
                      {issue.agentNames.join(', ') ||
                        t('desktop.workbench.inventory.shared')}
                    </small>
                    <code>{issue.path}</code>
                    <p>{t(`desktop.workbench.files.fix.${issue.status}`)}</p>
                  </div>
                  <Button
                    onClick={() => onOpenDirectory(agentId)}
                    size="xs"
                    variant="outline"
                  >
                    <FolderOpen />
                    {t('desktop.workbench.openDirectory')}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </details>
  )
}
