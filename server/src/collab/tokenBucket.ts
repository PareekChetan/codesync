/**
 * Token-bucket rate limiter, one per WebSocket connection.
 * Allows short bursts (fast typing, pasting) while capping sustained abuse.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  tryTake(cost = 1): boolean {
    const t = this.now();
    const elapsed = (t - this.last) / 1000;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
