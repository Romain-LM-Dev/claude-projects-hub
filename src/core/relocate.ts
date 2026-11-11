import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProjectInfo } from './claudeData.ts';
import { readAutoMemory } from './automemory.ts';
import { gitFingerprint, type GitFingerprint } from './git.ts';
import { isExcludedDir, markerFile, readMarker, findMarker, type ExcludeRoots, type Log } from './identity.ts';
import { withLock, writeFileAtomic } from './lock.ts';
import { HubError, isValidSlug, topicsDir } from './paths.ts';
import {
  findByPath, newEntry, pathKey, readRegistry, registryBackup, registryFile, serializeRegistry, emptyRegistry,
  updateRegistry, type ProjectEntry, type Registry,
} from './registry.ts';
import { listTopics, revisionOf } from './store.ts';

export interface MergeRecord {
  keptId: string;
  keptName: string;
  removedId: string;
  /** Marker files rewritten from `removedId` to `keptId`. */
  markers: string[];
  movedTopics: { from: string; to: string }[];
  /** Revision of the `.bak` written by this pass; `undoMerge` refuses if the `.bak` changed since. */
  backupRevision: string;
}
export interface Proposal { orphanId: string; candidateId: string; reason: 'root-commit' | 'same-name' }
export interface ReconcileResult { merges: MergeRecord[]; proposals: Proposal[]; orphans: string[] }

export interface ReconcileOpts {
  hubHome: string;
  exclude?: Partial<ExcludeRoots>;
  log?: Log;
  /** Injectable for tests; defaults to `gitFingerprint`. */
  fingerprint?: (dir: string) => Promise<GitFingerprint | null>;
}

const union = (a: string[], b: string[], key: (s: string) => string) => {
  const seen = new Set(a.map(key));
  return [...a, ...b.filter((x) => !seen.has(key(x)) && seen.add(key(x)))];
};
const lower = (s: string) => s.toLowerCase();
const markerJson = (id: string) => JSON.stringify({ id }) + '\n';

async function backup(hub: string, raw: string | null): Promise<string> {
  await mkdir(hub, { recursive: true });
  const content = raw ?? serializeRegistry(emptyRegistry());
  await writeFileAtomic(registryBackup(hub), content);
  return revisionOf(Buffer.from(content));
}

/** Moves topics of `absorbed` to `kept`; a taken slug gets `-<first 4 chars of absorbed id>`; nothing is overwritten. */
async function moveTopics(hub: string, keptId: string, absorbedId: string, moved: { from: string; to: string }[]): Promise<void> {
  const src = topicsDir(hub, 'project', absorbedId);
  const dst = topicsDir(hub, 'project', keptId);
  let names: string[] = [];
  try { names = await readdir(src); } catch { return; }
  await mkdir(dst, { recursive: true });
  for (const n of names) {
    const slug = n.endsWith('.md') ? n.slice(0, -3) : '';
    if (!isValidSlug(slug)) continue;
    const candidates = [join(dst, n), ...[4, 8, 36].map((len) => {
      const suffix = `-${absorbedId.slice(0, len)}`;
      return join(dst, `${slug.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}.md`);
    })];
    for (const target of candidates) {
      // lock on the target: a concurrent writeTopic (same lock) is never overwritten
      const done = await withLock(target, async () => {
        if (existsSync(target)) return false;
        await rename(join(src, n), target);
        moved.push({ from: join(src, n), to: target });
        return true;
      });
      if (done) break;
      if (target === candidates[3]) throw new HubError('exists', `topic déjà présent : ${target}`);
    }
  }
  await rmdir(src).catch(() => {});
  await rmdir(join(src, '..')).catch(() => {});
}

