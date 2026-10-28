import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { codeRuns } from '../metrics.js';
import { HttpError } from '../middleware/errors.js';
import { findRoom } from './repository.js';

export const RUNNABLE = ['javascript', 'typescript', 'python', 'java', 'cpp', 'go'] as const;

const runSchema = z.object({
  language: z.enum(RUNNABLE),
  code: z.string().max(64 * 1024, 'Code must be under 64 KB'),
  stdin: z.string().max(64 * 1024, 'Input must be under 64 KB').default(''),
});

export interface RunResult {
  phase: 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

// Running code is expensive, so each user gets a budget (per user, not per IP).
const runLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.RUNS_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => currentUser(req).id,
  message: { error: 'You are running code too often. Wait a minute and try again.' },
});

/**
 * POST /api/rooms/:id/run  { language, code, stdin }
 *
 * The API never executes code itself. It authenticates the user, applies the
 * rate limit, and forwards the job to the isolated runner service over a
 * private network. If the runner is down, the editor keeps working; only
 * "Run" is unavailable.
 */
export const runRouter = Router({ mergeParams: true });

runRouter.post('/:id/run', requireAuth, runLimiter, async (req, res) => {
  const room = await findRoom(String(req.params.id));
  if (!room) throw new HttpError(404, 'Room not found');
  const job = runSchema.parse(req.body);

  let response: Response;
  try {
    response = await fetch(`${config.RUNNER_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-runner-token': config.RUNNER_TOKEN },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Code runner unreachable');
    codeRuns.inc({ language: job.language, outcome: 'unavailable' });
    throw new HttpError(503, 'Code runner is not available right now');
  }

  const body = (await response.json().catch(() => ({}))) as Partial<RunResult> & { error?: string };
  if (!response.ok) {
    codeRuns.inc({ language: job.language, outcome: 'rejected' });
    throw new HttpError(response.status === 429 ? 429 : 502, body.error ?? 'Code runner failed');
  }

  const outcome = body.timedOut ? 'timeout' : body.phase === 'compile' ? 'compile_error' : body.exitCode === 0 ? 'ok' : 'runtime_error';
  codeRuns.inc({ language: job.language, outcome });
  res.json({ result: body });
});
