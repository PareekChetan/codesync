import { randomBytes } from 'node:crypto';
import { pool, query } from '../db/pool.js';

export const LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'cpp', 'go', 'html', 'css', 'markdown'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Room {
  id: string;
  name: string;
  language: Language;
  ownerId: string;
  ownerName?: string;
  role?: 'owner' | 'editor';
  createdAt: string;
  updatedAt: string;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes (l/1, 0/o)

/** Short, unguessable, URL-safe id. 10 chars of 33 symbols ≈ 50 bits of entropy. */
export function newRoomId(length = 10): string {
  const bytes = randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

const ROOM_COLUMNS = `r.id, r.name, r.language, r.owner_id AS "ownerId", u.name AS "ownerName",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

export async function createRoom(ownerId: string, name: string, language: Language): Promise<Room> {
  const id = newRoomId();
  // A transaction must run on ONE connection, so check a client out of the pool.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO rooms (id, name, language, owner_id) VALUES ($1, $2, $3, $4)', [id, name, language, ownerId]);
    await client.query(`INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, ownerId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return (await findRoom(id))!;
}

export async function findRoom(id: string): Promise<Room | null> {
  const result = await query<Room>(
    `SELECT ${ROOM_COLUMNS} FROM rooms r JOIN users u ON u.id = r.owner_id WHERE r.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listRoomsForUser(userId: string): Promise<Room[]> {
  const result = await query<Room>(
    `SELECT ${ROOM_COLUMNS}, m.role FROM room_members m
     JOIN rooms r ON r.id = m.room_id
     JOIN users u ON u.id = r.owner_id
     WHERE m.user_id = $1
     ORDER BY r.updated_at DESC
     LIMIT 100`,
    [userId],
  );
  return result.rows;
}

/** Opening a room via its link adds you as an editor ("anyone with the link can edit"). */
export async function addMember(roomId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'editor') ON CONFLICT DO NOTHING`,
    [roomId, userId],
  );
}

export async function updateRoom(id: string, fields: { name?: string; language?: Language }): Promise<void> {
  await query(
    `UPDATE rooms SET name = COALESCE($2, name), language = COALESCE($3, language), updated_at = now() WHERE id = $1`,
    [id, fields.name ?? null, fields.language ?? null],
  );
}

export async function deleteRoom(id: string): Promise<void> {
  await query('DELETE FROM rooms WHERE id = $1', [id]);
}
