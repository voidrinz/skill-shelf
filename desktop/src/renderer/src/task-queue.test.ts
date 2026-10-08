import { describe, expect, it } from 'vitest'

import {
  getTaskQueueProgress,
  isTaskQueueTaskActive,
  updateTaskQueueItem,
  type TaskQueueTask,
} from './task-queue'

const task: TaskQueueTask = {
  createdAt: '2026-08-29T00:00:00.000Z',
  id: 'task-1',
  items: [
    { id: 'a', label: 'Alpha', status: 'completed' },
    { id: 'b', label: 'Beta', status: 'failed' },
    { id: 'c', label: 'Gamma', status: 'queued' },
    { id: 'd', label: 'Delta', status: 'skipped' },
  ],
  kind: 'translate-descriptions',
  status: 'running',
  title: 'Translate descriptions',
}

describe('task queue state', () => {
  it('counts every terminal item toward progress', () => {
    expect(getTaskQueueProgress(task)).toEqual({
      completed: 3,
      percent: 75,
      total: 4,
    })
  })

  it('updates one item without mutating the task', () => {
    const next = updateTaskQueueItem(task, 'c', (item) => ({
      ...item,
      status: 'running',
    }))
    expect(next).not.toBe(task)
    expect(next.items[2]?.status).toBe('running')
    expect(task.items[2]?.status).toBe('queued')
  })

  it('recognizes queued and running tasks as active', () => {
    expect(isTaskQueueTaskActive(task)).toBe(true)
    expect(isTaskQueueTaskActive({ ...task, status: 'completed' })).toBe(false)
  })
})
