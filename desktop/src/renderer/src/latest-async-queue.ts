export interface LatestAsyncQueueJob<T> {
  isLatest: () => boolean
  result: Promise<T>
}

export interface LatestAsyncQueue<TInput, TOutput> {
  enqueue: (input: TInput) => LatestAsyncQueueJob<TOutput>
}

export function createLatestAsyncQueue<TInput, TOutput>(
  worker: (input: TInput) => Promise<TOutput>
): LatestAsyncQueue<TInput, TOutput> {
  let latestVersion = 0
  let tail = Promise.resolve()

  return {
    enqueue(input) {
      const version = ++latestVersion
      const result = tail.then(() => worker(input))
      tail = result.then(
        () => undefined,
        () => undefined
      )

      return {
        isLatest: () => version === latestVersion,
        result,
      }
    },
  }
}
