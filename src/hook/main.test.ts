import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { writeTopic } from '../core/store.ts';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'hub-t4-')));
const bundle = join(base, 'hook.js');
const hub = join(base, 'hub');
const fakeTmp = join(base, '_tmp');
const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECTS_HUB_HOME: hub, CLAUDE_CONFIG_DIR: join(base, '_claude'), TEMP: fakeTmp, TMP: fakeTmp, USERPROFILE: join(base, '_home'), HOME: join(base, '_home') };
delete env.CLAUDE_PROJECT_DIR;
mkdirSync(fakeTmp, { recursive: true });
let n = 0;
const proj = (git = true) => { const d = join(base, 'w', `p${n++}`); mkdirSync(git ? join(d, '.git') : d, { recursive: true }); return d; };

before(async () => {
  await build({ entryPoints: [join(import.meta.dirname, 'main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
});
after(() => rmSync(base, { recursive: true, force: true }));

function run(input: string, e = env) {
  const t = performance.now();
  const r = spawnSync(process.execPath, [bundle], { input, env: e, encoding: 'utf8' });
  return { ...r, ms: performance.now() - t, ctx: r.stdout ? (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : '' };
}
const start = (cwd: string) => JSON.stringify({ session_id: 's', cwd, hook_event_name: 'SessionStart', source: 'startup' });
const registry = () => JSON.parse(readFileSync(join(hub, 'registry.json'), 'utf8')) as { projects: Record<string, { name: string }> };

test('stdin invalide : stdout vide, code 0', () => {
  for (const bad of ['', 'pas du json', '42', 'null']) {
    const r = run(bad);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('BOM en tête de stdin toléré (PowerShell)', () => {
  assert.ok(run('﻿' + start(join(fakeTmp, 'b'))).ctx.includes('Mémoire partagée'));
});

test('premier puis second SessionStart dans un dépôt neuf', () => {
  const d = proj();
  const r1 = run(start(d));
  assert.equal(r1.status, 0);
  const marker = join(d, '.claude', 'projects-hub.json');
  const m1 = readFileSync(marker, 'utf8');
  const id = (JSON.parse(m1) as { id: string }).id;
  assert.ok(registry().projects[id]);
  assert.ok(r1.ctx.includes('Projet : «p'));
  const excl = join(d, '.git', 'info', 'exclude');
  assert.equal(readFileSync(excl, 'utf8').split('\n').filter((l) => l === '/.claude/projects-hub.json').length, 1);

  const r2 = run(start(d));
  assert.equal(r2.status, 0);
  assert.equal(readFileSync(marker, 'utf8'), m1);
  assert.equal(readFileSync(excl, 'utf8').split('\n').filter((l) => l === '/.claude/projects-hub.json').length, 1);
  assert.equal(r2.ctx, r1.ctx);
});

test('topics du projet et globaux injectés', async () => {
  const d = proj();
  run(start(d));
  const id = Object.keys(registry().projects).find((k) => registry().projects[k]!.name === d.split('\\').pop())!;
  await writeTopic({ hubHome: hub, projectId: id }, 'project:ports', { title: 'Ports', summary: 'Postgres sur 5433', body: 'x', tags: ['docker'] });
  await writeTopic({ hubHome: hub }, 'global:git', { title: 'Git', summary: 'commits en français', body: 'x' });
  const { ctx } = run(start(d));
  assert.match(ctx, /### Projet\n- project:ports — Ports : Postgres sur 5433 \[docker\]/);
  assert.match(ctx, /### Global\n- global:git — Git/);
});

test('cwd dans tmpdir ou home : aucun marqueur ni entrée, « Projet : aucun »', () => {
  for (const cwd of [join(fakeTmp, 'x'), env.USERPROFILE!]) {
    mkdirSync(cwd, { recursive: true });
    const r = run(start(cwd));
    assert.equal(r.status, 0);
    assert.ok(r.ctx.includes('Projet : aucun'));
    assert.ok(!existsSync(join(cwd, '.claude')));
  }
});

test('dossier en lecture seule : JSON valide, code 0, ligne dans hook.log', () => {
  const d = proj(false);
  const deny = () => execFileSync('icacls', [d, '/deny', '*S-1-1-0:(OI)(CI)(WD,AD)'], { stdio: 'ignore' });
  const restore = () => execFileSync('icacls', [d, '/remove:d', '*S-1-1-0'], { stdio: 'ignore' });
  deny();
  try {
    const r = run(start(d));
    assert.equal(r.status, 0);
    assert.ok(r.ctx.includes('Mémoire partagée'));
    assert.ok(readFileSync(join(hub, 'logs', 'hook.log'), 'utf8').includes('marqueur non écrit'));
  } finally { restore(); }
});

test('verrou du registre tenu : « non enregistré » en moins de 1 s, code 0', () => {
  const h2 = join(base, 'hub-lock');
  mkdirSync(h2, { recursive: true });
  writeFileSync(join(h2, 'registry.json.lock'), '{}');
  const r = run(start(proj()), { ...env, CLAUDE_PROJECTS_HUB_HOME: h2 });
  assert.equal(r.status, 0);
  assert.ok(r.ms < 1000, `${r.ms} ms`);
  assert.ok(r.ctx.includes('Projet : non enregistré'));
});

test('durée du hook (moins node -e "") < 150 ms, première session et suivante', () => {
  const median = (f: () => number) => { const a = Array.from({ length: 7 }, f).sort((x, y) => x - y); return a[3]!; };
  const empty = median(() => { const t = performance.now(); spawnSync(process.execPath, ['-e', ''], { env }); return performance.now() - t; });
  const firsts: number[] = [];
  const dirs = Array.from({ length: 7 }, () => proj());
  const first = median(() => { const ms = run(start(dirs.shift()!)).ms; firsts.push(ms); return ms; }) - empty;
  const d = proj();
  run(start(d));
  const next = median(() => run(start(d)).ms) - empty;
  console.log(`# node -e "" ${empty.toFixed(0)} ms ; première session +${first.toFixed(0)} ms ; suivante +${next.toFixed(0)} ms`);
  assert.ok(first < 150, `première session ${first} ms`);
  assert.ok(next < 150, `session suivante ${next} ms`);
});
