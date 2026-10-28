import * as Y from 'yjs';
import { pool, query } from '../db/pool.js';
import { persistDuration } from '../metrics.js';

/** Where document snapshots live. An interface so tests can swap in memory storage. */
export interface DocStore {
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, state: Uint8Array): Promise<void>;
}

export class PostgresDocStore implements DocStore {
  async load(roomId: string): Promise<Uint8Array | null> {
    const result = await query<{ state: Buffer }>('SELECT state FROM documents WHERE room_id = $1', [roomId]);
    return result.rows[0] ? new Uint8Array(result.rows[0].state) : null;
  }

  /**
   * Saving is a CRDT *merge*, not an overwrite.
   *
   * Several instances may hold the same room and save it concurrently. A plain
   * "last write wins" UPSERT could let an instance with a slightly older view
   * overwrite edits another instance just saved. Instead we lock the row,
   * merge the stored state with ours (Yjs merges are commutative and
   * idempotent), and write the union. No save can ever lose an edit.
   */
  async save(roomId: string, state: Uint8Array): Promise<void> {
    const end = persistDuration.startTimer();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ state: Buffer }>(
        'SELECT state FROM documents WHERE room_id = $1 FOR UPDATE',
        [roomId],
      );
      const merged = existing.rows[0]
        ? Y.mergeUpdates([new Uint8Array(existing.rows[0].state), state])
        : state;
      await client.query(
        `INSERT INTO documents (room_id, state, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (room_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [roomId, Buffer.from(merged)],
      );
      await client.query('UPDATE rooms SET updated_at = now() WHERE id = $1', [roomId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      end();
    }
  }
}

export class MemoryDocStore implements DocStore {
  readonly data = new Map<string, Uint8Array>();
  async load(roomId: string) {
    return this.data.get(roomId) ?? null;
  }
  async save(roomId: string, state: Uint8Array) {
    const existing = this.data.get(roomId);
    this.data.set(roomId, existing ? Y.mergeUpdates([existing, state]) : state);
  }
}
