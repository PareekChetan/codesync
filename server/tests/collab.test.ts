import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { MemoryDocStore, PostgresDocStore } from '../src/collab/docStore.js';
import { pool } from '../src/db/pool.js';
import { startServer, type RunningServer } from '../src/server.js';
import { connectClient, createRoom, registerUser, waitFor } from './helpers.js';

/**
 * These tests start TWO real server instances that share Redis, the same
 * setup as production behind the load balancer, and connect real clients.
 */
let s1: RunningServer;
let s2: RunningServer;
let token: string;
const clients: Array<{ destroy(): void }> = [];

beforeAll(async () => {
  s1 = await startServer({ port: 0, instanceId: 'instance-1', unloadDelayMs: 50 });
  s2 = await startServer({ port: 0, instanceId: 'instance-2', unloadDelayMs: 50 });
  token = (await registerUser(`http://localhost:${s1.port}`)).token;
});

afterAll(async () => {
  clients.forEach((c) => c.destroy());
  await s1.stop();
  await s2.stop();
  await pool.end();
});

function client(server: RunningServer, roomId: string, t = token) {
  const c = connectClient(server.port, roomId, t);
  clients.push(c);
  return c;
}

describe('real-time collaboration', () => {
  it('syncs edits between two users on the SAME instance', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    const alice = client(s1, room.id);
    const bob = client(s1, room.id);
    await Promise.all([alice.synced, bob.synced]);

    alice.text.insert(0, 'console.log("hi")');
    await waitFor(() => bob.text.toString() === 'console.log("hi")', 3000, 'bob to see alice');
  });

  it('syncs edits between users on DIFFERENT instances via Redis', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    const alice = client(s1, room.id);
    const bob = client(s2, room.id);
    await Promise.all([alice.synced, bob.synced]);

    alice.text.insert(0, 'const a = 1;\n');
    await waitFor(() => bob.text.toString() === 'const a = 1;\n', 3000, 'cross-instance edit');

    bob.text.insert(bob.text.length, 'const b = 2;\n');
    await waitFor(() => alice.text.toString() === 'const a = 1;\nconst b = 2;\n', 3000, 'reverse direction');
  });

  it('converges when many users type at the same time across instances', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    const users = [client(s1, room.id), client(s2, room.id), client(s1, room.id), client(s2, room.id)];
    await Promise.all(users.map((u) => u.synced));

    users.forEach((u, i) => {
      for (let n = 0; n < 25; n++) u.text.insert(Math.floor(Math.random() * (u.text.length + 1)), String(i));
    });

    await waitFor(
      () => users.every((u) => u.text.length === 100 && u.text.toString() === users[0].text.toString()),
      5000,
      'all users to converge',
    );
  });

  it('shares presence (who is online, cursors) across instances', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    const alice = client(s1, room.id);
    const bob = client(s2, room.id);
    await Promise.all([alice.synced, bob.synced]);

    alice.provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f00' });
    await waitFor(
      () => [...bob.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Alice'),
      3000,
      'bob to see alice online',
    );

    alice.destroy();
    await waitFor(
      () => ![...bob.provider.awareness.getStates().values()].some((s) => s.user?.name === 'Alice'),
      3000,
      'alice to disappear when she leaves',
    );
  });

  it('a late joiner on another instance gets edits that were never saved', async () => {
    // Separate, empty stores: the ONLY way instance B can learn the content is the Redis sync handshake.
    const a = await startServer({ port: 0, instanceId: 'late-a', store: new MemoryDocStore() });
    const b = await startServer({ port: 0, instanceId: 'late-b', store: new MemoryDocStore() });
    try {
      const room = await createRoom(`http://localhost:${a.port}`, token);
      const alice = client(a, room.id);
      await alice.synced;
      alice.text.insert(0, 'unsaved work');

      const bob = client(b, room.id);
      await bob.synced;
      await waitFor(() => bob.text.toString() === 'unsaved work', 3000, 'late joiner catch-up');
    } finally {
      await a.stop();
      await b.stop();
    }
  });

  it('persists documents to Postgres and reloads them after everyone leaves', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    const alice = client(s1, room.id);
    await alice.synced;
    alice.text.insert(0, 'saved to postgres');

    // Poll the database until the debounced save lands.
    const store = new PostgresDocStore();
    let saved = '';
    for (let i = 0; i < 30 && saved !== 'saved to postgres'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const state = await store.load(room.id);
      if (state) {
        const d = new Y.Doc();
        Y.applyUpdate(d, state);
        saved = d.getText('code').toString();
      }
    }
    expect(saved).toBe('saved to postgres');

    // Everyone leaves and the room unloads from memory. A new visitor still sees the content.
    alice.destroy();
    await new Promise((r) => setTimeout(r, 300));
    const later = client(s2, room.id);
    await later.synced;
    await waitFor(() => later.text.toString() === 'saved to postgres', 3000, 'reload from database');
  });
});

describe('websocket security', () => {
  function tryConnect(url: string): Promise<number | 'open'> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('open', () => {
        ws.close();
        resolve('open');
      });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => {});
    });
  }

  it('rejects connections without a valid token or to unknown rooms', async () => {
    const room = await createRoom(`http://localhost:${s1.port}`, token);
    expect(await tryConnect(`ws://localhost:${s1.port}/ws/${room.id}`)).toBe(401);
    expect(await tryConnect(`ws://localhost:${s1.port}/ws/${room.id}?token=garbage`)).toBe(401);
    expect(await tryConnect(`ws://localhost:${s1.port}/ws/doesnotexist?token=${token}`)).toBe(404);
    expect(await tryConnect(`ws://localhost:${s1.port}/ws/${room.id}?token=${token}`)).toBe('open');
  });
});
