import { useState } from 'react'
import {
  CircleAlert,
  FolderCode,
  FolderOpen,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button, PageHeader, toast } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import type { CatalogSnapshot } from '../../shared/desktop-contract'
import { getLocalizedErrorMessage } from './localized-error'
import { ProjectsSkeleton } from './loading-skeletons'

export default function ProjectsWorkspace({
  catalog,
  onCatalogChange,
  onOpenProject,
}: {
  catalog: CatalogSnapshot | null
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onOpenProject: (projectId: string) => void
}) {
  const { plural, t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)

  async function addProject() {
    setBusy('add')
    try {
      const nextCatalog = await window.skillShelf.addProject()
      if (nextCatalog) {
        onCatalogChange(nextCatalog)
        toast.success(t('desktop.projects.added'))
      }
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  async function removeProject(projectId: string) {
    setBusy(projectId)
    try {
      onCatalogChange(await window.skillShelf.removeProject(projectId))
      toast.success(t('desktop.projects.removed'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="projects-workspace">
      <PageHeader
        actions={
          <Button
            disabled={busy === 'add'}
            onClick={() => void addProject()}
            size="sm"
          >
            {busy === 'add' ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Plus />
            )}
            {t('desktop.projects.add')}
          </Button>
        }
        description={t('desktop.projects.description')}
        eyebrow={t('desktop.projects.eyebrow')}
        title={t('desktop.projects.title')}
      />
      {!catalog ? (
        <ProjectsSkeleton />
      ) : catalog.projects.length ? (
        <div className="project-list">
          {catalog.projects.map((project) => (
            <article className="project-row" key={project.id}>
              <span className="project-icon">
                {project.scanError ? <CircleAlert /> : <FolderCode />}
              </span>
              <div className="project-copy">
                <strong>{project.name}</strong>
                <code title={project.path}>{project.path}</code>
                <small>
                  {project.scanError
                    ? t('desktop.projects.scanError')
                    : plural(
                        project.skillCount,
                        'count.skill.one',
                        'count.skill.other'
                      )}
                </small>
              </div>
              <Button
                onClick={() => onOpenProject(project.id)}
                size="sm"
                variant="outline"
              >
                <FolderOpen />
                {t('desktop.projects.viewSkills')}
              </Button>
              <Button
                aria-label={t('desktop.projects.remove', {
                  name: project.name,
                })}
                disabled={busy === project.id}
                onClick={() => void removeProject(project.id)}
                size="icon-sm"
                variant="ghost"
              >
                {busy === project.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <div className="projects-empty">
          <FolderCode />
          <strong>{t('desktop.projects.emptyTitle')}</strong>
          <p>{t('desktop.projects.emptyDescription')}</p>
          <Button onClick={() => void addProject()} size="sm" variant="outline">
            <Plus />
            {t('desktop.projects.add')}
          </Button>
        </div>
      )}
    </section>
  )
}
