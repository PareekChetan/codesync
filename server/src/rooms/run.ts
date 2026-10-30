import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { codeRuns } from '../metrics.js';
import { HttpError } from '../middleware/errors.js';
import { createExecutor, ExecutorError, type Executor } from './executors.js';
import { findRoom } from './repository.js';

export type { RunResult } from './executors.js';

export const RUNNABLE = ['javascript', 'typescript', 'python', 'java', 'cpp', 'go'] as const;

const runSchema = z.object({
  language: z.enum(RUNNABLE),
  code: z.string().max(64 * 1024, 'Code must be under 64 KB'),
  stdin: z.string().max(64 * 1024, 'Input must be under 64 KB').default(''),
});

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
 * rate limit, and hands the job to an Executor: our own isolated runner service,
 * or the Judge0 API (RUNNER_MODE). If the backend is down, the editor keeps
 * working; only "Run" is unavailable.
 */
export function createRunRouter(executor: Executor = createExecutor()) {
  const router = Router({ mergeParams: true });

  router.post('/:id/run', requireAuth, runLimiter, async (req, res) => {
    const room = await findRoom(String(req.params.id));
    if (!room) throw new HttpError(404, 'Room not found');
    const job = runSchema.parse(req.body);

    try {
      const result = await executor.run(job);
      const outcome = result.timedOut
        ? 'timeout'
        : result.phase === 'compile'
          ? 'compile_error'
          : result.exitCode === 0
            ? 'ok'
            : 'runtime_error';
      codeRuns.inc({ language: job.language, outcome });
      res.json({ result });
    } catch (err) {
      if (err instanceof ExecutorError) {
        logger.warn({ err: err.message, status: err.status }, 'Code execution failed');
        codeRuns.inc({ language: job.language, outcome: err.status === 503 ? 'unavailable' : 'rejected' });
        throw new HttpError(err.status, err.message);
      }
      throw err;
    }
  });

  return router;
}

export const runRouter = createRunRouter();
