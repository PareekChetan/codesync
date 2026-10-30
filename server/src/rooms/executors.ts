import { config } from '../config.js';

/**
 * Code-execution backends. The API talks to an Executor and doesn't care which one:
 *
 *  - RunnerExecutor: our own sandboxed runner service (see /runner). Used with
 *    docker-compose and VM deploys. Full control over limits and isolation.
 *  - Judge0Executor: the hosted Judge0 API. Used on free platforms (like Render)
 *    where we can't install compilers or run a second container.
 *
 * Swapping backends is one environment variable (RUNNER_MODE).
 */
export type RunLanguage = 'javascript' | 'typescript' | 'python' | 'java' | 'cpp' | 'go';

export interface RunJob {
  language: RunLanguage;
  code: string;
  stdin: string;
}

export interface RunResult {
  phase: 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

/** Thrown when the backend can't be reached or rejected the job. */
export class ExecutorError extends Error {
  constructor(public status: 429 | 502 | 503, message: string) {
    super(message);
  }
}

export interface Executor {
  run(job: RunJob): Promise<RunResult>;
}

// ------------------------------------------------------------------ own runner

export class RunnerExecutor implements Executor {
  constructor(
    private url = config.RUNNER_URL,
    private token = config.RUNNER_TOKEN,
  ) {}

  async run(job: RunJob): Promise<RunResult> {
    let response: Response;
    try {
      response = await fetch(`${this.url}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-runner-token': this.token },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new ExecutorError(503, 'Code runner is not available right now');
    }
    const body = (await response.json().catch(() => ({}))) as Partial<RunResult> & { error?: string };
    if (!response.ok) {
      throw new ExecutorError(response.status === 429 ? 429 : 502, body.error ?? 'Code runner failed');
    }
    return body as RunResult;
  }
}

// ------------------------------------------------------------------ Judge0

/** Judge0 CE language ids (stable across Judge0 CE releases). */
export const JUDGE0_LANGUAGE_IDS: Record<RunLanguage, number> = {
  javascript: 63, // Node.js 12
  typescript: 74, // TypeScript 3.7
  python: 71, // Python 3.8
  java: 62, // OpenJDK 13
  cpp: 54, // GCC 9.2
  go: 60, // Go 1.13
};

// https://ce.judge0.com/#statuses-and-languages-status
const STATUS_TLE = 5;
const STATUS_COMPILE_ERROR = 6;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: string | null | undefined) => (s ? Buffer.from(s, 'base64').toString('utf8') : '');

/**
 * Judge0 compiles Java as Main.java, so the entry class must be called Main.
 * Our editor lets people write `class Solution { public static void main... }`
 * (LeetCode style), so: drop `public` from top-level classes and, if there's no
 * Main class, add a tiny Main that calls the class that has main().
 */
export function adaptJavaForJudge0(code: string): string {
  const withoutPublic = code.replace(/^(\s*)public\s+((?:final\s+|abstract\s+)*class\s)/gm, '$1$2');
  if (/\bclass\s+Main\b/.test(withoutPublic)) return withoutPublic;
  const mainClass = findClassWithMain(withoutPublic);
  if (!mainClass) return withoutPublic;
  return `${withoutPublic}\n\nclass Main {\n    public static void main(String[] args) throws Exception {\n        ${mainClass}.main(args);\n    }\n}\n`;
}

function findClassWithMain(code: string): string | null {
  const mainIdx = code.search(/static\s+void\s+main\s*\(/);
  if (mainIdx === -1) return null;
  // The nearest class declaration before main() is the one that contains it.
  let found: string | null = null;
  for (const m of code.slice(0, mainIdx).matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) found = m[1];
  return found;
}

interface Judge0Response {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  status?: { id: number; description: string };
  error?: string;
}

export class Judge0Executor implements Executor {
  constructor(
    private url = config.JUDGE0_URL,
    private key = config.JUDGE0_KEY,
    private host = config.JUDGE0_HOST,
  ) {}

  async run(job: RunJob): Promise<RunResult> {
    const source = job.language === 'java' ? adaptJavaForJudge0(job.code) : job.code;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.key) {
      headers['X-RapidAPI-Key'] = this.key;
      headers['X-RapidAPI-Host'] = this.host;
    }

    let response: Response;
    const started = performance.now();
    try {
      response = await fetch(`${this.url}/submissions?base64_encoded=true&wait=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          language_id: JUDGE0_LANGUAGE_IDS[job.language],
          source_code: b64(source),
          stdin: b64(job.stdin),
          cpu_time_limit: 5,
          wall_time_limit: 10,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ExecutorError(503, 'Code runner is not available right now');
    }

    const body = (await response.json().catch(() => ({}))) as Judge0Response;
    if (response.status === 429) {
      throw new ExecutorError(429, 'Daily run limit reached on the free plan. Please try again later.');
    }
    if (!response.ok) {
      throw new ExecutorError(502, body.error ?? body.message ?? `Code runner failed (${response.status})`);
    }

    const statusId = body.status?.id ?? 0;
    const compileFailed = statusId === STATUS_COMPILE_ERROR;
    const timedOut = statusId === STATUS_TLE;
    const stderr = [unb64(body.stderr), compileFailed ? unb64(body.compile_output) : '', statusId > 6 ? unb64(body.message) : '']
      .filter(Boolean)
      .join('\n');
    const time = Number(body.time);

    return {
      phase: compileFailed ? 'compile' : 'run',
      stdout: unb64(body.stdout),
      stderr,
      exitCode: statusId === 3 ? 0 : 1,
      timedOut,
      truncated: false,
      durationMs: Number.isFinite(time) && time > 0 ? Math.round(time * 1000) : Math.round(performance.now() - started),
    };
  }
}

export function createExecutor(): Executor {
  return config.RUNNER_MODE === 'judge0' ? new Judge0Executor() : new RunnerExecutor();
}
