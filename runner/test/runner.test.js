import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Limiter, QueueFullError } from '../src/queue.js';
import { runCode } from '../src/sandbox.js';

/** Requires python3, node, java, g++ and go on PATH (all present in the Docker image). */
const hello = {
  python: 'name = input()\nprint(f"Hello, {name}")',
  javascript: 'const name = require("fs").readFileSync(0, "utf8").trim();\nconsole.log(`Hello, ${name}`);',
  typescript: 'const name: string = require("fs").readFileSync(0, "utf8").trim();\nconsole.log(`Hello, ${name}`);',
  java: 'import java.util.*;\nclass Solution {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    System.out.println("Hello, " + sc.nextLine());\n  }\n}',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\nint main(){ string s; getline(cin, s); cout << "Hello, " << s << endl; }',
  go: 'package main\nimport ("bufio";"fmt";"os")\nfunc main(){ s := bufio.NewScanner(os.Stdin); s.Scan(); fmt.Println("Hello, " + s.Text()) }',
};

describe('runs every language with stdin', () => {
  for (const [language, code] of Object.entries(hello)) {
    it(language, async () => {
      const result = await runCode({ language, code, stdin: 'CodeSync\n' });
      assert.equal(result.stderr, '', `stderr: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'Hello, CodeSync');
      assert.equal(result.exitCode, 0);
      assert.equal(result.phase, 'run');
    });
  }
});

describe('errors', () => {
  it('reports compile errors without running', async () => {
    const result = await runCode({ language: 'cpp', code: 'int main() { return x; }' });
    assert.equal(result.phase, 'compile');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /x.*(not declared|undeclared)/);
  });

  it('reports runtime errors', async () => {
    const result = await runCode({ language: 'python', code: 'print("before")\n1/0' });
    assert.equal(result.stdout.trim(), 'before');
    assert.match(result.stderr, /ZeroDivisionError/);
    assert.equal(result.exitCode, 1);
  });

  it('rejects unknown languages', async () => {
    await assert.rejects(runCode({ language: 'cobol', code: '' }), /Unsupported/);
  });
});

describe('limits', () => {
  it('kills infinite loops', async () => {
    const result = await runCode({ language: 'python', code: 'while True: pass' });
    assert.equal(result.timedOut, true);
    assert.ok(result.durationMs < 8000, `took ${result.durationMs}ms`);
  });

  it('kills programs that sleep forever (wall clock)', async () => {
    const result = await runCode({ language: 'python', code: 'import time\ntime.sleep(60)' });
    assert.equal(result.timedOut, true);
  });

  it('caps runaway output', async () => {
    const result = await runCode({ language: 'cpp', code: '#include <cstdio>\nint main(){ while(1) puts("spam"); }' });
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 64 * 1024);
  });

  it('caps memory', async () => {
    const result = await runCode({ language: 'python', code: 'x = bytearray(2 * 1024 * 1024 * 1024)\nprint("allocated")' });
    assert.doesNotMatch(result.stdout, /allocated/);
    assert.match(result.stderr, /MemoryError/);
  });

  it('kills background processes when the program exits', async () => {
    const code = 'import os, time\nif os.fork() == 0:\n    time.sleep(30)\nprint("done")';
    const result = await runCode({ language: 'python', code });
    assert.equal(result.stdout.trim(), 'done');
    assert.equal(result.timedOut, false);
    assert.ok(result.durationMs < 2000);
  });

  // Process limits don't apply to root, so this only runs when privileges are dropped.
  it('stops fork bombs', { skip: !process.env.SANDBOX_UID }, async () => {
    const code = 'import os\nn = 0\ntry:\n    while True:\n        os.fork() or __import__("time").sleep(30)\n        n += 1\nexcept OSError:\n    print("blocked")';
    const result = await runCode({ language: 'python', code });
    assert.match(result.stdout, /blocked/);
  });

  it('cleans up: a run cannot see files from a previous run', async () => {
    await runCode({ language: 'python', code: 'open("secret.txt", "w").write("hi")' });
    const result = await runCode({ language: 'python', code: 'import os\nprint(os.listdir("."))' });
    assert.doesNotMatch(result.stdout, /secret/);
  });
});

describe('Limiter', () => {
  it('runs at most N tasks at once and rejects when the queue is full', async () => {
    const limiter = new Limiter(1, 1);
    let release;
    const first = limiter.run(() => new Promise((r) => (release = r)));
    const second = limiter.run(async () => 'second');
    await assert.rejects(limiter.run(async () => 'third'), QueueFullError);
    assert.equal(limiter.active, 1);
    assert.equal(limiter.queued, 1);
    release('first');
    assert.equal(await first, 'first');
    assert.equal(await second, 'second');
  });
});
