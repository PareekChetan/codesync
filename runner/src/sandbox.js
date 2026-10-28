import { spawn } from 'node:child_process';
import { chownSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from './languages.js';

/**
 * Runs untrusted code. Defence in depth, from the inside out:
 *
 *  1. prlimit:   CPU seconds, max processes (stops fork bombs), max file size,
 *                and virtual memory where the runtime allows it.
 *  2. Wall-clock timeout that SIGKILLs the whole process group (sleep/IO loops).
 *  3. Output cap: a program printing forever is killed once it passes the cap.
 *  4. Unprivileged user: when the service runs as root, every child drops to
 *     SANDBOX_UID, so it can't touch the service's files or other runs.
 *  5. Fresh temp directory per run, deleted afterwards. Minimal environment.
 *  6. The container itself (see docker-compose.yml): no internet, read-only
 *     filesystem, all Linux capabilities dropped except setuid/setgid,
 *     memory/CPU/pids limits.
 */
const MB = 1024 * 1024;

export const config = {
  workRoot: process.env.WORK_ROOT ?? '/tmp',
  sandboxUid: process.env.SANDBOX_UID ? Number(process.env.SANDBOX_UID) : undefined,
  sandboxGid: process.env.SANDBOX_GID ? Number(process.env.SANDBOX_GID) : undefined,
  goCacheTemplate: process.env.GO_CACHE_TEMPLATE, // pre-warmed Go build cache, copied per run
  path: process.env.SANDBOX_PATH ?? process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  maxOutputBytes: Number(process.env.MAX_OUTPUT_BYTES ?? 64 * 1024),
};

const DEFAULTS = {
  compile: { cpuSeconds: 15, wallMs: 20_000, nproc: 256 },
  run: { cpuSeconds: 5, wallMs: 6_000, nproc: 128 },
};

const dropPrivileges = () =>
  process.getuid?.() === 0 && config.sandboxUid !== undefined
    ? { uid: config.sandboxUid, gid: config.sandboxGid ?? config.sandboxUid }
    : {};

function chownRecursive(path, uid, gid) {
  chownSync(path, uid, gid);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) chownRecursive(child, uid, gid);
    else chownSync(child, uid, gid);
  }
}

/** Run one step (compile or run) and capture its output. Never throws. */
function execStep(step, phase, dir, env, stdin) {
  const limits = { ...DEFAULTS[phase], ...step };
  const prlimitArgs = [
    // Soft limit sends SIGXCPU (reported as a time limit); hard limit 1s later is a SIGKILL backstop.
    `--cpu=${limits.cpuSeconds}:${limits.cpuSeconds + 1}`,
    `--nproc=${limits.nproc}`,
    `--fsize=${16 * MB}`,
    ...(limits.addressSpace ? [`--as=${limits.addressSpace}`] : []),
    '--',
    step.cmd,
    ...step.args,
  ];

  return new Promise((resolve) => {
    const started = performance.now();
    const out = { stdout: '', stderr: '' };
    let size = 0;
    let truncated = false;
    let timedOut = false;

    const child = spawn('prlimit', prlimitArgs, {
      cwd: dir,
      env,
      detached: true, // own process group, so we can kill it AND its children
      stdio: ['pipe', 'pipe', 'pipe'],
      ...dropPrivileges(),
    });

    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, limits.wallMs);

    const collect = (stream) => (chunk) => {
      if (truncated) return;
      const room = config.maxOutputBytes - size;
      const text = chunk.toString('utf8');
      if (text.length > room) {
        out[stream] += text.slice(0, Math.max(0, room));
        truncated = true;
        killGroup(); // no reason to keep burning CPU on output nobody will see
      } else {
        out[stream] += text;
      }
      size += text.length;
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    child.stdin.on('error', () => {}); // program may exit without reading input
    child.stdin.end(stdin ?? '');

    // When the main program exits, kill anything it left running in the background,
    // so stray child processes can't outlive the run or hold the output pipes open.
    child.on('exit', killGroup);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ...out, stderr: out.stderr + `Failed to start: ${err.message}`, exitCode: -1, timedOut, truncated, durationMs: 0 });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let exitCode = code ?? -1;
      // Killed by a signal we didn't send for output reasons => it hit the CPU-time
      // limit (SIGXCPU / SIGKILL) or memory limit. Report it as a limit, not a crash.
      if (signal === 'SIGXCPU' || signal === 'SIGKILL') {
        exitCode = 137;
        if (!truncated) timedOut = true;
      }
      resolve({
        ...out,
        exitCode,
        signal: signal ?? null,
        timedOut,
        truncated,
        durationMs: Math.round(performance.now() - started),
      });
    });
  });
}

/**
 * Compile (if needed) and run a program.
 * @returns {Promise<{phase:'compile'|'run', stdout:string, stderr:string, exitCode:number,
 *   timedOut:boolean, truncated:boolean, durationMs:number}>}
 */
export async function runCode({ language, code, stdin = '' }) {
  const lang = LANGUAGES[language];
  if (!lang) throw new Error(`Unsupported language: ${language}`);

  const dir = mkdtempSync(join(config.workRoot, 'run-'));
  try {
    writeFileSync(join(dir, lang.file), code);
    if (language === 'go' && config.goCacheTemplate && existsSync(config.goCacheTemplate)) {
      cpSync(config.goCacheTemplate, join(dir, '.gocache'), { recursive: true });
    }
    const drop = dropPrivileges();
    if (drop.uid !== undefined) chownRecursive(dir, drop.uid, drop.gid);

    const env = {
      PATH: config.path,
      HOME: dir,
      LANG: 'C.UTF-8',
      TMPDIR: dir,
      GOCACHE: join(dir, '.gocache'),
      GOPATH: join(dir, '.gopath'),
      GOTOOLCHAIN: 'local',
      GOPROXY: 'off',
      GOFLAGS: '-buildvcs=false',
      PYTHONDONTWRITEBYTECODE: '1',
    };

    if (lang.compile) {
      const compiled = await execStep(lang.compile, 'compile', dir, env, '');
      if (compiled.exitCode !== 0 || compiled.timedOut) {
        return { phase: 'compile', ...compiled };
      }
    }
    const result = await execStep(lang.run, 'run', dir, env, stdin);
    return { phase: 'run', ...result };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
