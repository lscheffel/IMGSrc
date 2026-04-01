import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Worker } from 'node:worker_threads';

// ============================================================================
// Tipos IPC (conforme docs/architecture/IPC_API_CONTRACTS-000.md)
// ============================================================================

export type WorkerMessageType = 'SCRAPE_TASK' | 'DOWNLOAD_TASK' | 'HEALTH_CHECK' | 'SHUTDOWN';

export interface WorkerMessage<T = unknown> {
  id: string;
  type: WorkerMessageType;
  payload: T;
  timestamp: number;
  correlationId?: string;
}

export interface WorkerResponse<T = unknown> {
  id: string;
  success: boolean;
  payload?: T;
  error?: {
    code: string;
    message: string;
  };
  durationMs: number;
}

export interface WorkerPoolConfig {
  workerType: 'scraper' | 'download';
  minWorkers: number;
  maxWorkers: number;
  idleTimeoutMs: number;
  messageTimeoutMs: number;
}

export interface WorkerState {
  id: string;
  status: 'idle' | 'busy' | 'terminated';
  currentJobId?: string;
  startedAt: number;
  processedCount: number;
}

export interface WorkerPoolMetrics {
  type: 'scraper' | 'download';
  workers: WorkerState[];
  idleCount: number;
  busyCount: number;
  totalProcessed: number;
  avgLatencyMs: number;
}

// ============================================================================
// Tipos Internos do Pool
// ============================================================================

type WorkerInstance = Worker | ChildProcess;

interface PendingJob {
  message: WorkerMessage;
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

interface WorkerWrapper {
  instance: WorkerInstance;
  state: WorkerState;
  pendingJob: PendingJob | null;
  idleTimer: NodeJS.Timeout | null;
}

// ============================================================================
// Worker Pool Genérico
// ============================================================================

export class WorkerPool {
  private readonly config: WorkerPoolConfig;
  private readonly workers: Map<string, WorkerWrapper> = new Map();
  private readonly pendingQueue: PendingJob[] = [];
  private readonly workerPath: string;
  private readonly useWorkerThreads: boolean;
  private totalProcessed = 0;
  private totalLatencyMs = 0;
  private initPromise: Promise<void> | null = null;

  constructor(config: WorkerPoolConfig, workerPath: string, useWorkerThreads: boolean) {
    this.config = {
      minWorkers: config.minWorkers ?? 1,
      maxWorkers: config.maxWorkers ?? 4,
      idleTimeoutMs: config.idleTimeoutMs ?? 300000,
      messageTimeoutMs: config.messageTimeoutMs ?? 120000,
      workerType: config.workerType,
    };
    this.workerPath = workerPath;
    this.useWorkerThreads = useWorkerThreads;
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    for (let i = 0; i < this.config.minWorkers; i += 1) {
      await this.spawn();
    }
  }

  async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  private createWorkerId(): string {
    return `${this.config.workerType}-${randomUUID().slice(0, 8)}`;
  }

  private async spawn(): Promise<string> {
    if (this.workers.size >= this.config.maxWorkers) {
      throw new Error('Worker pool at max capacity');
    }

    const workerId = this.createWorkerId();
    let instance: WorkerInstance;

    if (this.useWorkerThreads) {
      const { Worker } = await import('node:worker_threads');
      instance = new Worker(this.workerPath, {
        eval: false,
        stdin: false,
        stdout: false,
        stderr: false,
      });
    } else {
      const { fork } = await import('node:child_process');
      instance = fork(this.workerPath, [], {
        silent: false,
        stdio: 'pipe',
      });
    }

    const wrapper: WorkerWrapper = {
      instance,
      state: {
        id: workerId,
        status: 'idle',
        startedAt: Date.now(),
        processedCount: 0,
      },
      pendingJob: null,
      idleTimer: null,
    };

    // Setup message handler
    instance.on('message', (response: unknown) => {
      this.handleMessage(workerId, response as WorkerResponse);
    });

    // Setup error handler
    instance.on('error', (error: Error) => {
      console.error(`[WorkerPool:${this.config.workerType}] Worker ${workerId} error:`, error.message);
      this.handleWorkerTermination(workerId);
    });

    // Setup exit handler (for child_process only)
    if (!this.useWorkerThreads) {
      (instance as ChildProcess).on('exit', (code: number | null) => {
        if (code !== 0 && code !== null) {
          console.warn(`[WorkerPool:${this.config.workerType}] Worker ${workerId} exited with code ${code}`);
          this.handleWorkerTermination(workerId);
        }
      });
    }

    this.workers.set(workerId, wrapper);
    console.warn(`[WorkerPool:${this.config.workerType}] Spawned worker ${workerId}`);

    return workerId;
  }

