import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adaptJavaForJudge0, ExecutorError, Judge0Executor, JUDGE0_LANGUAGE_IDS } from '../src/rooms/executors.js';

describe('adaptJavaForJudge0', () => {
  it('adds a Main wrapper for a LeetCode-style Solution class', () => {
    const code = 'import java.util.*;\npublic class Solution {\n  public static void main(String[] args) { System.out.println(1); }\n}';
    const out = adaptJavaForJudge0(code);
    expect(out).not.toMatch(/public class Solution/);
    expect(out).toMatch(/class Main \{[\s\S]*Solution\.main\(args\)/);
  });

  it('leaves code that already has a Main class alone (except public)', () => {
    const out = adaptJavaForJudge0('public class Main { public static void main(String[] a) {} }');
    expect(out).toBe('class Main { public static void main(String[] a) {} }');
  });

  it('picks the class that actually contains main()', () => {
    const code = 'class Helper { int x; }\nclass App {\n  public static void main(String[] a) {}\n}';
    expect(adaptJavaForJudge0(code)).toMatch(/App\.main\(args\)/);
  });
});

/** A fake Judge0 server, so the adapter is tested without network access or an API key. */
let server: http.Server;
let url: string;
let lastRequest: { headers: http.IncomingHttpHeaders; body: any; path: string } | null = null;
let nextResponse: { status: number; body: object } = { status: 200, body: {} };

const b64 = (s: string) => Buffer.from(s).toString('base64');

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      lastRequest = { headers: req.headers, body: JSON.parse(raw), path: req.url ?? '' };
      res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('Judge0Executor', () => {
  it('sends base64 code + stdin with the right language and RapidAPI headers', async () => {
    nextResponse = { status: 200, body: { stdout: b64('42\n'), status: { id: 3, description: 'Accepted' }, time: '0.012' } };
    const exec = new Judge0Executor(url, 'my-key', 'judge0-ce.p.rapidapi.com');
    const result = await exec.run({ language: 'python', code: 'print(int(input())*2)', stdin: '21' });

    expect(lastRequest!.path).toBe('/submissions?base64_encoded=true&wait=true');
    expect(lastRequest!.headers['x-rapidapi-key']).toBe('my-key');
    expect(lastRequest!.body.language_id).toBe(JUDGE0_LANGUAGE_IDS.python);
    expect(Buffer.from(lastRequest!.body.stdin, 'base64').toString()).toBe('21');
    expect(result).toMatchObject({ phase: 'run', stdout: '42\n', exitCode: 0, timedOut: false, durationMs: 12 });
  });

  it('maps compile errors, time limits and runtime errors', async () => {
    const exec = new Judge0Executor(url, '', '');
    nextResponse = { status: 200, body: { compile_output: b64('error: x undeclared'), status: { id: 6, description: 'Compilation Error' } } };
    expect(await exec.run({ language: 'cpp', code: 'x', stdin: '' })).toMatchObject({ phase: 'compile', stderr: 'error: x undeclared' });

    nextResponse = { status: 200, body: { status: { id: 5, description: 'Time Limit Exceeded' } } };
    expect((await exec.run({ language: 'python', code: 'while 1: pass', stdin: '' })).timedOut).toBe(true);

    nextResponse = { status: 200, body: { stderr: b64('ZeroDivisionError'), status: { id: 11, description: 'Runtime Error (NZEC)' } } };
    const rt = await exec.run({ language: 'python', code: '1/0', stdin: '' });
    expect(rt).toMatchObject({ phase: 'run', exitCode: 1 });
    expect(rt.stderr).toContain('ZeroDivisionError');
  });

  it('wraps Java so class Solution works', async () => {
    nextResponse = { status: 200, body: { stdout: b64('ok'), status: { id: 3 } } };
    await new Judge0Executor(url, '', '').run({ language: 'java', code: 'class Solution { public static void main(String[] a) {} }', stdin: '' });
    expect(Buffer.from(lastRequest!.body.source_code, 'base64').toString()).toContain('class Main');
  });

  it('reports quota and outage errors clearly', async () => {
    nextResponse = { status: 429, body: { message: 'quota' } };
    await expect(new Judge0Executor(url, 'k', 'h').run({ language: 'go', code: '', stdin: '' })).rejects.toMatchObject({ status: 429 });
    await expect(new Judge0Executor('http://localhost:1', 'k', 'h').run({ language: 'go', code: '', stdin: '' })).rejects.toBeInstanceOf(ExecutorError);
  });
});
