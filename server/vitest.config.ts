import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    // Integration tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://codesync:codesync@localhost:5432/codesync_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-at-least-16-chars',
      PERSIST_DEBOUNCE_MS: '100',
      PERSIST_MAX_WAIT_MS: '500',
      RUNNER_URL: 'http://localhost:5099',
      RUNNER_TOKEN: 'test-runner-token',
      RUNS_PER_MINUTE: '1000',
    },
  },
});
