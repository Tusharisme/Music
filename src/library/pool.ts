/** Minimal promise-based worker pool. */
interface Job<Req, Res> {
  req: Req;
  transfer: Transferable[];
  resolve: (r: Res) => void;
  reject: (e: Error) => void;
}

export class WorkerPool<Req extends { id: string }, Res extends { id: string; ok: boolean; error?: string }> {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Job<Req, Res>>();
  private readonly queue: Job<Req, Res>[] = [];
  private readonly factory: () => Worker;
  private readonly size: number;
  private created = 0;

  constructor(factory: () => Worker, size: number) {
    this.factory = factory;
    this.size = Math.max(1, size);
  }

  run(req: Req, transfer: Transferable[] = []): Promise<Res> {
    return new Promise((resolve, reject) => {
      this.queue.push({ req, transfer, resolve, reject });
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length + this.busy.size;
  }

  private spawn(): Worker {
    const w = this.factory();
    this.created++;
    w.onmessage = (e: MessageEvent<Res>) => {
      const job = this.busy.get(w);
      this.busy.delete(w);
      this.idle.push(w);
      if (job) {
        if (e.data.ok) job.resolve(e.data);
        else job.reject(new Error(e.data.error ?? 'Worker failed'));
      }
      this.pump();
    };
    w.onerror = (e) => {
      const job = this.busy.get(w);
      this.busy.delete(w);
      w.terminate();
      this.created--;
      job?.reject(new Error(e.message || 'Worker crashed'));
      this.pump();
    };
    return w;
  }

  private pump(): void {
    while (this.queue.length) {
      let w = this.idle.pop();
      if (!w && this.created < this.size) w = this.spawn();
      if (!w) return;
      const job = this.queue.shift()!;
      this.busy.set(w, job);
      w.postMessage(job.req, job.transfer);
    }
  }
}

export const hardwareThreads = (): number =>
  typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
