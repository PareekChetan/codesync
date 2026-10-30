import { existsSync } from 'node:fs';
import path from 'node:path';
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

const PREVIEW_HOST_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
  addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.type !== 'render' || typeof e.data.html !== 'string') return;
    document.open();
    document.write(e.data.html);
    document.close();
  });
  parent.postMessage({ type: 'preview-ready' }, '*');
</script>
</body></html>`;

export function createApp(deps: { bridge: Bridge }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY); // we run behind Nginx (and Caddy in production)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Google Fonts for the UI; blob: workers for the in-browser JavaScript fallback runner.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'worker-src': ["'self'", 'blob:'],
          'img-src': ["'self'", 'data:'],
        },
      },
    }),
  );
  /**
   * Host page for the sandboxed HTML preview (see client PreviewFrame).
   * The client loads it in an <iframe sandbox="allow-scripts"> WITHOUT
   * allow-same-origin, so it runs with an opaque origin and can't read this
   * app's storage or cookies. It gets its own CSP that allows the user's inline
   * scripts and styles, while the rest of the app keeps the strict policy above.
   */
  app.get('/sandbox/preview', (_req, res) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'unsafe-inline' https:",
        "style-src 'unsafe-inline' https:",
        'img-src * data: blob:',
        'font-src * data:',
        'media-src * data: blob:',
        "frame-ancestors 'self'",
      ].join('; '),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(PREVIEW_HOST_HTML);
  });

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

  // Single-service deploys (e.g. Render): the API also serves the built React app,
  // so the site, API and WebSockets share one origin and one free instance.
  if (config.STATIC_DIR && existsSync(config.STATIC_DIR)) {
    const dir = path.resolve(config.STATIC_DIR);
    app.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dir, { index: false, maxAge: 0 }));
    // Client-side routes (/login, /room/abc) all load index.html.
    app.get(/^\/(?!api\/|ws\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