/** Puts markers back to `removedId` and moved topics back where they were (reverse order). Best effort. */
async function restoreMoves(markers: string[], moved: { from: string; to: string }[], removedId: string, keptId?: string): Promise<void> {
  for (const f of markers) {
    const dir = join(f, '..', '..');
    if (keptId === undefined || (await readMarker(dir)) === keptId) await writeFileAtomic(f, markerJson(removedId)).catch(() => {});
  }
  for (const t of [...moved].reverse()) {
    if (existsSync(t.to) && !existsSync(t.from)) { await mkdir(join(t.from, '..'), { recursive: true }); await rename(t.to, t.from).catch(() => {}); }
  }
}

/** Folds `absorbedId` into `keptId` inside `reg` (paths, claudeDirs, markers, topics). Caller holds the lock and made the .bak. */
async function mergeEntries(hub: string, reg: Registry, keptId: string, absorbedId: string, backupRevision: string): Promise<MergeRecord> {
  const k = reg.projects[keptId]!;
  const a = reg.projects[absorbedId]!;
  const markers: string[] = [];
  const movedTopics: { from: string; to: string }[] = [];
  try {
    await moveTopics(hub, keptId, absorbedId, movedTopics);
    for (const p of a.paths) {
      if ((await readMarker(p)) === absorbedId) { await writeFileAtomic(markerFile(p), markerJson(keptId)); markers.push(markerFile(p)); }
    }
  } catch (e) {
    await restoreMoves(markers, movedTopics, absorbedId);
    throw e;
  }
  k.paths = union(k.paths, a.paths, pathKey);
  k.formerPaths = union(k.formerPaths, a.formerPaths, pathKey);
  k.claudeDirs = union(k.claudeDirs, a.claudeDirs, lower);
  if (!k.git && a.git) k.git = a.git;
  delete reg.projects[absorbedId];
  return { keptId, keptName: k.name, removedId: absorbedId, markers, movedTopics, backupRevision };
}

const shareRoot = (a: ProjectEntry, b: ProjectEntry) => !!a.git && !!b.git && a.git.rootCommits.some((c) => b.git!.rootCommits.includes(c));

