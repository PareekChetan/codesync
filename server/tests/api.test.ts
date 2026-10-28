import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Bridge } from '../src/collab/bridge.js';
import { pool } from '../src/db/pool.js';
import { createRoom, registerUser, uniqueEmail } from './helpers.js';

const fakeBridge: Bridge = {
  instanceId: 'test',
  subscribe: async () => {},
  unsubscribe: async () => {},
  publish: () => {},
  ping: async () => true,
  close: async () => {},
};
const app = createApp({ bridge: fakeBridge });

afterAll(() => pool.end());

describe('auth', () => {
  it('registers, logs in and returns the current user', async () => {
    const email = uniqueEmail();
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email, name: 'Asha', password: 'supersecret123' })
      .expect(201);
    expect(reg.body.token).toBeTypeOf('string');
    expect(reg.body.user).toMatchObject({ email, name: 'Asha' });

    const login = await request(app).post('/api/auth/login').send({ email, password: 'supersecret123' }).expect(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects duplicate emails, bad passwords and invalid input', async () => {
    const { user } = await registerUser(app);
    await request(app)
      .post('/api/auth/register')
      .send({ email: user.email, name: 'Dup', password: 'supersecret123' })
      .expect(409);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
    const bad = await request(app).post('/api/auth/register').send({ email: 'nope', name: '', password: 'x' }).expect(400);
    expect(bad.body.details.length).toBeGreaterThan(0);
  });

  it('protects routes without a valid token', async () => {
    await request(app).get('/api/rooms').expect(401);
    await request(app).get('/api/rooms').set('Authorization', 'Bearer not-a-token').expect(401);
  });
});

describe('rooms', () => {
  it('creates a room and lists it for the owner', async () => {
    const { token } = await registerUser(app);
    const room = await createRoom(app, token, 'Interview prep');
    expect(room.id).toMatch(/^[a-z0-9]{10}$/);

    const list = await request(app).get('/api/rooms').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.rooms).toHaveLength(1);
    expect(list.body.rooms[0]).toMatchObject({ name: 'Interview prep', role: 'owner' });
  });

  it('adds a user as editor when they open a shared link', async () => {
    const owner = await registerUser(app, 'Owner');
    const guest = await registerUser(app, 'Guest');
    const room = await createRoom(app, owner.token);

    await request(app).get(`/api/rooms/${room.id}`).set('Authorization', `Bearer ${guest.token}`).expect(200);
    const list = await request(app).get('/api/rooms').set('Authorization', `Bearer ${guest.token}`).expect(200);
    expect(list.body.rooms[0]).toMatchObject({ id: room.id, role: 'editor', ownerName: 'Owner' });
  });

  it('only lets the owner delete a room', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const room = await createRoom(app, owner.token);
    await request(app).delete(`/api/rooms/${room.id}`).set('Authorization', `Bearer ${other.token}`).expect(403);
    await request(app).delete(`/api/rooms/${room.id}`).set('Authorization', `Bearer ${owner.token}`).expect(204);
    await request(app).get(`/api/rooms/${room.id}`).set('Authorization', `Bearer ${owner.token}`).expect(404);
  });

  it('updates the language', async () => {
    const { token } = await registerUser(app);
    const room = await createRoom(app, token);
    const res = await request(app)
      .patch(`/api/rooms/${room.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'python' })
      .expect(200);
    expect(res.body.room.language).toBe('python');
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    await request(app).get('/healthz').expect(200);
    const ready = await request(app).get('/readyz').expect(200);
    expect(ready.body).toMatchObject({ db: true, redis: true });
    const metrics = await request(app).get('/metrics').expect(200);
    expect(metrics.text).toContain('http_request_duration_seconds');
  });
});
