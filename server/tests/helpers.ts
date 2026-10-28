import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

// Each y-websocket client adds a process 'exit' listener; tests open many clients.
process.setMaxListeners(100);

export function uniqueEmail() {
  return `user-${randomUUID().slice(0, 8)}@example.com`;
}

export async function registerUser(app: Express | string, name = 'Test User') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: uniqueEmail(), name, password: 'supersecret123' })
    .expect(201);
  return res.body as { token: string; user: { id: string; email: string; name: string } };
}

export async function createRoom(app: Express | string, token: string, name = 'Test room') {
  const res = await request(app)
    .post('/api/rooms')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, language: 'javascript' })
    .expect(201);
  return res.body.room as { id: string };
}

/** A real y-websocket client, exactly what the browser uses. */
export function connectClient(port: number, roomId: string, token: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}/ws`, roomId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    params: { token },
    disableBc: true,
  });
  const text = doc.getText('code');
  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    else provider.once('sync', (isSynced: boolean) => isSynced && resolve());
  });
  return {
    doc,
    text,
    provider,
    synced,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}

/** Poll until a condition holds (real-time systems are asynchronous). */
export async function waitFor(check: () => boolean, timeoutMs = 5000, label = 'condition') {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
