import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { test } from 'node:test';
import { ensureProject, findMarker, isExcludedDir, markerFile, resolveProject } from './identity.ts';
import { readRegistry, registryFile } from './registry.ts';
import { git, initRepo, sandbox } from '../../test/fixtures/kit.ts';

const EXCL = '/.claude/projects-hub.json';
const excludeFile = (repo: string) => join(repo, '.git', 'info', 'exclude');
const countLine = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => l.replace('\r', '').trim() === EXCL).length;

test('isExcludedDir: tmpdir, home, drive root, CLAUDE_HOME, HUB_HOME (real defaults and injected roots)', () => {
  const hub = join(homedir(), 'hubx');
  assert.ok(isExcludedDir(join(tmpdir(), 'a', 'b'), hub));
  assert.ok(isExcludedDir(homedir(), hub));
  assert.ok(!isExcludedDir(join(homedir(), 'proj'), hub, { claudeHome: join(homedir(), 'c') }));
  assert.ok(isExcludedDir(parse(homedir()).root, hub));
  assert.ok(isExcludedDir(join(hub, 'projects'), hub));
  const r = { claudeHome: join(homedir(), 'c'), tmpDir: join(homedir(), 't'), homeDir: join(homedir(), 'h') };
  assert.ok(isExcludedDir(join(r.claudeHome, 'projects', 'x'), hub, r));
  assert.ok(isExcludedDir(join(r.tmpDir, 'x'), hub, r));
  assert.ok(!isExcludedDir(join(r.tmpDir + 'x', 'x'), hub, r));
  assert.ok(!isExcludedDir(join(r.homeDir, 'sub'), hub, r));
});

test('excluded dirs: nothing written, resolution says excluded', async () => {
  const sb = sandbox();
  const d = join(sb.exclude.tmpDir, 'p');
  mkdirSync(d, { recursive: true });
  assert.equal(await ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude }), null);
  assert.equal(existsSync(markerFile(d)), false);
  assert.equal(existsSync(registryFile(sb.hub)), false);
  assert.deepEqual(await resolveProject(d, { hubHome: sb.hub, exclude: sb.exclude }), { status: 'excluded' });
});

test('ensureProject: new repo -> marker, entry, one exclude line, clean git status; second call writes nothing', async () => {
  const sb = sandbox();
  const repo = initRepo(sb.dir('r'));
  const o = { hubHome: sb.hub, git: false, exclude: sb.exclude };
  const r1 = (await ensureProject(repo, o))!;
  assert.equal(JSON.parse(readFileSync(markerFile(repo), 'utf8')).id, r1.id);
  const { reg } = await readRegistry(sb.hub);
  assert.deepEqual(reg.projects[r1.id]!.paths, [repo]);
  assert.equal('git' in reg.projects[r1.id]!, false);
  assert.equal(countLine(excludeFile(repo)), 1);
  assert.equal(git(repo, 'status', '--porcelain'), '');
  const snap = [readFileSync(registryFile(sb.hub), 'utf8'), readFileSync(markerFile(repo), 'utf8'), readFileSync(excludeFile(repo), 'utf8')];
  const mt = [registryFile(sb.hub), markerFile(repo), excludeFile(repo)].map((f) => statSync(f).mtimeMs);
  assert.equal((await ensureProject(repo, o))!.id, r1.id);
  assert.deepEqual([registryFile(sb.hub), markerFile(repo), excludeFile(repo)].map((f) => readFileSync(f, 'utf8')), snap);
  assert.deepEqual([registryFile(sb.hub), markerFile(repo), excludeFile(repo)].map((f) => statSync(f).mtimeMs), mt);
});

test('info/exclude: CRLF file and file without final newline', async () => {
  const sb = sandbox();
  const o = { hubHome: sb.hub, git: false, exclude: sb.exclude };
  const crlf = initRepo(sb.dir('crlf'));
  writeFileSync(excludeFile(crlf), '# x\r\n/.claude/projects-hub.json\r\n');
  await ensureProject(crlf, o);
  assert.equal(countLine(excludeFile(crlf)), 1);
  const nonl = initRepo(sb.dir('nonl'));
  writeFileSync(excludeFile(nonl), '*.log');
  await ensureProject(nonl, o);
  assert.equal(readFileSync(excludeFile(nonl), 'utf8'), '*.log\n/.claude/projects-hub.json\n');
});

