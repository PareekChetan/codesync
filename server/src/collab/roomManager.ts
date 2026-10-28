import type { WebSocket } from 'ws';
import { logger } from '../logger.js';
import { activeRooms } from '../metrics.js';
import type { Bridge } from './bridge.js';
import type { DocStore } from './docStore.js';
import { CollabRoom, type RoomOptions } from './room.js';

/**
 * Keeps the set of rooms loaded on this instance.
 *
 * - Rooms load lazily on first connection and unload shortly after the last
 *   person leaves, so memory scales with *active* rooms, not total rooms.
 * - Concurrent first-joins share one load promise (no double loading).
 */
export class RoomManager {
  private rooms = new Map<string, Promise<CollabRoom>>();
  private unloadTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: DocStore,
    private readonly bridge: Bridge,
    private readonly options: RoomOptions & { unloadDelayMs?: number },
  ) {}

  get size(): number {
    return this.rooms.size;
  }

  async join(roomId: string, conn: WebSocket): Promise<CollabRoom> {
    this.cancelUnload(roomId);
    let pending = this.rooms.get(roomId);
    if (!pending) {
      const room = new CollabRoom(roomId, this.store, this.bridge, this.options);
      pending = room.init().then(() => room);
      this.rooms.set(roomId, pending);
      activeRooms.set(this.rooms.size);
      pending.catch(() => {
        this.rooms.delete(roomId);
        activeRooms.set(this.rooms.size);
      });
    }
    const room = await pending;
    room.addConnection(conn);
    return room;
  }

  leave(room: CollabRoom, conn: WebSocket): void {
    room.removeConnection(conn);
    if (room.conns.size === 0) this.scheduleUnload(room);
  }

  /** Number of clients connected to a room on THIS instance. */
  async localClientCount(roomId: string): Promise<number> {
    const pending = this.rooms.get(roomId);
    return pending ? (await pending).conns.size : 0;
  }

  private scheduleUnload(room: CollabRoom): void {
    this.cancelUnload(room.id);
    // A short grace period avoids reload churn when someone refreshes the page.
    const timer = setTimeout(async () => {
      this.unloadTimers.delete(room.id);
      if (room.conns.size > 0) return;
      this.rooms.delete(room.id);
      activeRooms.set(this.rooms.size);
      await room.destroy();
      logger.debug({ room: room.id }, 'Unloaded room');
    }, this.options.unloadDelayMs ?? 5000);
    this.unloadTimers.set(room.id, timer);
  }

  private cancelUnload(roomId: string): void {
    const timer = this.unloadTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.unloadTimers.delete(roomId);
    }
  }

  /** Graceful shutdown: save every loaded document before the process exits. */
  async shutdown(): Promise<void> {
    for (const timer of this.unloadTimers.values()) clearTimeout(timer);
    this.unloadTimers.clear();
    const rooms = await Promise.allSettled(this.rooms.values());
    this.rooms.clear();
    await Promise.allSettled(
      rooms.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<CollabRoom>).value.destroy()),
    );
    activeRooms.set(0);
  }
}
