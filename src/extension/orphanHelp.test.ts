import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { relinkOrphan } from '../core/orphanAdvice.ts';
import { newEntry, updateRegistry, readRegistry } from '../core/registry.ts';
import { writeTopic } from '../core/store.ts';
import { sandbox } from '../../test/fixtures/kit.ts';

const S: any = (globalThis as any).__vsOh = { cmds: new Map(), pick: undefined as any, open: undefined as any, info: undefined as any, choose: undefined as any, modals: [] as any[], infos: [] as string[], errors: [] as string[], picked: [] as any[], calls: [] as any[], opened: 0 };
const stub = `const S = globalThis.__vsOh;
export const window = {
  showQuickPick: async (items, o) => { S.picked.push({ items, o }); return S.pick?.(items); },
  showOpenDialog: async () => { S.opened++; return S.open; },
  showInformationMessage: async (m, ...b) => {
    if (b[0]?.modal) { S.modals.push({ m, detail: b[0].detail, buttons: b.slice(1) }); return S.choose?.(b.slice(1)); }
    S.infos.push(m); return S.info?.(m, b);
  },
  showErrorMessage: async (m) => { S.errors.push(m); return undefined; },
};
export const commands = { registerCommand: (id, fn) => { S.cmds.set(id, fn); return { dispose() {} }; }, executeCommand: async (id, ...a) => { S.calls.push([id, ...a]); return S.cmds.get(id)?.(...a); } };`;
registerHooks({
  resolve(spec, ctx, next) {
    return spec === 'vscode' ? { url: 'data:text/javascript,' + encodeURIComponent(stub), shortCircuit: true } : next(spec, ctx);
  },
});
const { registerOrphanHelp } = await import('./orphanHelp.ts');

const sb = sandbox();
const NOW = Date.UTC(2026, 10, 16);
const claudeHome = join(sb.base, 'claude');
const relinkCalls: any[][] = [];
let projects: any[] = [];
const hub: any = {
  hubHome: sb.hub, claudeHome, log: () => {},
  get: async () => ({ projects, temp: [], reg: (await readRegistry(sb.hub)).reg }),
};
registerOrphanHelp(hub, () => {}, { now: () => NOW, relink: (h, id, dir, o) => { relinkCalls.push([id, dir]); return relinkOrphan(h, id, dir, { ...o, exclude: sb.exclude }); } });
const help = (n: any) => S.cmds.get('claudeProjectsHub.orphanHelp')(n);
const OTHER = (b: string[]) => b.find((x) => x === 'Autres actions…');
const ADVISED = (b: string[]) => b[0];
const reset = () => { S.pick = S.open = S.info = undefined; S.choose = OTHER; S.modals.length = S.infos.length = S.errors.length = S.picked.length = S.calls.length = S.opened = relinkCalls.length = 0; };
const labels = () => S.picked[0].items.map((i: any) => i.label as string);

const mkOrphan = async (id: string, claudeDirs: string[]) => {
  await updateRegistry(sb.hub, async (r) => { const e = newEntry(join(sb.base, 'gone', id)); e.claudeDirs = claudeDirs; e.formerPaths = [join(sb.base, 'gone', id)]; r.projects[id] = e; });
  return { kind: 'orphan', id, name: id, claudeDirs };
};
const session = (claudeDir: string, days: number) => ({ sessionId: 's1', claudeDir, mtimeMs: NOW - days * 86_400_000, sizeBytes: 2097152, title: 'Ma session' });

