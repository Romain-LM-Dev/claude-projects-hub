import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureProject } from '../core/identity.ts';
import { readRegistry, updateRegistry } from '../core/registry.ts';
import { attachProject, reconcile } from '../core/relocate.ts';
import { sandbox } from '../../test/fixtures/kit.ts';

// QA T11 (point p): the command handlers of relocation.ts run against a stub of the `vscode` module (QuickPick, modal box, messages).
const S: any = (globalThis as any).__vs = { cmds: new Map(), pick: undefined as any, warn: undefined as any, infos: [] as string[], errors: [] as string[], picked: [] as any[], warned: [] as any[] };
const stub = `const S = globalThis.__vs;
export const window = {
  showQuickPick: async (items, o) => { S.picked.push(items); return S.pick?.(items); },
  showWarningMessage: async (...a) => { S.warned.push(a); return S.warn; },
  showInformationMessage: async (m) => { S.infos.push(m); return undefined; },
  showErrorMessage: async (m) => { S.errors.push(m); return undefined; },
};
export const commands = { registerCommand: (id, fn) => { S.cmds.set(id, fn); return { dispose() {} }; }, executeCommand: async (id, ...a) => S.cmds.get(id)(...a) };`;
registerHooks({
  resolve(spec, ctx, next) {
    return spec === 'vscode' ? { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true } : next(spec, ctx);
  },
});
const { registerRelocation } = await import('./relocation.ts');

const sb = sandbox();
const reg = async () => (await readRegistry(sb.hub)).reg;
const ens = async (d: string) => (await ensureProject(d, { hubHome: sb.hub, git: false, exclude: sb.exclude }))!.id;
const claudeHome = join(sb.base, 'claude');
let current: any[] = [];
const hub: any = { hubHome: sb.hub, claudeHome, get: async () => ({ projects: current, reg: await reg() }) };
let refreshed = 0;
const { state } = registerRelocation(hub, () => { refreshed++; });
const cmd = (id: string, ...a: any[]) => S.cmds.get('claudeProjectsHub.' + id)(...a);
const proj = (cwd: string, id?: string) => ({ info: { cwd, claudeDirs: [], sessions: [] }, id, name: cwd.split(/[\\/]/).pop()! });
const reset = () => { S.pick = undefined; S.warn = undefined; S.infos.length = S.errors.length = S.picked.length = S.warned.length = 0; };

test('attachProject on a proposal node: candidate absorbed into the orphan, "Annuler" offered', async () => {
  reset();
  const o = sb.dir('orph'), c = sb.dir('cand');
  const [oid, cid] = [await ens(o), await ens(c)];
  await updateRegistry(sb.hub, async (r) => { r.projects[oid]!.paths = []; });
  await cmd('attachProject', { kind: 'proposal', pr: { orphanId: oid, candidateId: cid, reason: 'same-name' }, orphan: 'orph', candidate: 'cand' });
  assert.deepEqual(Object.keys((await reg()).projects), [oid]);
  assert.equal(state.lastMerges.length, 1);
  assert.deepEqual(S.errors, []);
  assert.match(S.infos[0], /rattaché/);
  assert.ok(refreshed > 0);
});

test('attachProject on a live project / an orphan: QuickPick excludes itself and unregistered projects; cancel = no change', async () => {
  reset();
  const [a, b, c] = [sb.dir('qa'), sb.dir('qb'), sb.dir('qc')];
  const [ia, ib] = [await ens(a), await ens(b)];
  current = [proj(a, ia), proj(b, ib), proj(c, undefined)];
  const before = JSON.stringify(await reg());
  await cmd('attachProject', { kind: 'project', p: current[0] });
  assert.deepEqual(S.picked[0].map((i: any) => i.p.id), [ib], 'only registered projects other than the kept one');
  assert.equal(JSON.stringify(await reg()), before, 'cancelled QuickPick must not change anything');
  S.pick = (items: any[]) => items[0];
  await cmd('attachProject', { kind: 'project', p: current[0] });
  const r = await reg();
  assert.ok(r.projects[ia] && !r.projects[ib], 'picked project absorbed into the node project');
  const o = sb.dir('qo'), x = sb.dir('qx');
  const [io, ix] = [await ens(o), await ens(x)];
  current = [proj(x, ix)];
  await cmd('attachProject', { kind: 'orphan', id: io, name: 'qo', claudeDirs: [] });
  assert.ok((await reg()).projects[io] && !(await reg()).projects[ix]);
});

