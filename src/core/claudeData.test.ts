import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanClaudeData } from './claudeData.ts';
import type { ScanStats } from './transcript.ts';

const FIXTURE = join(import.meta.dirname, '../../test/fixtures/claude-home');

function copyFixture() {
  const home = mkdtempSync(join(tmpdir(), 'hub-fx-'));
  cpSync(FIXTURE, home, { recursive: true });
  const at = (f: string, s: number) => utimesSync(join(home, 'projects', f), s, s);
  at('C--proj-a/aaaa0001.jsonl', 1000);
  at('C--proj-a/aaaa0002.jsonl', 2000);
  at('C--proj-a/aaaa0003.jsonl', 3000);
  at('c---proj-a/bbbb0001.jsonl', 500);
  return home;
}

test('scan de la fixture : titres, erreurs, sous-agent, regroupement C-/c-', async () => {
  const home = copyFixture();
  const stats: ScanStats = { types: {}, bytesRead: 0 };
  const { projects, sessions } = await scanClaudeData(home, { stats, isAlive: () => false });
  assert.equal(sessions.length, 4);
  assert.equal(projects.length, 1, 'C-/c- de même cwd = un projet');
  assert.deepEqual(projects[0]!.claudeDirs.sort(), ['C--proj-a', 'c---proj-a']);
  assert.equal(projects[0]!.sessions[0]!.sessionId, 'aaaa0003', 'la plus récente en premier');
  const by = Object.fromEntries(sessions.map((s) => [s.sessionId, s]));
  const a = by.aaaa0001!;
  assert.equal(a.title, 'Titre perso');
  assert.equal(a.titleSource, 'custom');
  assert.equal(a.cwd, 'C:\\proj\\a');
  assert.equal(a.gitBranch, 'main');
  assert.equal(a.costUsd, 1.25);
  assert.equal(a.endedAt, '2026-01-01T10:05:00.000Z');
  assert.equal(a.parseErrors, 1, 'ligne non JSON comptée');
  assert.deepEqual(a.subagents, [{ id: 'x1', agentType: 'dev-core', description: 'Sous-agent de test' }]);
  assert.equal(stats.types['type-futur-inconnu'], 1, 'type inconnu compté');
  assert.equal(by.aaaa0002!.titleSource, 'none');
  assert.equal(by.aaaa0002!.title, '');
  assert.equal(by.bbbb0001!.titleSource, 'first-prompt');
  assert.equal(by.aaaa0003!.live, undefined, 'pid mort = pas vivante');
});

test('session ouverte vivante si le pid répond', async () => {
  const home = copyFixture();
  const { sessions } = await scanClaudeData(home, { isAlive: () => true });
  assert.deepEqual(sessions.find((s) => s.sessionId === 'aaaa0003')!.live, { status: 'busy' });
});

test('première ligne > 64 Kio : cwd trouvé après plusieurs blocs', async () => {
  const home = copyFixture();
  const big = JSON.stringify({ type: 'attachment', pad: 'x'.repeat(70 * 1024) });
  const ok = JSON.stringify({ type: 'user', cwd: 'C:\\proj\\big', message: { role: 'user', content: 'Gros' } });
  writeFileSync(join(home, 'projects/C--proj-a/big00001.jsonl'), `${big}\n${ok}\n`);
  const { sessions } = await scanClaudeData(home);
  const s = sessions.find((x) => x.sessionId === 'big00001')!;
  assert.equal(s.cwd, 'C:\\proj\\big');
  assert.equal(s.title, 'Gros');
});

test('cache : réutilisé si taille et mtime inchangés, recalculé sinon', async () => {
  const home = copyFixture();
  const cachePath = join(home, 'cache', 'sessions-v1.json');
  const cold: ScanStats = { types: {}, bytesRead: 0 };
  await scanClaudeData(home, { cachePath, stats: cold });
  assert.ok(cold.bytesRead > 0);
  const warm: ScanStats = { types: {}, bytesRead: 0 };
  await scanClaudeData(home, { cachePath, stats: warm });
  assert.equal(warm.bytesRead, 0);
  const f = join(home, 'projects/c---proj-a/bbbb0001.jsonl');
  writeFileSync(f, '{"type":"user","cwd":"c:\\\\proj\\\\a","message":{"role":"user","content":"Change"}}\n');
  const again: ScanStats = { types: {}, bytesRead: 0 };
  const { sessions } = await scanClaudeData(home, { cachePath, stats: again });
  assert.ok(again.bytesRead > 0);
  assert.equal(sessions.find((s) => s.sessionId === 'bbbb0001')!.title, 'Change');
});

test('CLAUDE_HOME absent : résultat vide sans exception', async () => {
  const r = await scanClaudeData(join(tmpdir(), 'hub-inexistant-xyz'));
  assert.deepEqual(r.projects, []);
});
