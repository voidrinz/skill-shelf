import { describe, expect, it } from 'vitest'

import { createLatestAsyncQueue } from './latest-async-queue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('latest async queue', () => {
  it('serializes writes and identifies only the newest response', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const calls: string[] = []
    const queue = createLatestAsyncQueue(async (value: string) => {
      calls.push(value)
      return value === 'list' ? first.promise : second.promise
    })

    const listJob = queue.enqueue('list')
    const columnsJob = queue.enqueue('columns')

    await Promise.resolve()
    expect(calls).toEqual(['list'])
    expect(listJob.isLatest()).toBe(false)
    expect(columnsJob.isLatest()).toBe(true)

    first.resolve('list')
    await expect(listJob.result).resolves.toBe('list')
    await Promise.resolve()
    expect(calls).toEqual(['list', 'columns'])

    second.resolve('columns')
    await expect(columnsJob.result).resolves.toBe('columns')
  })

  it('continues with the newest write after an earlier write fails', async () => {
    const calls: string[] = []
    const queue = createLatestAsyncQueue(async (value: string) => {
      calls.push(value)
      if (value === 'canvas') throw new Error('write failed')
      return value
    })

    const canvasJob = queue.enqueue('canvas')
    const listJob = queue.enqueue('list')

    await expect(canvasJob.result).rejects.toThrow('write failed')
    await expect(listJob.result).resolves.toBe('list')
    expect(calls).toEqual(['canvas', 'list'])
    expect(listJob.isLatest()).toBe(true)
  })
})
