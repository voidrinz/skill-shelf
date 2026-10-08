import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleX,
  ListTodo,
  LoaderCircle,
  MinusCircle,
  Trash2,
  X,
} from 'lucide-react'
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import {
  getTaskQueueProgress,
  isTaskQueueTaskActive,
  type TaskQueueItemStatus,
  type TaskQueueTask,
} from './task-queue'

export default function TaskQueuePanel({
  onClearCompleted,
  onClose,
  tasks,
}: {
  onClearCompleted: () => void
  onClose: () => void
  tasks: TaskQueueTask[]
}) {
  const { locale, t } = useI18n()
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const activeCount = tasks.filter(isTaskQueueTaskActive).length
  const hasCompleted = tasks.some((task) => !isTaskQueueTaskActive(task))

  function isExpanded(task: TaskQueueTask) {
    return !collapsedIds.has(task.id)
  }

  function toggleExpanded(taskId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  return (
    <div className="task-queue-layout">
      <header className="task-queue-header">
        <div>
          <span className="task-queue-mark">
            <ListTodo />
          </span>
          <span>
            <strong>{t('desktop.queue.title')}</strong>
            <small>
              {activeCount > 0
                ? t('desktop.queue.activeCount', { count: activeCount })
                : t('desktop.queue.idle')}
            </small>
          </span>
        </div>
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.queue.clearCompleted')}
                disabled={!hasCompleted}
                onClick={onClearCompleted}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('desktop.queue.clearCompleted')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.queue.close')}
                onClick={onClose}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('desktop.queue.close')}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="task-queue-list">
        {tasks.length === 0 ? (
          <div className="task-queue-empty">
            <ListTodo />
            <strong>{t('desktop.queue.emptyTitle')}</strong>
            <span>{t('desktop.queue.emptyDescription')}</span>
          </div>
        ) : (
          tasks.map((task) => {
            const progress = getTaskQueueProgress(task)
            const expanded = isExpanded(task)
            return (
              <article
                className="task-queue-task"
                data-status={task.status}
                key={task.id}
              >
                <button
                  aria-expanded={expanded}
                  className="task-queue-task-summary"
                  onClick={() => toggleExpanded(task.id)}
                  type="button"
                >
                  <TaskStatusIcon status={task.status} />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      <time dateTime={task.createdAt}>
                        {new Intl.DateTimeFormat(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(task.createdAt))}
                      </time>
                      <span> · </span>
                      {t(`desktop.queue.status.${task.status}`)}
                    </small>
                  </span>
                  <ChevronDown className={cn(expanded && 'is-expanded')} />
                </button>
                <div className="task-queue-progress-copy">
                  <span>
                    {t('desktop.queue.progress', {
                      completed: progress.completed,
                      total: progress.total,
                    })}
                  </span>
                  <strong>{progress.percent}%</strong>
                </div>
                <div
                  aria-label={t('desktop.queue.progressLabel')}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress.percent}
                  className="task-queue-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
                {expanded ? (
                  <div className="task-queue-items">
                    {task.items.map((item) => {
                      const detail =
                        item.detail ??
                        t(`desktop.queue.itemStatus.${item.status}`)
                      return (
                        <div
                          className="task-queue-item"
                          data-status={item.status}
                          key={item.id}
                        >
                          <ItemStatusIcon status={item.status} />
                          <span>
                            <strong>{item.label}</strong>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <small>{detail}</small>
                              </TooltipTrigger>
                              <TooltipContent
                                className="task-queue-detail-tooltip"
                                side="left"
                              >
                                {detail}
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </article>
            )
          })
        )}
      </div>
      <footer>{t('desktop.queue.localHistory')}</footer>
    </div>
  )
}

function TaskStatusIcon({ status }: { status: TaskQueueTask['status'] }) {
  if (status === 'running') return <LoaderCircle className="animate-spin" />
  if (status === 'queued') return <CircleDashed />
  if (status === 'completed') return <CheckCircle2 />
  return <CircleX />
}

function ItemStatusIcon({ status }: { status: TaskQueueItemStatus }) {
  if (status === 'running') return <LoaderCircle className="animate-spin" />
  if (status === 'queued') return <CircleDashed />
  if (status === 'completed') return <CheckCircle2 />
  if (status === 'skipped') return <MinusCircle />
  return <CircleX />
}
