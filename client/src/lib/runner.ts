/**
 * Runs JavaScript in a sandboxed Web Worker.
 *
 * - A worker has no access to the page (no DOM, cookies or localStorage),
 *   so user code can't read your auth token or tamper with the editor.
 * - A hard timeout terminates infinite loops without freezing the tab.
 *
 * Other languages would need a server-side sandbox (e.g. isolated Docker
 * containers with CPU/memory limits). See docs/ROADMAP.md.
 */
export interface RunResult {
  logs: { level: 'log' | 'error' | 'warn' | 'info'; text: string }[];
  durationMs: number;
  timedOut: boolean;
}

const WORKER_SOURCE = `
  const format = (v) => {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return v.name + ': ' + v.message;
    try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); }
  };
  for (const level of ['log', 'error', 'warn', 'info']) {
    console[level] = (...args) => postMessage({ type: 'log', level, text: args.map(format).join(' ') });
  }
  // Block network access from user code.
  self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
`;

const MAX_LOG_LINES = 500;

export function runJavaScript(code: string, timeoutMs = 3000): Promise<RunResult> {
  return new Promise((resolve) => {
    // The user's code is placed directly into the worker script instead of being
    // eval'd, so it runs under a strict Content Security Policy (no 'unsafe-eval').
    const source =
      WORKER_SOURCE +
      `\n;(async () => {\n${code}\n})()` +
      `.catch((err) => postMessage({ type: 'log', level: 'error', text: format(err) }))` +
      `.finally(() => postMessage({ type: 'done' }));\n`;
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl);
    const logs: RunResult['logs'] = [];
    const start = performance.now();

    const finish = (timedOut: boolean) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      if (timedOut) logs.push({ level: 'error', text: `Stopped: exceeded ${timeoutMs / 1000}s time limit` });
      resolve({ logs, durationMs: Math.round(performance.now() - start), timedOut });
    };

    const timer = setTimeout(() => finish(true), timeoutMs);
    worker.onmessage = (e) => {
      if (e.data.type === 'done') finish(false);
      else if (logs.length < MAX_LOG_LINES) logs.push({ level: e.data.level, text: e.data.text });
    };
    worker.onerror = (e) => {
      logs.push({ level: 'error', text: e.message });
      finish(false);
    };
  });
}
