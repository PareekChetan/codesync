import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryDocStore } from '../src/collab/docStore.js';
import { TokenBucket } from '../src/collab/tokenBucket.js';
import { newRoomId } from '../src/rooms/repository.js';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.tryTake(), bucket.tryTake(), bucket.tryTake(), bucket.tryTake()]).toEqual([true, true, true, false]);
    now += 1000; // one second refills one token
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });
});

describe('newRoomId', () => {
  it('generates unique URL-safe ids', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newRoomId()));
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{10}$/);
  });
});

describe('CRDT behaviour', () => {
  it('concurrent edits from two users converge to the same text', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('code').insert(0, 'hello world');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Both edit at the same time without seeing each other's change.
    a.getText('code').insert(5, ' brave');
    b.getText('code').insert(11, '!');

    // Exchange updates in opposite orders.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(a.getText('code').toString()).toBe('hello brave world!');
    expect(b.getText('code').toString()).toBe(a.getText('code').toString());
  });

  it('saving is a merge, so a stale snapshot never erases newer edits', async () => {
    const store = new MemoryDocStore();
    const instance1 = new Y.Doc();
    const instance2 = new Y.Doc();
    instance1.getText('code').insert(0, 'from instance 1. ');
    instance2.getText('code').insert(0, 'from instance 2. ');

    // Instance 2 saves last, with a view that lacks instance 1's edit.
    await store.save('room', Y.encodeStateAsUpdate(instance1));
    await store.save('room', Y.encodeStateAsUpdate(instance2));

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, (await store.load('room'))!);
    const text = loaded.getText('code').toString();
    expect(text).toContain('from instance 1.');
    expect(text).toContain('from instance 2.');
  });
});