test('worktree: exclusion goes to the main repository; subfolder: marker at repo root; no git: marker only', async () => {
  const sb = sandbox();
  const o = { hubHome: sb.hub, git: false, exclude: sb.exclude };
  const main = initRepo(sb.dir('main'));
  const wt = join(sb.base, 'w', 'wt');
  git(main, 'worktree', 'add', '-q', wt, '-b', 'b2');
  assert.ok(statSync(join(wt, '.git')).isFile());
  const w = (await ensureProject(wt, o))!;
  assert.equal(w.root, wt);
  assert.ok(existsSync(markerFile(wt)));
  assert.equal(countLine(excludeFile(main)), 1);
  assert.equal(git(wt, 'status', '--porcelain'), '');

  const sub = join(main, 'src', 'deep');
  mkdirSync(sub, { recursive: true });
  const s = (await ensureProject(sub, o))!;
  assert.equal(s.root, main);
  assert.ok(existsSync(markerFile(main)) && !existsSync(markerFile(sub)));

  const plain = sb.dir('plain', 'inner');
  const p = (await ensureProject(plain, o))!;
  assert.equal(p.root, plain);
  assert.ok(existsSync(markerFile(plain)));
  assert.equal(existsSync(join(plain, '.gitignore')), false);
});

test('marker follows a moved folder (hook included); lost registry + marker keeps the id', async () => {
  const sb = sandbox();
  const o = { hubHome: sb.hub, git: false, exclude: sb.exclude };
  const a = sb.dir('old');
  const id = (await ensureProject(a, o))!.id;
  const b = join(sb.base, 'w', 'new');
  renameSync(a, b);
  assert.deepEqual(await resolveProject(b, { hubHome: sb.hub, exclude: sb.exclude }), { status: 'resolved', id, via: 'marker' });
  assert.equal((await ensureProject(b, o))!.id, id);
  const { reg } = await readRegistry(sb.hub);
  assert.ok(reg.projects[id]!.paths.includes(b)); // the vanished old path is moved to formerPaths by the scan, not here
  rmSync(registryFile(sb.hub));
  assert.equal((await ensureProject(b, o))!.id, id);
  assert.deepEqual((await readRegistry(sb.hub)).reg.projects[id]!.paths, [b]);
});

test('resolveProject: registry path when no marker, else unregistered', async () => {
  const sb = sandbox();
  const d = sb.dir('x');
  assert.deepEqual(await resolveProject(d, { hubHome: sb.hub, exclude: sb.exclude }), { status: 'unregistered' });
  const id = (await ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude }))!.id;
  rmSync(markerFile(d));
  assert.deepEqual(await resolveProject(d, { hubHome: sb.hub, exclude: sb.exclude }), { status: 'resolved', id, via: 'registry' });
});

test('git: true computes the fingerprint (MCP path)', async () => {
  const sb = sandbox();
  const repo = initRepo(sb.dir('g'), 'https://github.com/u/r.git');
  const { id } = (await ensureProject(repo, { hubHome: sb.hub, git: true, exclude: sb.exclude }))!;
  const e = (await readRegistry(sb.hub)).reg.projects[id]!;
  assert.deepEqual(e.git, { rootCommits: [git(repo, 'rev-list', '--max-parents=0', 'HEAD')], remote: 'github.com/u/r' });
  assert.ok(existsSync(markerFile(repo)));
});

test('read-only folder: entry created, no marker, no exception', { skip: process.platform !== 'win32' }, async () => {
  const sb = sandbox();
  const d = sb.dir('ro');
  const logs: string[] = [];
  const icacls = (...a: string[]) => execFileSync('icacls', [d, ...a], { stdio: 'ignore' });
  icacls('/deny', '*S-1-1-0:(WD,AD)');
  try {
    const r = await ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude, log: (m) => logs.push(m) });
    assert.ok(r);
    assert.equal(existsSync(markerFile(d)), false);
    assert.deepEqual((await readRegistry(sb.hub)).reg.projects[r.id]!.paths, [d]);
    assert.equal(logs.length, 1);
  } finally {
    icacls('/remove:d', '*S-1-1-0');
  }
});

test('review 7: a gitdir: target without HEAD gets no info/exclude', async () => {
  const sb = sandbox();
  const d = sb.dir('wt');
  const target = join(sb.base, 'elsewhere');
  writeFileSync(join(d, '.git'), 'gitdir: ../../elsewhere\n');
  await ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude });
  assert.ok(!existsSync(join(target, 'info', 'exclude')));
});

test('review 8: a parent marker counts only inside a git repo; the own marker always counts', async () => {
  const sb = sandbox();
  const p = sb.dir('plain');
  mkdirSync(join(p, '.claude'));
  writeFileSync(markerFile(p), '{"id":"parent-id"}\n');
  const c = join(p, 'child');
  mkdirSync(join(c, '.claude'), { recursive: true });
  assert.equal((await findMarker(c)).id, undefined);
  writeFileSync(markerFile(c), '{"id":"own-id"}\n');
  assert.equal((await findMarker(c)).id, 'own-id');
  const r = initRepo(sb.dir('repo'));
  mkdirSync(join(r, '.claude'));
  writeFileSync(markerFile(r), '{"id":"repo-id"}\n');
  mkdirSync(join(r, 'a', 'b'), { recursive: true });
  assert.equal((await findMarker(join(r, 'a', 'b'))).id, 'repo-id');
});
