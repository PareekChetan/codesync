import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { WebSocket } from 'ws';
import { logger } from '../logger.js';
import { wsMessages } from '../metrics.js';
import type { Bridge, BridgeMessage } from './bridge.js';
import type { DocStore } from './docStore.js';

// Wire protocol message types (compatible with the standard y-websocket client).
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;

// "Origins" tag where a change came from, so we never echo it back to its source.
const ORIGIN_PERSISTENCE = Symbol('persistence');
const ORIGIN_REMOTE_INSTANCE = Symbol('remote-instance');

export interface RoomOptions {
  persistDebounceMs: number;
  persistMaxWaitMs: number;
}

/**
 * One shared document, as held by ONE server instance.
 *
 * - `doc` is a Yjs CRDT. Concurrent edits from any number of users merge
 *   deterministically with no central locking and no conflicts.
 * - `awareness` is ephemeral presence: who is here, cursor positions, colours.
 * - Changes from local sockets are broadcast to local sockets AND relayed to
 *   other instances via the bridge; changes from the bridge go to local sockets only.
 */
export class CollabRoom {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  /** Each socket -> the awareness client ids it controls (so we can clean up on disconnect). */
  readonly conns = new Map<WebSocket, Set<number>>();

  private persistTimer: NodeJS.Timeout | null = null;
  private firstDirtyAt: number | null = null;
  private saving: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(
    readonly id: string,
    private readonly store: DocStore,
    private readonly bridge: Bridge,
    private readonly options: RoomOptions,
  ) {
    // The server is not a participant, so it publishes no presence of its own.
    this.awareness.setLocalState(null);
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  /** Load from Postgres, join the Redis channel, then catch up from peer instances. */
  async init(): Promise<void> {
    const state = await this.store.load(this.id);
    if (state) Y.applyUpdate(this.doc, state, ORIGIN_PERSISTENCE);

    await this.bridge.subscribe(this.id, this.onBridgeMessage);

    // Another instance may hold edits that are not saved yet. Ask for them.
    // We send our state vector, so peers reply with ONLY what we're missing.
    this.bridge.publish(this.id, { kind: 'sync-request', data: Y.encodeStateVector(this.doc) });
  }

  // ---------------------------------------------------------------- events

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of this.conns.keys()) {
      if (conn !== origin) this.send(conn, message);
    }

    if (origin !== ORIGIN_REMOTE_INSTANCE && origin !== ORIGIN_PERSISTENCE) {
      this.bridge.publish(this.id, { kind: 'update', data: update });
    }
    if (origin !== ORIGIN_PERSISTENCE) this.schedulePersist();
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = added.concat(updated, removed);

    // Remember which awareness ids belong to which socket.
    if (origin && this.conns.has(origin as WebSocket)) {
      const owned = this.conns.get(origin as WebSocket)!;
      added.forEach((id) => owned.add(id));
      removed.forEach((id) => owned.delete(id));
    }

    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of this.conns.keys()) this.send(conn, message);

    if (origin !== ORIGIN_REMOTE_INSTANCE) {
      this.bridge.publish(this.id, { kind: 'awareness', data: update });
    }
  };

  private onBridgeMessage = (msg: BridgeMessage) => {
    if (this.destroyed) return;
    switch (msg.kind) {
      case 'update':
      case 'sync-response':
        Y.applyUpdate(this.doc, msg.data, ORIGIN_REMOTE_INSTANCE);
        break;
      case 'awareness':
        awarenessProtocol.applyAwarenessUpdate(this.awareness, msg.data, ORIGIN_REMOTE_INSTANCE);
        break;
      case 'sync-request': {
        // A peer just loaded this room. Send exactly the edits it is missing,
        // plus the presence of the users connected to us.
        const diff = Y.encodeStateAsUpdate(this.doc, msg.data);
        this.bridge.publish(this.id, { kind: 'sync-response', to: msg.from, data: diff });
        const localClients = [...this.conns.values()].flatMap((s) => [...s]);
        if (localClients.length > 0) {
          this.bridge.publish(this.id, {
            kind: 'awareness',
            data: awarenessProtocol.encodeAwarenessUpdate(this.awareness, localClients),
          });
        }
        break;
      }
    }
  };

  // ---------------------------------------------------------------- sockets

  addConnection(conn: WebSocket): void {
    this.conns.set(conn, new Set());

    // Step 1 of the sync handshake: tell the client what we have.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(conn, encoding.toUint8Array(encoder));

    // And who else is already here.
    const states = this.awareness.getStates();
    if (states.size > 0) {
      this.send(conn, this.encodeAwarenessMessage([...states.keys()]));
    }
  }

  removeConnection(conn: WebSocket): void {
    const owned = this.conns.get(conn);
    if (!owned) return;
    this.conns.delete(conn);
    // Remove this user's cursor for everyone, on every instance.
    awarenessProtocol.removeAwarenessStates(this.awareness, [...owned], null);
  }

  handleMessage(conn: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);

    switch (type) {
      case MESSAGE_SYNC: {
        wsMessages.inc({ type: 'sync' });
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // Handles step1 (reply with step2), step2 and plain updates. `conn` is the origin.
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
        if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        wsMessages.inc({ type: 'awareness' });
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      case MESSAGE_QUERY_AWARENESS: {
        wsMessages.inc({ type: 'query-awareness' });
        this.send(conn, this.encodeAwarenessMessage([...this.awareness.getStates().keys()]));
        break;
      }
      default:
        wsMessages.inc({ type: 'unknown' });
        logger.debug({ type, room: this.id }, 'Ignoring unknown message type');
    }
  }

  private encodeAwarenessMessage(clients: number[]): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients));
    return encoding.toUint8Array(encoder);
  }

  private send(conn: WebSocket, message: Uint8Array): void {
    if (conn.readyState !== conn.OPEN) {
      this.removeConnection(conn);
      return;
    }
    conn.send(message, (err) => {
      if (err) this.removeConnection(conn);
    });
  }

  // ---------------------------------------------------------------- persistence

  /**
   * Debounced save: wait for a pause in typing, but never longer than maxWait.
   * This turns hundreds of keystrokes into one database write.
   */
  private schedulePersist(): void {
    const now = Date.now();
    this.firstDirtyAt ??= now;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const waited = now - this.firstDirtyAt;
    const delay = Math.max(0, Math.min(this.options.persistDebounceMs, this.options.persistMaxWaitMs - waited));
    this.persistTimer = setTimeout(() => void this.flush(), delay);
  }

  /** Write the current state now. Saves are chained so they never overlap. */
  flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (this.firstDirtyAt === null) return this.saving;
    this.firstDirtyAt = null;
    const state = Y.encodeStateAsUpdate(this.doc);
    this.saving = this.saving
      .then(() => this.store.save(this.id, state))
      .catch((err) => {
        logger.error({ err, room: this.id }, 'Failed to persist document; will retry on next edit');
        this.firstDirtyAt ??= Date.now();
      });
    return this.saving;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.flush();
    await this.bridge.unsubscribe(this.id).catch(() => {});
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
