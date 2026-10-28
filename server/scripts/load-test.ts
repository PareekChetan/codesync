/**
 * Load test: opens many real collaborative clients and measures how long an
 * edit takes to reach every other user in the room (end-to-end latency).
 *
 *   npm run load-test
 *   ROOMS=50 CLIENTS_PER_ROOM=6 DURATION_S=30 WS_URLS=ws://localhost:4001/ws,ws://localhost:4002/ws npm run load-test
 *
 * Point WS_URLS at two instances to measure the cross-instance (Redis) path.
 */
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

process.setMaxListeners(0);

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const WS_URLS = (process.env.WS_URLS ?? 'ws://localhost:4000/ws').split(',');
const ROOMS = Number(process.env.ROOMS ?? 20);
const CLIENTS_PER_ROOM = Number(process.env.CLIENTS_PER_ROOM ?? 5);
const DURATION_S = Number(process.env.DURATION_S ?? 20);
const EDITS_PER_SEC = Number(process.env.EDITS_PER_SEC ?? 5); // per client: a fast typist

async function api(path: string, body: unknown, token?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const email = `load-${Date.now()}@example.com`;
  const { token } = await api('/api/auth/register', { email, name: 'Load Test', password: 'loadtest-password' });

  console.log(`Creating ${ROOMS} rooms x ${CLIENTS_PER_ROOM} clients across ${WS_URLS.length} instance(s)...`);
  const latencies: number[] = [];
  const clients: Array<{ provider: WebsocketProvider; doc: Y.Doc }> = [];
  let edits = 0;
  let clientIndex = 0;

  for (let r = 0; r < ROOMS; r++) {
    const { room } = await api('/api/rooms', { name: `load ${r}`, language: 'javascript' }, token);
    for (let c = 0; c < CLIENTS_PER_ROOM; c++) {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(WS_URLS[clientIndex++ % WS_URLS.length], room.id, doc, {
        WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
        params: { token },
        disableBc: true,
      });
      // Every edit carries its send time; receivers record how long it took to arrive.
      doc.getMap<number>('pings').observe((event) => {
        if (event.transaction.local) return;
        for (const key of event.keysChanged) {
          const sentAt = doc.getMap<number>('pings').get(key);
          if (sentAt) latencies.push(performance.timeOrigin + performance.now() - sentAt);
        }
      });
      clients.push({ provider, doc });
    }
  }

  await Promise.all(
    clients.map(({ provider }) => new Promise<void>((res) => (provider.synced ? res() : provider.once('sync', () => res())))),
  );
  console.log(`${clients.length} clients connected. Typing for ${DURATION_S}s at ${EDITS_PER_SEC} edits/s each...`);

  const timers = clients.map(({ doc }, i) =>
    setInterval(() => {
      doc.transact(() => {
        doc.getText('code').insert(doc.getText('code').length, 'x');
        doc.getMap<number>('pings').set(String(i), performance.timeOrigin + performance.now());
      });
      edits++;
    }, 1000 / EDITS_PER_SEC),
  );

  await new Promise((r) => setTimeout(r, DURATION_S * 1000));
  timers.forEach(clearInterval);
  await new Promise((r) => setTimeout(r, 1000)); // let in-flight messages land

  const sorted = latencies.sort((a, b) => a - b);
  console.log('\n=== Results ===');
  console.log(`Concurrent clients:     ${clients.length}`);
  console.log(`Edits sent:             ${edits} (${Math.round(edits / DURATION_S)}/s)`);
  console.log(`Updates delivered:      ${sorted.length} (${Math.round(sorted.length / DURATION_S)}/s)`);
  console.log(`Latency p50:            ${percentile(sorted, 50).toFixed(1)} ms`);
  console.log(`Latency p95:            ${percentile(sorted, 95).toFixed(1)} ms`);
  console.log(`Latency p99:            ${percentile(sorted, 99).toFixed(1)} ms`);

  // Every client in a room must end with identical text.
  const byRoom = new Map<string, string[]>();
  for (const { provider, doc } of clients) {
    const list = byRoom.get(provider.roomname) ?? [];
    list.push(doc.getText('code').toString());
    byRoom.set(provider.roomname, list);
  }
  const diverged = [...byRoom.values()].filter((texts) => new Set(texts).size > 1).length;
  console.log(`Rooms converged:        ${byRoom.size - diverged}/${byRoom.size}`);

  clients.forEach(({ provider, doc }) => {
    provider.destroy();
    doc.destroy();
  });
  process.exit(diverged === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
