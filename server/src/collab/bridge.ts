import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { redisMessages } from '../metrics.js';

/**
 * Cross-instance message bus.
 *
 * Each server instance only knows about the WebSocket clients connected to it.
 * When two people in the same room land on different instances (because of the
 * load balancer), the instances relay document and presence updates to each
 * other through Redis pub/sub, one channel per room.
 */
export type BridgeKind = 'update' | 'awareness' | 'sync-request' | 'sync-response';

export interface BridgeMessage {
  from: string; // instance id of the sender
  to?: string; // set for directed replies (sync-response)
  kind: BridgeKind;
  data: Uint8Array;
}

export type BridgeHandler = (msg: BridgeMessage) => void;

export interface Bridge {
  readonly instanceId: string;
  subscribe(roomId: string, handler: BridgeHandler): Promise<void>;
  unsubscribe(roomId: string): Promise<void>;
  publish(roomId: string, msg: Omit<BridgeMessage, 'from'>): void;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const channelFor = (roomId: string) => `codesync:room:${roomId}`;

export class RedisBridge implements Bridge {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, BridgeHandler>();

  constructor(
    url: string = config.REDIS_URL,
    readonly instanceId: string = config.INSTANCE_ID,
  ) {
    // Pub/sub needs two connections: a subscribed connection can't publish.
    this.pub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.sub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.pub.on('error', (err) => logger.warn({ err: err.message }, 'Redis publisher error'));
    this.sub.on('error', (err) => logger.warn({ err: err.message }, 'Redis subscriber error'));
    this.sub.on('message', (channel, raw) => this.onMessage(channel, raw));
  }

  private onMessage(channel: string, raw: string) {
    const roomId = channel.slice('codesync:room:'.length);
    const handler = this.handlers.get(roomId);
    if (!handler) return;
    try {
      const parsed = JSON.parse(raw) as { from: string; to?: string; kind: BridgeKind; data: string };
      // Ignore our own echoes and replies meant for another instance.
      if (parsed.from === this.instanceId) return;
      if (parsed.to && parsed.to !== this.instanceId) return;
      redisMessages.inc({ direction: 'in', kind: parsed.kind });
      handler({ ...parsed, data: new Uint8Array(Buffer.from(parsed.data, 'base64')) });
    } catch (err) {
      logger.warn({ err, roomId }, 'Dropped malformed bridge message');
    }
  }

  async subscribe(roomId: string, handler: BridgeHandler): Promise<void> {
    this.handlers.set(roomId, handler);
    await this.sub.subscribe(channelFor(roomId));
  }

  async unsubscribe(roomId: string): Promise<void> {
    this.handlers.delete(roomId);
    await this.sub.unsubscribe(channelFor(roomId));
  }

  publish(roomId: string, msg: Omit<BridgeMessage, 'from'>): void {
    redisMessages.inc({ direction: 'out', kind: msg.kind });
    const payload = JSON.stringify({
      from: this.instanceId,
      to: msg.to,
      kind: msg.kind,
      data: Buffer.from(msg.data).toString('base64'),
    });
    this.pub.publish(channelFor(roomId), payload).catch((err) => {
      logger.warn({ err: err.message, roomId }, 'Failed to publish to Redis');
    });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.pub.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
