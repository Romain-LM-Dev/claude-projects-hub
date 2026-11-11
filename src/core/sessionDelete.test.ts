import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isSessionLive, sessionFiles } from './sessionDelete.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const home = mkdtempSync(join(tmpdir(), 'hub-sdel-'));
const put = (rel: string, data: string) => {
  const f = join(home, rel);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, data);
  return f;
};

test('sessionFiles: partial then full set, telemetry ignored, bytes summed recursively', async () => {
  put(`projects/d/${ID}.jsonl`, 'abc');
  put(`telemetry/x.${ID}.1.json`, 'zzzz');
  const a = await sessionFiles(home, 'd', ID);
  assert.deepEqual(a.paths, [join(home, 'projects', 'd', `${ID}.jsonl`)]);
  assert.equal(a.bytes, 3);
  put(`projects/d/${ID}/sub/a.txt`, '12');
  put(`file-history/${ID}/h`, '1');
  put(`session-env/${ID}/e`, '1234');
  const b = await sessionFiles(home, 'd', ID);
  assert.equal(b.paths.length, 4);
  assert.equal(b.bytes, 10);
  assert.deepEqual((await sessionFiles(home, 'd', '99999999-2222-3333-4444-555555555555')).paths, []);
});

test('sessionFiles refuses bad ids and claudeDirs', async () => {
  for (const id of ['--x', '../a', '']) await assert.rejects(sessionFiles(home, 'd', id), { code: 'invalid_input' });
  for (const d of ['a/b', '..', '.', '', 'a\\b']) await assert.rejects(sessionFiles(home, d, ID), { code: 'invalid_input' });
});

test('isSessionLive: live pid, dead pid, other session', async () => {
  put(`sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: ID }));
  assert.equal(await isSessionLive(home, ID), true);
  assert.equal(await isSessionLive(home, ID, () => false), false);
  assert.equal(await isSessionLive(home, '99999999-2222-3333-4444-555555555555'), false);
});
