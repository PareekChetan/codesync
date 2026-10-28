import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authRouter } from './auth/routes.js';
import type { Bridge } from './collab/bridge.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { logger } from './logger.js';
import { httpDuration, registry } from './metrics.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { roomsRouter } from './rooms/routes.js';
import { runRouter } from './rooms/run.js';

export function createApp(deps: { bridge: Bridge }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY); // we run behind Nginx (and Caddy in production)

  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/metrics' } }));

  // Record latency for every request, labelled by route pattern (not raw URL, to keep cardinality low).
  app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  });

  // Liveness: the process is up. Readiness: it can actually serve traffic.
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', instance: config.INSTANCE_ID });
  });
  app.get('/readyz', async (_req, res) => {
    const [db, redis] = await Promise.all([
      pool.query('SELECT 1').then(() => true, () => false),
      deps.bridge.ping(),
    ]);
    res.status(db && redis ? 200 : 503).json({ db, redis, instance: config.INSTANCE_ID });
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  app.use('/api/auth', authRouter);
  app.use('/api/rooms', runRouter);
  app.use('/api/rooms', roomsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