  private handleMessage(workerId: string, response: WorkerResponse): void {
    // Ignorar mensagens sem ID (e.g., READY, HEALTH_CHECK responses)
    if (!response.id) {
      console.log(`[WorkerPool:${this.config.workerType}] Worker ${workerId} sent message without ID, ignoring`);
      return;
    }

    const wrapper = this.workers.get(workerId);
    if (!wrapper || !wrapper.pendingJob) {
      console.warn(`[WorkerPool:${this.config.workerType}] Received message for unknown job: ${response.id}`);
      return;
    }

    const { resolve, timeoutId } = wrapper.pendingJob;
    clearTimeout(timeoutId);

    wrapper.state.status = 'idle';
    wrapper.state.currentJobId = undefined;
    wrapper.state.processedCount += 1;
    wrapper.pendingJob = null;

    this.totalProcessed += 1;
    this.totalLatencyMs += response.durationMs;

    // Reset idle timer
    this.resetIdleTimer(workerId);

    resolve(response);

    // Process next job in queue
    this.processNextJob();
  }

  private handleWorkerTermination(workerId: string): void {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      return;
    }

    // Reject pending job if any
    if (wrapper.pendingJob) {
      const { reject, timeoutId } = wrapper.pendingJob;
      clearTimeout(timeoutId);
      reject(new Error(`Worker ${workerId} terminated unexpectedly`));
      wrapper.pendingJob = null;
    }

    wrapper.state.status = 'terminated';
    this.workers.delete(workerId);

    // Try to spawn a replacement worker
    if (this.workers.size < this.config.minWorkers) {
      void this.spawn();
    }
  }

  private resetIdleTimer(workerId: string): void {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      return;
    }

    if (wrapper.idleTimer) {
      clearTimeout(wrapper.idleTimer);
    }

