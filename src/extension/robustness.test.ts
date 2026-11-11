import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { sandbox } from '../../test/fixtures/kit.ts';

// Hub.get() with an unreadable registry, and the session id check of resume.ts, against a stub of `vscode`.
const S: any = (globalThis as any).__vs2 = { cmds: new Map(), errors: [] as string[], opened: [] as string[], sent: [] as string[] };
const stub = `const S = globalThis.__vs2;
export const window = { showErrorMessage: async (m) => { S.errors.push(m); }, createTerminal: () => ({ show() {}, sendText: (t) => S.sent.push(t) }) };
export const commands = { registerCommand: (id, fn) => { S.cmds.set(id, fn); return { dispose() {} }; } };
export const env = { openExternal: async (u) => { S.opened.push(u); } };
export const Uri = { parse: (s) => s };`;
registerHooks({
  resolve(spec, ctx, next) {
    return spec === 'vscode' ? { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true } : next(spec, ctx);
  },
});
const { Hub } = await import('./tree.ts');
const { registerResume } = await import('./resume.ts');

test('Hub.get with an unreadable registry: projects still listed, error shown, a failed scan is not cached', async () => {
  const sb = sandbox();
  const claudeHome = join(sb.base, 'claude');
  const cwd = join(process.platform === 'win32' ? 'C:/' : '/', 'hub-test-absent-dir', 'proj'); // outside the excluded tmpdir
  const dir = join(claudeHome, 'projects', 'proj-dir');
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'user', cwd, sessionId: 's1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'hi' } });
  writeFileSync(join(dir, 's1.jsonl'), line + '\n');
  mkdirSync(sb.hub, { recursive: true });
  writeFileSync(join(sb.hub, 'registry.json'), '{not json');
  const hub = new Hub(sb.hub, claudeHome);
  const logs: string[] = [];
  hub.log = (m) => logs.push(m);
  const d = await hub.get();
  assert.equal(d.projects.length, 1, 'project listed although the registry is unreadable');
  assert.ok(logs.some((l) => l.includes('non résolu')), 'logged in the Diagnostic channel');

  // Failure of the whole scan: error message, and the next get() retries instead of replaying the rejection.
  const bad = new Hub(sb.hub, claudeHome);
  let calls = 0;
  (bad as any).load = async () => { if (calls++ === 0) throw new Error('boom'); return d; };
  await assert.rejects(bad.get(), /boom/);
  await new Promise((r) => setImmediate(r));
  assert.match(S.errors[0], /boom/);
  assert.equal(await bad.get(), d);
  rmSync(sb.base, { recursive: true, force: true });
});

test('resume: --xyz refused, UUID accepted', async () => {
  registerResume();
  const node = (sessionId: string) => ({ kind: 'session', s: { sessionId }, p: { info: { cwd: process.cwd() } } });
  const term = S.cmds.get('claudeProjectsHub.resumeInTerminal');
  term(node('--xyz'));
  assert.deepEqual(S.sent, []);
  const id = '0F8fad5b-d9cb-469f-a165-70867728950e';
  term(node(id));
  assert.deepEqual(S.sent, [`claude --resume ${id}`]);
  await S.cmds.get('claudeProjectsHub.resumeInClaude')(node('--xyz'));
  assert.deepEqual(S.opened, []);
});
