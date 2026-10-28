import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Bridge } from '../src/collab/bridge.js';
import { pool } from '../src/db/pool.js';
import { createRoom, registerUser } from './helpers.js';

// The real runner service from /runner, started in-process on the port vitest.config.ts points at.
// @ts-expect-error plain JavaScript module without type declarations
import { createServer as createRunner } from '../../runner/src/server.js';

const fakeBridge: Bridge = {
  instanceId: 'test',
  subscribe: async () => {},
  unsubscribe: async () => {},
  publish: () => {},
  ping: async () => true,
  close: async () => {},
};
const app = createApp({ bridge: fakeBridge });
let runner: Server;
let token: string;
let roomId: string;

beforeAll(async () => {
  process.env.RUNNER_TOKEN = 'test-runner-token';
  runner = createRunner();
  await new Promise<void>((r) => runner.listen(5099, r));
  token = (await registerUser(app)).token;
  roomId = (await createRoom(app, token)).id;
});

afterAll(async () => {
  runner.close();
  await pool.end();
});

const run = (body: object, t = token) =>
  request(app).post(`/api/rooms/${roomId}/run`).set('Authorization', `Bearer ${t}`).send(body);

describe('code execution', () => {
  it('runs Python with stdin through the runner service', async () => {
    const res = await run({ language: 'python', code: 'print(int(input()) * 2)', stdin: '21' }).expect(200);
    expect(res.body.result).toMatchObject({ phase: 'run', stdout: '42\n', exitCode: 0, timedOut: false });
  });

  it('runs Java with a class named Solution', async () => {
    const code = 'class Solution { public static void main(String[] a) { System.out.println("java ok"); } }';
    const res = await run({ language: 'java', code }).expect(200);
    expect(res.body.result.stdout).toBe('java ok\n');
  });

  it('returns compile errors', async () => {
    const res = await run({ language: 'cpp', code: 'int main( {' }).expect(200);
    expect(res.body.result.phase).toBe('compile');
    expect(res.body.result.exitCode).not.toBe(0);
  });

  it('validates input and requires auth', async () => {
    await run({ language: 'cobol', code: 'x' }).expect(400);
    await request(app).post(`/api/rooms/${roomId}/run`).send({ language: 'python', code: '1' }).expect(401);
    await request(app)
      .post('/api/rooms/doesnotexist/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python', code: '1' })
      .expect(404);
  });

  it('returns 503 when the runner is down (editor keeps working)', async () => {
    await new Promise<void>((r) => runner.close(() => r()));
    const res = await run({ language: 'python', code: 'print(1)' }).expect(503);
    expect(res.body.error).toMatch(/not available/);
    runner = createRunner();
    await new Promise<void>((r) => runner.listen(5099, r));
  });
});
