import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated at boot.
 * Failing fast on bad config is far better than failing at 3am on the first request.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('postgres://codesync:codesync@localhost:5432/codesync'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** How long to wait after the last edit before writing a document to Postgres. */
  PERSIST_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(2000),
  /** Hard cap so one hot document can never go unsaved for too long. */
  PERSIST_MAX_WAIT_MS: z.coerce.number().int().positive().default(10000),
  MAX_CLIENTS_PER_ROOM: z.coerce.number().int().positive().default(50),
  MAX_MESSAGE_BYTES: z.coerce.number().int().positive().default(1024 * 1024),
  LOG_LEVEL: z.string().default('info'),
  /** Number of reverse proxies in front of the API (Nginx = 1; Caddy + Nginx = 2). Used for client IPs in rate limits. */
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),
  /** Internal code-runner service (see /runner). */
  RUNNER_URL: z.string().default('http://localhost:5050'),
  RUNNER_TOKEN: z.string().default(''),
  RUNS_PER_MINUTE: z.coerce.number().int().positive().default(20),
  INSTANCE_ID: z.string().default(() => randomUUID().slice(0, 8)),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.startsWith('dev-only')) {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
