import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { sandbox } from '../../test/fixtures/kit.ts';

const S: any = (globalThis as any).__vsd = { cmds: new Map(), warn: undefined as any, warned: [] as any[], input: undefined as any, inputs: [] as any[], infos: [] as string[], errors: [] as string[] };
const stub = `const S = globalThis.__vsd;
export const Uri = { file: (p) => ({ fsPath: p }) };
export const workspace = { fs: { delete: async () => { throw new Error('real trash must not be used'); } } };
export const window = {
  showWarningMessage: async (...a) => { S.warned.push(a); return S.warn; },
  showInputBox: async (o) => { S.inputs.push(o); return S.input; },
  showInformationMessage: async (m) => { S.infos.push(m); },
  showErrorMessage: async (m) => { S.errors.push(m); },
};
export const commands = { registerCommand: (id, fn) => { S.cmds.set(id, fn); return { dispose() {} }; } };`;
registerHooks({
  resolve(spec, ctx, next) {
    return spec === 'vscode' ? { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true } : next(spec, ctx);
  },
});
const { registerSessionDelete } = await import('./sessionDelete.ts');

const sb = sandbox();
const home = join(sb.base, 'claude');
const id = (n: number) => `0000000${n}-2222-3333-4444-555555555555`;
const put = (rel: string, data = 'data') => { const f = join(home, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data); };
for (const n of [1, 2, 3, 4]) { put(`projects/dir/${id(n)}.jsonl`); put(`session-env/${id(n)}/e`); }
put(`projects/old/${id(5)}.jsonl`);
put(`sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: id(4) }));

const sess = (n: number, claudeDir = 'dir') => ({ sessionId: id(n), claudeDir });
const proj = { info: { cwd: 'x', claudeDirs: ['dir'], sessions: [sess(1), sess(2), sess(4)] } };
const old = { info: { cwd: 'y', claudeDirs: ['old'], sessions: [sess(5, 'old')] } };
const refreshed = { inv: 0, ref: 0 };
const hub: any = { claudeHome: home, invalidate() { refreshed.inv++; }, get: async () => ({ projects: [proj, old], temp: [] }) };
let deleted: string[] = [];
let failOn: string | undefined;
registerSessionDelete(hub, () => { refreshed.ref++; }, async (u: any) => {
  if (failOn && u.fsPath.includes(failOn)) throw new Error('boom');
  deleted.push(u.fsPath);
});
const run = (...a: any[]) => S.cmds.get('claudeProjectsHub.deleteSessions')(...a);
const reset = () => { S.warn = undefined; S.input = undefined; S.inputs.length = S.warned.length = S.infos.length = S.errors.length = 0; deleted = []; failOn = undefined; };
const sNode = (n: number) => ({ kind: 'session', s: sess(n), p: proj });

test('multi-selection: right paths to the deleter, modal question with count and size', async () => {
  reset(); S.warn = 'Mettre à la corbeille';
  await run(sNode(1), [sNode(1), sNode(2)]);
  assert.equal(S.warned[0][1].modal, true);
  assert.match(S.warned[0][0], /Mettre 2 session\(s\) à la corbeille \(0\.0 Mo\)/);
  assert.deepEqual(deleted.sort(), [
    join(home, 'projects', 'dir', `${id(1)}.jsonl`), join(home, 'session-env', id(1)),
    join(home, 'projects', 'dir', `${id(2)}.jsonl`), join(home, 'session-env', id(2)),
  ].sort());
  assert.ok(refreshed.inv > 0 && refreshed.ref > 0);
});

test('cancelled confirmation deletes nothing', async () => {
  reset();
  await run(sNode(1));
  assert.equal(S.warned.length, 1);
  assert.deepEqual(deleted, []);
});

test('live session is excluded, with a message; only live = no question', async () => {
  reset(); S.warn = 'Mettre à la corbeille';
  await run({ kind: 'project', p: proj });
  assert.match(S.infos[0], /1 session\(s\) ouverte/);
  assert.match(S.warned[0][0], /Mettre 2 session/);
  assert.ok(!deleted.some((p) => p.includes(id(4))));
  reset();
  await run(sNode(4));
  assert.equal(S.warned.length, 0);
  assert.deepEqual(deleted, []);
});

test('error on one path: the others continue, error shown', async () => {
  reset(); S.warn = 'Mettre à la corbeille'; failOn = 'session-env';
  await run(sNode(1), [sNode(1), sNode(2)]);
  assert.equal(S.errors.length, 2);
  assert.equal(deleted.length, 2);
});

test('orphan node: sessions of its claudeDirs from the scan', async () => {
  reset(); S.warn = 'Mettre à la corbeille';
  await run({ kind: 'orphan', id: 'o', name: 'o', claudeDirs: ['old'] });
  assert.deepEqual(deleted, [join(home, 'projects', 'old', `${id(5)}.jsonl`)]);
});

test('deleteOrphan: cancelled at either step, live refusal, success forgets the entry, a failure keeps it', async () => {
  const hh = join(sb.base, 'hubhome');
  const reload = () => writeFileSync(join(hh, 'registry.json'), JSON.stringify({ version: 1, projects: { o: { name: 'o', paths: [], formerPaths: [], claudeDirs: ['old'], dismissed: [], createdAt: 'x' }, p: { name: 'p', paths: ['/p'], formerPaths: [], claudeDirs: [], dismissed: ['o'], createdAt: 'x' } } }));
  mkdirSync(join(hh, 'projects', 'o', 'topics'), { recursive: true });
  writeFileSync(join(hh, 'projects', 'o', 'topics', 't.md'), 'x');
  hub.hubHome = hh;
  const del = (n: any) => S.cmds.get('claudeProjectsHub.deleteOrphan')(n);
  const node = { kind: 'orphan', id: 'o', name: 'o', claudeDirs: ['old'] };
  const ids = () => Object.keys(JSON.parse(readFileSync(join(hh, 'registry.json'), 'utf8')).projects);
  reload(); reset();
  await del(node);
  assert.match(S.warned[0][0], /Supprimer « o » \? Partent à la corbeille : 1 session\(s\) \(0\.0 Mo\), 0 topic\(s\), 0 note\(s\) d'auto-mémoire\. Le hub l'oubliera\. Le dossier du projet n'est pas supprimé\./);
  assert.equal(S.inputs.length, 0); assert.deepEqual(deleted, []); assert.deepEqual(ids(), ['o', 'p']);
  reset(); S.warn = 'Continuer…';
  await del(node); // Escape on the input box
  assert.equal(S.inputs[0].ignoreFocusOut, true);
  assert.equal(S.inputs[0].validateInput('o'), undefined); assert.ok(S.inputs[0].validateInput('x'));
  assert.deepEqual(deleted, []);
  reset(); S.warn = 'Continuer…'; S.input = 'O';
  await del(node);
  assert.deepEqual(deleted, []); assert.deepEqual(ids(), ['o', 'p']);
  reset(); S.warn = 'Continuer…'; S.input = 'o'; failOn = 'hubhome';
  await del(node);
  assert.equal(deleted.length, 1); assert.deepEqual(ids(), ['o', 'p']);
  reset(); S.warn = 'Continuer…'; S.input = 'o';
  await del(node);
  assert.deepEqual(deleted.sort(), [join(home, 'projects', 'old'), join(hh, 'projects', 'o')].sort());
  assert.deepEqual(ids(), ['p']);
  put(`projects/old2/${id(4)}.jsonl`);
  const orphanIn = (dirs: object) => writeFileSync(join(hh, 'registry.json'), JSON.stringify({ version: 1, projects: { o: { name: 'o', paths: [], formerPaths: [], claudeDirs: ['dir'], dismissed: [], createdAt: 'x' }, ...dirs } }));
  orphanIn({});
  reset(); S.warn = 'Continuer…'; S.input = 'o';
  await del({ ...node, claudeDirs: ['dir'] });
  assert.match(S.infos[0], /ouverte/); assert.equal(S.warned.length, 0); assert.equal(S.inputs.length, 0);
  // The open session lives in a Claude folder another project also lists: it is not deleted, so it does not block.
  orphanIn({ p: { name: 'p', paths: ['/p'], formerPaths: [], claudeDirs: ['dir'], dismissed: [], createdAt: 'x' } });
  reset(); S.warn = undefined;
  await del({ ...node, claudeDirs: ['dir'] });
  assert.equal(S.infos.length, 0); assert.match(S.warned[0][0], /: 0 session\(s\)/);
});

test('deleteProject: live project loses its marker, never its folder; unregistered refused', async () => {
  const hh = join(sb.base, 'hubhome2');
  const dir = join(sb.base, 'work');
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'projects-hub.json'), '{"id":"w"}');
  mkdirSync(hh, { recursive: true });
  writeFileSync(join(hh, 'registry.json'), JSON.stringify({ version: 1, projects: { w: { name: 'w', paths: [dir], formerPaths: [], claudeDirs: ['old'], dismissed: [], createdAt: 'x' } } }));
  hub.hubHome = hh;
  const del = (n: any) => S.cmds.get('claudeProjectsHub.deleteProject')(n);
  const node = { kind: 'project', p: { id: 'w', name: 'w', info: { cwd: dir, claudeDirs: ['old'], sessions: [sess(5, 'old')] } } };
  reset();
  await del({ kind: 'project', p: { name: 't', info: { cwd: 'z', claudeDirs: [], sessions: [] } } });
  assert.match(S.infos[0], /non enregistré/); assert.equal(S.warned.length, 0);
  reset(); S.warn = 'Continuer…'; S.input = 'w';
  await del(node);
  assert.match(S.warned[0][0], /, le marqueur de /);
  assert.deepEqual(deleted.sort(), [join(home, 'projects', 'old'), join(dir, '.claude', 'projects-hub.json')].sort());
  assert.ok(!deleted.includes(dir) && !deleted.includes(join(dir, '.claude')));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(hh, 'registry.json'), 'utf8')).projects), []);
});