test('facts and advice for an orphan with topics; choosing the advice runs the relink flow', async () => {
  reset();
  const n = await mkOrphan('o-topics', ['old-a']);
  await writeTopic({ hubHome: sb.hub, projectId: 'o-topics' }, 'project:t1', { title: 'T', summary: 's', body: 'b' });
  const mem = join(claudeHome, 'projects', 'old-a', 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'n.md'), '---\nname: n\ndescription: d\ntype: project\n---\nx\n');
  projects = [{ info: { cwd: 'x', claudeDirs: ['old-a'], sessions: [session('old-a', 70), session('other', 1)] } }];
  await help(n);
  const { m, detail, buttons } = S.modals[0];
  assert.equal(m, 'Orphelin o-topics : que faire ?');
  for (const want of [`Ancien dossier : ${join(sb.base, 'gone', 'o-topics')}`, 'Topics du projet : 1', 'Notes d\'auto-mémoire : 1', 'Sessions : 1 (2.0 Mo)', 'Dernière activité : il y a 70 jour(s)', 'Dernière session : Ma session', 'Conseil : Il porte des topics']) assert.ok(detail.includes(want), want);
  assert.deepEqual(buttons, ['Indiquer son nouveau dossier…', 'Autres actions…']);
  assert.equal(S.picked[0].o.title, 'Orphelin o-topics : que faire ?');
  const l = labels();
  assert.ok(l.includes('Indiquer son nouveau dossier… (conseillé)'));
  assert.ok(l.includes('Copier l\'auto-mémoire…'));
  assert.ok(S.picked[0].items.every((i: any) => i.run), 'only actions in the quick pick');
  reset();
  S.choose = ADVISED;
  await help(n);
  assert.equal(S.opened, 1, 'advice = relink: the folder dialog opens');
  assert.equal(S.picked.length, 0);
});

test('advice "dismiss" runs dismissOrphan on the node; no notes = no copy action; closing the dialog does nothing', async () => {
  reset();
  const n = await mkOrphan('o-empty', []);
  projects = [];
  const dismissed: any[] = [];
  S.cmds.set('claudeProjectsHub.dismissOrphan', (x: any) => { dismissed.push(x); });
  await help(n);
  assert.ok(!labels().includes('Copier l\'auto-mémoire…'));
  S.choose = () => undefined;
  await help(n);
  assert.equal(dismissed.length, 0);
  assert.equal(S.picked.length, 1, 'closed dialog: no quick pick');
  S.choose = ADVISED;
  await help(n);
  assert.deepEqual(dismissed, [n]);
});

test('"Indiquer son nouveau dossier…": relinkOrphan gets the chosen folder; cancelled dialog does nothing', async () => {
  reset();
  const n = await mkOrphan('o-move', []);
  projects = [];
  const pickRelink = (items: any[]) => items.find((i) => i.label.startsWith('Indiquer son nouveau dossier'));
  S.pick = pickRelink;
  await help(n);
  assert.equal(S.opened, 1);
  assert.deepEqual(relinkCalls, []);
  const dir = sb.dir('moved');
  S.open = [{ fsPath: dir }];
  await help(n);
  assert.deepEqual(relinkCalls, [['o-move', dir]]);
  assert.deepEqual(S.errors, []);
  assert.deepEqual((await readRegistry(sb.hub)).reg.projects['o-move']!.paths, [dir]);
  assert.match(S.infos.at(-1), /rattaché/);
});

test('relink onto a registered project: merge with "Annuler" runs undoMerge; notes offer the auto-memory copy', async () => {
  reset();
  const n = await mkOrphan('o-merge', ['old-m']);
  const mem = join(claudeHome, 'projects', 'old-m', 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'n.md'), '---\nname: n\ndescription: d\ntype: project\n---\nx\n');
  projects = [];
  const live = sb.dir('live');
  const { ensureProject } = await import('../core/identity.ts');
  await ensureProject(live, { hubHome: sb.hub, git: false, exclude: sb.exclude });
  const undone: any[] = [];
  S.cmds.set('claudeProjectsHub.undoMerge', (r: any) => { undone.push(r); });
  S.pick = (items: any[]) => items.find((i) => i.label.startsWith('Indiquer son nouveau dossier'));
  S.open = [{ fsPath: live }];
  S.info = (m: string) => (/rattaché/.test(m) ? 'Annuler' : undefined);
  await help(n);
  assert.equal(undone.length, 1);
  assert.equal(undone[0].length, 1);
  // no merge: copy is offered
  reset();
  const dir = sb.dir('fresh');
  S.pick = (items: any[]) => items.find((i) => i.label.startsWith('Indiquer son nouveau dossier'));
  S.open = [{ fsPath: dir }];
  S.info = (m: string) => (/auto-mémoire/.test(m) ? 'Copier' : undefined);
  const copied: any[] = [];
  S.cmds.set('claudeProjectsHub.copyAutoMemory', (x: any) => { copied.push(x); });
  const n2 = await mkOrphan('o-copy', ['old-m']);
  await help(n2);
  assert.equal(copied.length, 1);
  assert.equal(copied[0].p.info.cwd, dir);
  assert.equal(copied[0].p.id, 'o-copy');
});