/** §7.4. `projects` = `scanClaudeData(...).projects`. Fingerprints are computed before the registry lock is taken. */
export async function reconcile(projects: ProjectInfo[], o: ReconcileOpts): Promise<ReconcileResult> {
  const fp = o.fingerprint ?? gitFingerprint;
  const fps = new Map<string, GitFingerprint | null>();
  const need = async (dir: string) => { const k = pathKey(dir); if (!fps.has(k)) fps.set(k, await fp(dir)); return fps.get(k)!; };
  const live = projects.filter((p) => existsSync(p.cwd) && !isExcludedDir(p.cwd, o.hubHome, o.exclude));
  const known = (await readRegistry(o.hubHome)).reg;
  for (const p of live) {
    const id = findByPath(known, p.cwd);
    if (!id || !('git' in known.projects[id]!)) await need(p.cwd);
  }
  for (const e of Object.values(known.projects)) {
    const d = e.paths.find((x) => existsSync(x));
    if (d && !('git' in e)) await need(d);
  }
  const result: ReconcileResult = { merges: [], proposals: [], orphans: [] };

  await updateRegistry(o.hubHome, async (reg) => {
    const E = reg.projects;
    for (const p of live) {
      const m = (await findMarker(p.cwd)).id;
      const id = m ?? findByPath(reg, p.cwd) ?? randomUUID();
      const e = (E[id] ??= newEntry(p.cwd));
      const k = pathKey(p.cwd);
      for (const [oid, other] of Object.entries(E)) if (oid !== id) other.paths = other.paths.filter((x) => pathKey(x) !== k);
      e.paths = union(e.paths, [p.cwd], pathKey);
      e.claudeDirs = union(e.claudeDirs, p.claudeDirs, lower);
    }
    for (const p of projects) {
      if (existsSync(p.cwd) || p.claudeDirs.some((d) => Object.values(E).some((e) => e.claudeDirs.some((x) => lower(x) === lower(d))))) continue;
      const k = pathKey(p.cwd);
      const same = Object.values(E).find((x) => x.paths.some((y) => pathKey(y) === k) || x.formerPaths.some((y) => pathKey(y) === k));
      if (same) { same.claudeDirs = union(same.claudeDirs, p.claudeDirs, lower); continue; }
      const e = newEntry(p.cwd);
      e.git = null; e.formerPaths = [p.cwd]; e.claudeDirs = p.claudeDirs;
      E[randomUUID()] = e;
    }
    for (const e of Object.values(E)) {
      const gone = e.paths.filter((x) => !existsSync(x));
      if (gone.length) { e.paths = e.paths.filter((x) => existsSync(x)); e.formerPaths = union(e.formerPaths, gone, pathKey); }
      // no git under the lock: an entry without a precomputed fingerprint waits for the next scan
      const f = e.paths.length ? fps.get(pathKey(e.paths[0]!)) : undefined;
      if (f !== undefined && !('git' in e)) e.git = f;
    }

    let rev: string | undefined;
    const orphanIds = () => Object.keys(E).filter((id) => !E[id]!.paths.length && !E[id]!.dismissed.includes(id));
    for (const oid of orphanIds()) {
      const O = E[oid]!;
      const cands = Object.keys(E).filter((id) => id !== oid && E[id]!.paths.length && !O.dismissed.includes(id));
      const certain: string[] = [];
      for (const cid of cands) {
        const C = E[cid]!;
        if (shareRoot(O, C) && O.git!.remote === C.git!.remote && !(await listTopics({ hubHome: o.hubHome, projectId: cid }, 'project')).length) certain.push(cid);
      }
      if (certain.length === 1) {
        rev ??= await backup(o.hubHome, serializeRegistry(reg)); // in-memory state: includes entries created by this pass
        const rec = await mergeEntries(o.hubHome, reg, oid, certain[0]!, rev);
        result.merges.push(rec);
        o.log?.(`Projet ${rec.keptName} rattaché à son nouveau dossier`);
        continue;
      }
      const names = new Set([O.name, ...O.formerPaths.map((x) => basename(x))].map(lower));
      for (const cid of cands) {
        const C = E[cid]!;
        const reason = shareRoot(O, C) ? 'root-commit' : C.paths.some((x) => names.has(lower(basename(x)))) ? 'same-name' : undefined;
        if (reason) result.proposals.push({ orphanId: oid, candidateId: cid, reason });
      }
    }
    result.orphans = orphanIds();
  });
  return result;
}

/** Cancels merges of ONE pass (same `.bak`): restores the registry once, records every refusal, restores markers and topics. */
export async function undoMerge(hubHome: string, recs: MergeRecord | MergeRecord[]): Promise<void> {
  const list = Array.isArray(recs) ? recs : [recs];
  if (!list.length) return;
  if (list.some((r) => r.backupRevision !== list[0]!.backupRevision)) throw new HubError('conflict', 'fusions de passes différentes : annulation séparée requise');
  await withLock(registryFile(hubHome), async () => {
    let bak: Buffer;
    try { bak = await readFile(registryBackup(hubHome)); } catch { throw new HubError('not_found', 'registry.json.bak introuvable'); }
    if (revisionOf(bak) !== list[0]!.backupRevision) throw new HubError('conflict', 'registry.json.bak a été réécrit depuis cette fusion : annulation impossible');
    const restored = JSON.parse(bak.toString('utf8')) as Registry;
    for (const rec of list) {
      const d = restored.projects[rec.keptId]?.dismissed; // the refused pair must not be merged again by the next scan
      if (d && !d.includes(rec.removedId)) d.push(rec.removedId);
    }
    await writeFileAtomic(registryFile(hubHome), serializeRegistry(restored));
    for (const rec of [...list].reverse()) await restoreMoves(rec.markers, rec.movedTopics, rec.removedId, rec.keptId);
  });
}

