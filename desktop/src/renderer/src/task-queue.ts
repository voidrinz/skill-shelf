export type TaskQueueKind = 'scan-updates' | 'translate-descriptions'

export type TaskQueueStatus =
  'queued' | 'running' | 'completed' | 'partial' | 'failed'

export type TaskQueueItemStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'skipped'

export interface TaskQueueItem {
  detail?: string
  id: string
  label: string
  status: TaskQueueItemStatus
}

export interface TaskQueueTask {
  createdAt: string
  finishedAt?: string
  id: string
  items: TaskQueueItem[]
  kind: TaskQueueKind
  status: TaskQueueStatus
  title: string
}

export function getTaskQueueProgress(task: TaskQueueTask) {
  const completed = task.items.filter((item) =>
    ['completed', 'failed', 'skipped'].includes(item.status)
  ).length
  return {
    completed,
    percent:
      task.items.length === 0
        ? task.status === 'queued'
          ? 0
          : 100
        : Math.round((completed / task.items.length) * 100),
    total: task.items.length,
  }
}

export function isTaskQueueTaskActive(task: TaskQueueTask) {
  return task.status === 'queued' || task.status === 'running'
}

export function updateTaskQueueTask(
  tasks: TaskQueueTask[],
  taskId: string,
  update: (task: TaskQueueTask) => TaskQueueTask
) {
  return tasks.map((task) => (task.id === taskId ? update(task) : task))
}

export function updateTaskQueueItem(
  task: TaskQueueTask,
  itemId: string,
  update: (item: TaskQueueItem) => TaskQueueItem
) {
  return {
    ...task,
    items: task.items.map((item) => (item.id === itemId ? update(item) : item)),
  }
}
