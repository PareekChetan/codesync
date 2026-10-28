import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { wsConnections } from '../metrics.js';
import { addMember, findRoom } from '../rooms/repository.js';
import type { RoomManager } from './roomManager.js';
import { TokenBucket } from './tokenBucket.js';

const HEARTBEAT_MS = 30_000;
const ROOM_PATH = /^\/ws\/([a-z0-9]{6,32})$/;

function reject(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Attaches the collaboration WebSocket endpoint to the HTTP server.
 *
 *   ws(s)://host/ws/<roomId>?token=<jwt>
 *
 * Auth and room checks happen during the HTTP upgrade, BEFORE a socket is
 * accepted, so unauthenticated clients never get a connection at all.
 */
export function attachCollabServer(server: Server, rooms: RoomManager): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.MAX_MESSAGE_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = ROOM_PATH.exec(url.pathname);
      if (!match) return reject(socket, 404, 'Not Found');
      const roomId = match[1];

      const user = verifyToken(url.searchParams.get('token'));
      if (!user) return reject(socket, 401, 'Unauthorized');

      const room = await findRoom(roomId);
      if (!room) return reject(socket, 404, 'Not Found');

      if ((await rooms.localClientCount(roomId)) >= config.MAX_CLIENTS_PER_ROOM) {
        return reject(socket, 429, 'Too Many Requests');
      }

      await addMember(roomId, user.id);
      wss.handleUpgrade(req, socket, head, (ws) => void onConnection(ws, roomId, user.id));
    } catch (err) {
      logger.error({ err }, 'WebSocket upgrade failed');
      reject(socket, 500, 'Internal Server Error');
    }
  });

  async function onConnection(ws: WebSocket, roomId: string, userId: string) {
    ws.binaryType = 'arraybuffer';
    wsConnections.inc();
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    // Up to 300 messages in a burst, 100/s sustained. Plenty for fast typing.
    const bucket = new TokenBucket(300, 100);

    // Buffer messages that arrive while the room is still loading from the DB.
    const queue: Uint8Array[] = [];
    let room: Awaited<ReturnType<RoomManager['join']>> | null = null;
    let closed = false;

    ws.on('message', (data: ArrayBuffer) => {
      if (!bucket.tryTake()) {
        logger.warn({ roomId, userId }, 'Client exceeded message rate; closing');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }
      const bytes = new Uint8Array(data);
      if (!room) {
        queue.push(bytes);
        return;
      }
      try {
        room.handleMessage(ws, bytes);
      } catch (err) {
        logger.warn({ err, roomId }, 'Bad message from client; closing');
        ws.close(1003, 'Invalid message');
      }
    });

    ws.on('close', () => {
      closed = true;
      wsConnections.dec();
      if (room) rooms.leave(room, ws);
    });

    try {
      room = await rooms.join(roomId, ws);
      if (closed) {
        rooms.leave(room, ws);
        return;
      }
      for (const msg of queue.splice(0)) room.handleMessage(ws, msg);
      logger.debug({ roomId, userId }, 'Client joined room');
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to load room');
      ws.close(1011, 'Could not load room');
    }
  }

  // Detect and drop dead connections (laptop lid closed, network dropped).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