test('attachProject on a project without id: error shown, registry untouched', async () => {
  reset();
  const before = JSON.stringify(await reg());
  await cmd('attachProject', { kind: 'project', p: proj(sb.dir('noid')) });
  assert.match(S.errors[0], /non enregistré/);
  assert.equal(JSON.stringify(await reg()), before);
});

test('copyAutoMemory: modal question gates the copy (closed = nothing, "Copier" = copy), proposal and orphan targets', async () => {
  reset();
  const m = join(claudeHome, 'projects', 'old-dir', 'memory');
  mkdirSync(m, { recursive: true });
  writeFileSync(join(m, 'n.md'), '---\nname: n\ndescription: d\ntype: project\n---\nx\n');
  writeFileSync(join(m, 'MEMORY.md'), '- [n](n.md) - d\n');
  const [o, c] = [sb.dir('cm-old'), sb.dir('cm-new')];
  const [oid, cid] = [await ens(o), await ens(c)];
  await updateRegistry(sb.hub, async (r) => { r.projects[oid]!.claudeDirs = ['old-dir']; r.projects[oid]!.paths = []; });
  const dst = join(claudeHome, 'projects', c.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'n.md');
  const node = { kind: 'proposal', pr: { orphanId: oid, candidateId: cid, reason: 'same-name' } };
  await cmd('copyAutoMemory', node);
  assert.equal(S.warned.length, 1);
  assert.equal(S.warned[0][1].modal, true);
  assert.ok(!existsSync(dst), 'closing the modal must not copy');
  S.warn = 'Copier';
  await cmd('copyAutoMemory', node);
  assert.ok(existsSync(dst), 'proposal: copy to the candidate folder');
  assert.match(S.infos.at(-1)!, /1 note\(s\) copiée\(s\)/);
  const t = sb.dir('cm-target');
  const tid = await ens(t);
  current = [proj(t, tid)];
  S.pick = (items: any[]) => items[0];
  await cmd('copyAutoMemory', { kind: 'orphan', id: oid, name: 'x', claudeDirs: ['old-dir'] });
  assert.ok(existsSync(join(claudeHome, 'projects', t.replace(/[^A-Za-z0-9]/g, '-'), 'memory', 'n.md')), 'orphan: copy to the picked project');
});

test('refreshFingerprints drops every stored fingerprint; the next reconcile recomputes them', async () => {
  reset();
  const id = await ens(sb.dir('fp'));
  await reconcile([], { hubHome: sb.hub, exclude: sb.exclude, fingerprint: async () => ({ rootCommits: ['r'], remote: 'x' }) });
  assert.ok((await reg()).projects[id]!.git, 'precondition');
  await cmd('refreshFingerprints');
  assert.ok(Object.values((await reg()).projects).every((e) => !('git' in e)));
  await reconcile([], { hubHome: sb.hub, exclude: sb.exclude, fingerprint: async () => ({ rootCommits: ['r2'], remote: 'y' }) });
  assert.deepEqual((await reg()).projects[id]!.git?.rootCommits, ['r2']);
});

test('undoMerge in conflict (.bak rewritten): error shown, registry untouched, record kept', async () => {
  reset();
  const [k, x, y, z] = [sb.dir('uk'), sb.dir('ux'), sb.dir('uy'), sb.dir('uz')];
  const [ik, ix, iy, iz] = [await ens(k), await ens(x), await ens(y), await ens(z)];
  const first = await attachProject(sb.hub, ik, ix);
  await attachProject(sb.hub, iy, iz);
  const before = readFileSync(join(sb.hub, 'registry.json'), 'utf8');
  state.lastMerges = [first];
  await cmd('undoMerge');
  assert.match(S.errors[0], /réécrit|annulation impossible/);
  assert.equal(readFileSync(join(sb.hub, 'registry.json'), 'utf8'), before);
  assert.deepEqual(state.lastMerges, [first]);
  state.lastMerges = [];
  await cmd('undoMerge');
  assert.match(S.infos.at(-1)!, /aucun rattachement/);
});
