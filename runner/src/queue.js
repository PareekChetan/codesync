/**
 * Concurrency limiter with a bounded wait queue (backpressure).
 *
 * Code execution is CPU-heavy. Running too many programs at once makes every
 * one of them slow and can starve the machine, so we run at most `concurrency`
 * at a time and queue up to `maxQueue` more. Beyond that we reject immediately
 * with QueueFullError (HTTP 429): failing fast beats timing out for everyone.
 */
export class QueueFullError extends Error {
  constructor() {
    super('Runner is busy, please try again in a moment');
  }
}

export class Limiter {
  #active = 0;
  #waiting = [];

  constructor(concurrency, maxQueue) {
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#waiting.length;
  }

  async run(task) {
    if (this.#active >= this.concurrency) {
      if (this.#waiting.length >= this.maxQueue) throw new QueueFullError();
      await new Promise((resolve) => this.#waiting.push(resolve));
    }
    this.#active++;
    try {
      return await task();
    } finally {
      this.#active--;
      this.#waiting.shift()?.();
    }
  }
}
