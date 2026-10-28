import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { availableParallelism } from 'node:os';
import { SUPPORTED } from './languages.js';
import { Limiter, QueueFullError } from './queue.js';
import { runCode } from './sandbox.js';

/**
 * Tiny internal HTTP service. Only the API servers can reach it (it sits on a
 * private Docker network), and every request must carry a shared secret.
 *
 *   POST /run   { language, code, stdin }  ->  { phase, stdout, stderr, exitCode, timedOut, ... }
 *   GET  /healthz
 */
const PORT = Number(process.env.PORT ?? 5050);
const TOKEN = process.env.RUNNER_TOKEN ?? '';
const MAX_CODE = 64 * 1024;
const MAX_STDIN = 64 * 1024;
const MAX_BODY = 200 * 1024;

const limiter = new Limiter(
  Number(process.env.MAX_CONCURRENT_RUNS ?? Math.max(1, availableParallelism() - 1)),
  Number(process.env.MAX_QUEUED_RUNS ?? 20),
);

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), service: 'runner', msg, ...extra }));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!TOKEN) return true; // local development
  const given = Buffer.from(String(req.headers['x-runner-token'] ?? ''));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        return send(res, 200, { ok: true, languages: SUPPORTED, active: limiter.active, queued: limiter.queued });
      }
      if (req.method !== 'POST' || req.url !== '/run') return send(res, 404, { error: 'Not found' });
      if (!authorized(req)) return send(res, 401, { error: 'Unauthorized' });

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.status ? err.message : 'Invalid JSON' });
      }
      const { language, code, stdin = '' } = body ?? {};
      if (!SUPPORTED.includes(language)) return send(res, 400, { error: `Unsupported language: ${language}` });
      if (typeof code !== 'string' || code.length > MAX_CODE) return send(res, 400, { error: 'Code must be under 64 KB' });
      if (typeof stdin !== 'string' || stdin.length > MAX_STDIN) return send(res, 400, { error: 'Input must be under 64 KB' });

      const result = await limiter.run(() => runCode({ language, code, stdin }));
      log('info', 'run', { language, phase: result.phase, exitCode: result.exitCode, ms: result.durationMs, timedOut: result.timedOut });
      return send(res, 200, result);
    } catch (err) {
      if (err instanceof QueueFullError) return send(res, 429, { error: err.message });
      log('error', 'run failed', { error: err.message });
      return send(res, 500, { error: 'Execution failed' });
    }
  });
}

// Start when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  server.listen(PORT, () => log('info', 'Runner listening', { port: PORT, languages: SUPPORTED }));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
