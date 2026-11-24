import type { WorkerReply } from './protocol'

export class WorkerRpc<T> {
  private next = 0
  private pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const { id, error, value } = event.data
      const call = this.pending.get(id)
      if (!call) return
      this.pending.delete(id)
      if (error) call.reject(new Error(error))
      else call.resolve(value)
    }
    worker.onerror = event => {
      for (const call of this.pending.values()) call.reject(new Error(event.message || 'Worker error'))
      this.pending.clear()
    }
  }

  call<R>(request: T): Promise<R> {
    return new Promise((resolve, reject) => {
      const id = ++this.next
      this.pending.set(id, { resolve: value => resolve(value as R), reject })
      this.worker.postMessage({ id, request })
    })
  }
}
