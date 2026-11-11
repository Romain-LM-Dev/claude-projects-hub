import { readFile } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import type { GitFingerprint } from './git.ts';
import { withLock, writeFileAtomic, type LockOptions } from './lock.ts';
import { HubError } from './paths.ts';

export interface ProjectEntry {
  name: string;
  paths: string[];
  formerPaths: string[];
  claudeDirs: string[];
  /** Absent = fingerprint not computed yet; `null` = no git repository. */
  git?: GitFingerprint | null;
  /** Refused candidate ids; an orphan's own id in it means "orphan ignored". */
  dismissed: string[];
  createdAt: string;
}
export interface Registry { version: 1; projects: Record<string, ProjectEntry> }

export const registryFile = (hub: string) => join(hub, 'registry.json');
export const registryBackup = (hub: string) => join(hub, 'registry.json.bak');
export const emptyRegistry = (): Registry => ({ version: 1, projects: {} });
export const serializeRegistry = (r: Registry) => JSON.stringify(r, null, 2) + '\n';

/** §7.1 comparison key: resolved, no trailing separator, lowercase on Windows. */
export function pathKey(p: string): string {
  const r = resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
export const isDriveRoot = (p: string) => resolve(p) === parse(resolve(p)).root;

export function newEntry(dir: string): ProjectEntry {
  return { name: parse(resolve(dir)).base || dir, paths: [], formerPaths: [], claudeDirs: [], dismissed: [], createdAt: new Date().toISOString() };
}

export function findByPath(reg: Registry, dir: string): string | undefined {
  const k = pathKey(dir);
  return Object.keys(reg.projects).find((id) => reg.projects[id]!.paths.some((p) => pathKey(p) === k));
}

/** Missing file = empty registry (lost registry); unreadable JSON = `invalid_file`. */
export async function readRegistry(hub: string): Promise<{ reg: Registry; raw: string | null }> {
  let raw: string;
  try { raw = await readFile(registryFile(hub), 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { reg: emptyRegistry(), raw: null };
    throw new HubError('io', `lecture impossible : ${(e as Error).message}`);
  }
  try {
    const reg = JSON.parse(raw) as Registry;
    if (reg.version !== 1 || typeof reg.projects !== 'object' || !reg.projects) throw new Error('forme inattendue');
    return { reg, raw };
  } catch (e) {
    throw new HubError('invalid_file', `registry.json illisible : ${(e as Error).message}`);
  }
}

/** Lock (§4.3), re-read, `fn` mutates `reg`, atomic write only if it changed. The hook passes `timeoutMs: 500`. */
export async function updateRegistry<T>(hub: string, fn: (reg: Registry, raw: string | null) => Promise<T>, opts: LockOptions = {}): Promise<T> {
  return withLock(registryFile(hub), async () => {
    const { reg, raw } = await readRegistry(hub);
    const before = serializeRegistry(reg);
    const out = await fn(reg, raw);
    const after = serializeRegistry(reg);
    if (after !== before) await writeFileAtomic(registryFile(hub), after);
    return out;
  }, opts);
}
