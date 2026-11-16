import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { forgetProject, isSessionLive, orphanFiles, projectFiles, sessionFiles } from './sessionDelete.ts';

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

test('orphanFiles / forgetProject', async () => {
  const hub = mkdtempSync(join(tmpdir(), 'hub-orph-'));
  const entry = (o: object) => ({ name: 'o', paths: [], formerPaths: [], claudeDirs: ['od'], dismissed: [], createdAt: 'x', ...o });
  const reg = { version: 1, projects: {
    orph: entry({}), live: entry({ paths: ['/x'], claudeDirs: ['ld'] }), bad: entry({ claudeDirs: ['a/b'] }),
    other: entry({ paths: ['/y'], claudeDirs: ['yd'], dismissed: ['orph', 'z'] }),
    // shared: the old path was recreated, a live project now uses the same Claude folder 'sd'
    orphShared: entry({ claudeDirs: ['sd'] }), liveShared: entry({ paths: ['/z'], claudeDirs: ['SD'] }),
  } };
  writeFileSync(join(hub, 'registry.json'), JSON.stringify(reg));
  put(`projects/od/${ID}.jsonl`, 'abc');
  put('projects/od/memory/n.md', '---\nname: n\n---\nx');
  put(`session-env/${ID}/e`, '12');
  mkdirSync(join(hub, 'projects', 'orph', 'topics'), { recursive: true });
  writeFileSync(join(hub, 'projects', 'orph', 'topics', 't.md'), 'x');
  const r = await orphanFiles(home, hub, 'orph', [{ sessionId: ID, claudeDir: 'od' }]);
  assert.deepEqual(r.paths.sort(), [join(home, 'projects', 'od'), join(hub, 'projects', 'orph'), join(home, 'session-env', ID), join(home, 'file-history', ID)].sort());
  assert.equal(r.notes, 1);
  const SID = '77777777-2222-3333-4444-555555555555';
  put(`projects/sd/${SID}.jsonl`, 'live session');
  put(`session-env/${SID}/e`, '1');
  const s = await orphanFiles(home, hub, 'orphShared', [{ sessionId: SID, claudeDir: 'sd' }]);
  assert.deepEqual(s.paths, [], 'a Claude folder shared with a live project, and its sessions, are never listed');
  for (const id of ['live', 'nope', 'bad']) await assert.rejects(orphanFiles(home, hub, id, []), { code: 'invalid_input' });
  await assert.rejects(forgetProject(hub, 'live'), { code: 'invalid_input' });
  // live project: marker file only (never the folder nor .claude/), shared Claude folder untouched
  const proj = mkdtempSync(join(tmpdir(), 'hub-proj-'));
  mkdirSync(join(proj, '.claude'));
  writeFileSync(join(proj, '.claude', 'projects-hub.json'), '{"id":"lv"}');
  writeFileSync(join(proj, '.claude', 'settings.json'), '{}');
  put(`projects/lvd/${SID}.jsonl`, 'x');
  put(`projects/shd/${ID}.jsonl`, 'x');
  writeFileSync(join(hub, 'registry.json'), JSON.stringify({ version: 1, projects: {
    lv: entry({ paths: [proj], claudeDirs: ['lvd', 'shd'] }), orph: entry({ claudeDirs: ['shd'] }),
  } }));
  const l = await projectFiles(home, hub, 'lv', [{ sessionId: SID, claudeDir: 'lvd' }, { sessionId: ID, claudeDir: 'shd' }], { live: true });
  assert.deepEqual(l.paths.sort(), [join(home, 'projects', 'lvd'), join(proj, '.claude', 'projects-hub.json'), join(home, 'session-env', SID)].sort());
  assert.deepEqual(l.keptDirs, [proj]);
  await assert.rejects(projectFiles(home, hub, 'lv', []), { code: 'invalid_input' });
  await forgetProject(hub, 'lv', { live: true });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(hub, 'registry.json'), 'utf8')).projects), ['orph']);
  writeFileSync(join(hub, 'registry.json'), JSON.stringify(reg));
  await forgetProject(hub, 'orph');
  const after = JSON.parse(readFileSync(join(hub, 'registry.json'), 'utf8'));
  assert.deepEqual(Object.keys(after.projects), ['live', 'bad', 'other', 'orphShared', 'liveShared']);
  assert.deepEqual(after.projects.other.dismissed, ['z']);
});
