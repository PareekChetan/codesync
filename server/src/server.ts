import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { RedisBridge, type Bridge } from './collab/bridge.js';
import { PostgresDocStore, type DocStore } from './collab/docStore.js';
import { RoomManager } from './collab/roomManager.js';
import { attachCollabServer } from './collab/wsServer.js';
import { config } from './config.js';

export interface RunningServer {
  port: number;
  rooms: RoomManager;
  bridge: Bridge;
  stop(): Promise<void>;
}

/** Wires everything together. Used by index.ts and by the integration tests. */
export async function startServer(opts: {
  port?: number;
  instanceId?: string;
  store?: DocStore;
  unloadDelayMs?: number;
} = {}): Promise<RunningServer> {
  const bridge = new RedisBridge(config.REDIS_URL, opts.instanceId ?? config.INSTANCE_ID);
  const rooms = new RoomManager(opts.store ?? new PostgresDocStore(), bridge, {
    persistDebounceMs: config.PERSIST_DEBOUNCE_MS,
    persistMaxWaitMs: config.PERSIST_MAX_WAIT_MS,
    unloadDelayMs: opts.unloadDelayMs,
  });

  const app = createApp({ bridge });
  const server = http.createServer(app);
  const wss = attachCollabServer(server, rooms);

  await new Promise<void>((resolve) => server.listen(opts.port ?? config.PORT, resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    rooms,
    bridge,
    async stop() {
      // Order matters: stop accepting, close sockets, save documents, then disconnect.
      for (const client of wss.clients) client.close(1001, 'Server shutting down');
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rooms.shutdown();
      await bridge.close();
    },
  };
}
