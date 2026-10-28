/**
 * Runs once before all tests: apply migrations to the test database and wipe it.
 * Env vars from vitest.config.ts are not applied here yet, so set them first.
 */
export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgres://codesync:codesync@localhost:5432/codesync_test';
  const { migrate } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/pool.js');
  await migrate();
  await pool.query('TRUNCATE users, rooms, room_members, documents CASCADE');
  await pool.end();
}
