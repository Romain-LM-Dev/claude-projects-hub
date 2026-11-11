import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withLock, writeFileAtomic } from './lock.ts';

async function tmp() { return mkdtemp(join(tmpdir(), 'hub-lock-')); }

test('lock is created then released, also on error', async () => {
  const d = await tmp();
  const f = join(d, 'sub', 'f.md');
  await withLock(f, async () => assert.ok(existsSync(`${f}.lock`)));
  assert.ok(!existsSync(`${f}.lock`));
  await assert.rejects(withLock(f, async () => { throw new Error('boom'); }), /boom/);
  assert.ok(!existsSync(`${f}.lock`));
  await rm(d, { recursive: true });
});

test('busy lock times out with io', async () => {
  const d = await tmp();
  const f = join(d, 'f.md');
  await withLock(f, async () => {
    await assert.rejects(withLock(f, async () => {}, { timeoutMs: 100 }), { code: 'io' });
  });
  await rm(d, { recursive: true });
});

test('stale lock is taken over', async () => {
  const d = await tmp();
  const f = join(d, 'f.md');
  await writeFile(`${f}.lock`, '{"pid":1,"at":"2000-01-01T00:00:00Z"}');
  const old = new Date(Date.now() - 20_000);
  await utimes(`${f}.lock`, old, old);
  assert.equal(await withLock(f, async () => 'ok', { timeoutMs: 200 }), 'ok');
  assert.ok(!existsSync(`${f}.lock`));
  await rm(d, { recursive: true });
});

test('fresh foreign lock is not taken over', async () => {
  const d = await tmp();
  const f = join(d, 'f.md');
  await writeFile(`${f}.lock`, '{}');
  await assert.rejects(withLock(f, async () => 'ok', { timeoutMs: 100 }), { code: 'io' });
  assert.ok(existsSync(`${f}.lock`));
  await rm(d, { recursive: true });
});

test('writeFileAtomic replaces content and leaves no tmp', async () => {
  const d = await tmp();
  const f = join(d, 'f.md');
  await writeFileAtomic(f, 'un');
  await writeFileAtomic(f, 'deux');
  assert.equal(await readFile(f, 'utf8'), 'deux');
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(d), ['f.md']);
  await rm(d, { recursive: true });
});