/** Manual "Rattacher à un projet…": `keptId` absorbs `absorbedId` (orphan or live). Same merge as automatic, with .bak. */
export async function attachProject(hubHome: string, keptId: string, absorbedId: string): Promise<MergeRecord> {
  if (keptId === absorbedId) throw new HubError('invalid_input', 'rattachement d\'un projet à lui-même');
  return updateRegistry(hubHome, async (reg) => {
    if (!reg.projects[keptId] || !reg.projects[absorbedId]) throw new HubError('not_found', 'projet inconnu');
    return mergeEntries(hubHome, reg, keptId, absorbedId, await backup(hubHome, serializeRegistry(reg)));
  });
}

/** "Ignorer ce candidat" (`candidateId`) or "Ignorer l'orphelin" (omit it: the orphan's own id is stored). */
export async function dismiss(hubHome: string, orphanId: string, candidateId: string = orphanId): Promise<void> {
  await updateRegistry(hubHome, async (reg) => {
    const O = reg.projects[orphanId];
    if (!O) throw new HubError('not_found', 'projet inconnu');
    if (!O.dismissed.includes(candidateId)) O.dismissed.push(candidateId);
  });
}

/** "Détacher ce dossier": `dir` leaves its project and gets a fresh identity (marker rewritten if present). Topics stay. */
export async function detachDir(hubHome: string, dir: string): Promise<string> {
  return updateRegistry(hubHome, async (reg) => {
    const from = findByPath(reg, dir);
    if (!from) throw new HubError('not_found', `dossier non rattaché : ${dir}`);
    if (!(await readMarker(dir)) && (await findMarker(dir)).id) throw new HubError('invalid_input', "ce dossier n'est pas la racine d'un projet");
    const k = pathKey(dir);
    const src = reg.projects[from]!;
    const id = randomUUID();
    src.paths = src.paths.filter((x) => pathKey(x) !== k);
    const e = newEntry(dir);
    e.paths = [dir];
    reg.projects[id] = e;
    if (await readMarker(dir)) await writeFileAtomic(markerFile(dir), markerJson(id));
    return id;
  });
}

const encodeDir = (p: string) => p.replace(/[^A-Za-z0-9]/g, '-');

/** §7.5. Copies absent notes and absent index lines from `fromClaudeDir` to the folder Claude uses for `newPath`. Confirmation is the caller's. */
export async function copyAutoMemory(claudeHome: string, fromClaudeDir: string, newPath: string): Promise<{ target: string; copied: string[]; indexLinesAdded: number }> {
  const name = encodeDir(newPath);
  if (name.length > 200) throw new HubError('invalid_input', 'chemin trop long : ouvrez d\'abord une session Claude dans le nouveau dossier');
  try {
    const s = JSON.parse(await readFile(join(claudeHome, 'settings.json'), 'utf8')) as { autoMemoryDirectory?: unknown };
    if (s.autoMemoryDirectory) throw new HubError('invalid_input', 'autoMemoryDirectory est réglé : ouvrez d\'abord une session Claude dans le nouveau dossier');
  } catch (e) { if (e instanceof HubError) throw e; }
  const srcDir = join(claudeHome, 'projects', fromClaudeDir, 'memory');
  const dstDir = join(claudeHome, 'projects', name, 'memory');
  const mem = await readAutoMemory(srcDir);
  const copied: string[] = [];
  if (mem.notes.length || mem.index) await mkdir(dstDir, { recursive: true });
  for (const n of mem.notes) {
    const f = basename(n.file);
    if (existsSync(join(dstDir, f))) continue;
    await copyFile(join(srcDir, f), join(dstDir, f));
    copied.push(f);
  }
  let indexLinesAdded = 0;
  if (mem.index) {
    const dst = join(dstDir, 'MEMORY.md');
    const cur = existsSync(dst) ? await readFile(dst, 'utf8') : '';
    const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
    const add = mem.index.split(/\r?\n/).filter((l) => l.trim() && !have.has(l.trim()));
    if (add.length) {
      await writeFile(dst, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
      indexLinesAdded = add.length;
    }
  }
  return { target: dstDir, copied, indexLinesAdded };
}