    wrapper.idleTimer = setTimeout(() => {
      if (wrapper.state.status === 'idle' && this.workers.size > this.config.minWorkers) {
        console.warn(`[WorkerPool:${this.config.workerType}] Terminating idle worker ${workerId}`);
        this.terminate(workerId);
      }
    }, this.config.idleTimeoutMs);
  }

  private findAvailableWorker(): string | null {
    for (const [id, wrapper] of this.workers) {
      if (wrapper.state.status === 'idle') {
        return id;
      }
    }
    return null;
  }

  private async processNextJob(): Promise<void> {
    if (this.pendingQueue.length === 0) {
      return;
    }

    const workerId = this.findAvailableWorker();
    if (!workerId) {
      // Try to spawn new worker if under max
      if (this.workers.size < this.config.maxWorkers) {
        await this.spawn();
      }
      return;
    }

    const job = this.pendingQueue.shift();
    if (!job) {
      return;
    }

    this.sendToWorker(workerId, job);
  }

  private sendToWorker(workerId: string, job: PendingJob): void {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      job.reject(new Error(`Worker ${workerId} not found`));
      return;
    }

    wrapper.state.status = 'busy';
    wrapper.state.currentJobId = job.message.id;
    wrapper.pendingJob = job;

    // Setup timeout
    job.timeoutId = setTimeout(() => {
      console.error(`[WorkerPool:${this.config.workerType}] Job ${job.message.id} timed out`);
      this.handleWorkerTermination(workerId);
    }, this.config.messageTimeoutMs);

    // Send message
    if (this.useWorkerThreads) {
      (wrapper.instance as Worker).postMessage(job.message);
    } else {
      (wrapper.instance as ChildProcess).send(job.message);
    }
  }

  async postMessage<TReq, TRes>(
    type: WorkerMessageType,
    payload: TReq,
    correlationId?: string,
  ): Promise<WorkerResponse<TRes>> {
    await this.ready();

    const message: WorkerMessage<TReq> = {
      id: randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
      correlationId,
    };

    return new Promise((resolve, reject) => {
      const workerId = this.findAvailableWorker();

      if (workerId) {
        const wrapper = this.workers.get(workerId);
        if (wrapper) {
          const job: PendingJob = {
            message,
            resolve: resolve as (response: WorkerResponse) => void,
            reject,
            timeoutId: setTimeout(() => {}, 0), // Will be set in sendToWorker
          };
          this.sendToWorker(workerId, job);
          return;
        }
      }

      // No worker available, add to queue
      if (this.workers.size >= this.config.maxWorkers) {
        const queuedJob: PendingJob = {
          message,
          resolve: resolve as (response: WorkerResponse) => void,
          reject,
          timeoutId: setTimeout(() => {}, 0),
        };
        this.pendingQueue.push(queuedJob);
        return;
      }

      // Spawn new worker and send immediately
      (async () => {
        try {
          const newWorkerId = await this.spawn();
          const wrapper = this.workers.get(newWorkerId);
          if (wrapper) {
            const job: PendingJob = {
              message,
              resolve: resolve as (response: WorkerResponse) => void,
              reject,
              timeoutId: setTimeout(() => {}, 0),
            };
            this.sendToWorker(newWorkerId, job);
          }
        } catch (err) {
          reject(err);
        }
      })();
    });
  }

  async terminate(workerId: string): Promise<void> {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) {
      return;
    }

    if (wrapper.idleTimer) {
      clearTimeout(wrapper.idleTimer);
    }

    wrapper.state.status = 'terminated';

    try {
      if (this.useWorkerThreads) {
        await (wrapper.instance as Worker).terminate();
      } else {
        (wrapper.instance as ChildProcess).kill('SIGTERM');
      }
    } catch (err) {
      console.warn(`[WorkerPool:${this.config.workerType}] Error terminating worker ${workerId}:`, err);
    }

    this.workers.delete(workerId);
    console.warn(`[WorkerPool:${this.config.workerType}] Terminated worker ${workerId}`);
  }

  async terminateAll(): Promise<void> {
    const terminatePromises = Array.from(this.workers.keys()).map((id) => this.terminate(id));
    await Promise.all(terminatePromises);
  }

  getStats(): WorkerPoolMetrics {
    const workers: WorkerState[] = [];
    let idleCount = 0;
    let busyCount = 0;

    for (const wrapper of this.workers.values()) {
      workers.push({ ...wrapper.state });
      if (wrapper.state.status === 'idle') {
        idleCount += 1;
      } else if (wrapper.state.status === 'busy') {
        busyCount += 1;
      }
    }

    return {
      type: this.config.workerType,
      workers,
      idleCount,
      busyCount,
      totalProcessed: this.totalProcessed,
      avgLatencyMs: this.totalProcessed > 0 ? this.totalLatencyMs / this.totalProcessed : 0,
    };
  }

  getQueueLength(): number {
    return this.pendingQueue.length;
  }
}

// ============================================================================
// Factories para criar pools específicos
// ============================================================================

export function createScraperPool(workerPath: string): WorkerPool {
  return new WorkerPool(
    {
      workerType: 'scraper',
      minWorkers: Number(process.env.WORKER_POOL_MIN ?? 1),
      maxWorkers: Number(process.env.WORKER_POOL_MAX ?? 4),
      idleTimeoutMs: Number(process.env.WORKER_IDLE_TIMEOUT_MS ?? 300000),
      messageTimeoutMs: 180000, // 3 min para scrape
    },
    workerPath,
    true, // worker_threads for CPU-bound
  );
}

export function createDownloadPool(workerPath: string): WorkerPool {
  return new WorkerPool(
    {
      workerType: 'download',
      minWorkers: Number(process.env.WORKER_POOL_MIN ?? 1),
      maxWorkers: Number(process.env.WORKER_POOL_MAX ?? 4),
      idleTimeoutMs: Number(process.env.WORKER_IDLE_TIMEOUT_MS ?? 300000),
      messageTimeoutMs: 300000, // 5 min para download
    },
    workerPath,
    false, // child_process for I/O-bound
  );
}
