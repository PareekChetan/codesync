/**
 * How to compile and run each language.
 *
 * Every step runs under `prlimit` with CPU-time, process-count and file-size
 * limits. `addressSpace` caps virtual memory for languages where that works;
 * the JVM, Go and V8 reserve huge virtual ranges up front, so they are capped
 * with their own heap flags instead (and the whole container has a hard
 * memory limit as the final backstop).
 */
const MB = 1024 * 1024;

export const LANGUAGES = {
  python: {
    file: 'main.py',
    run: { cmd: 'python3', args: ['-B', '-u', 'main.py'], addressSpace: 512 * MB },
  },
  javascript: {
    file: 'main.js',
    run: { cmd: 'node', args: ['--max-old-space-size=256', 'main.js'] },
  },
  typescript: {
    file: 'main.ts',
    // Node 22 runs TypeScript directly by stripping type annotations.
    run: { cmd: 'node', args: ['--experimental-strip-types', '--no-warnings', '--max-old-space-size=256', 'main.ts'] },
  },
  java: {
    file: 'Main.java',
    // Single-file source launch: compiles in memory and runs the first class with main().
    // So `class Solution { public static void main(...) }` works without renaming.
    run: {
      cmd: 'java',
      args: ['-Xmx256m', '-Xss16m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-XX:-UsePerfData', 'Main.java'],
      cpuSeconds: 10,
      wallMs: 12_000,
    },
  },
  cpp: {
    file: 'main.cpp',
    compile: { cmd: 'g++', args: ['-O2', '-std=c++17', '-pipe', '-o', 'main', 'main.cpp'], addressSpace: 1024 * MB },
    run: { cmd: './main', args: [], addressSpace: 512 * MB },
  },
  go: {
    file: 'main.go',
    compile: { cmd: 'go', args: ['build', '-o', 'main', 'main.go'] },
    run: { cmd: './main', args: [] },
  },
};

export const SUPPORTED = Object.keys(LANGUAGES);
