import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { gitFingerprint } from './git.ts';
import { claudeHome as defaultClaudeHome } from './paths.ts';
import { findByPath, isDriveRoot, newEntry, pathKey, readRegistry, updateRegistry } from './registry.ts';

export interface ExcludeRoots { claudeHome: string; hubHome: string; tmpDir: string; homeDir: string }
export type Log = (msg: string) => void;

export const MARKER_REL = join('.claude', 'projects-hub.json');
export const EXCLUDE_LINE = '/.claude/projects-hub.json';
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const under = (k: string, rootKey: string) => k === rootKey || k.startsWith(rootKey.endsWith(sep) ? rootKey : rootKey + sep);

/** §7.3: under tmpdir, = home, drive root, under CLAUDE_HOME or HUB_HOME. Roots are injectable for tests. */
export function isExcludedDir(dir: string, hubHome: string, roots: Partial<ExcludeRoots> = {}): boolean {
  const r: ExcludeRoots = { claudeHome: defaultClaudeHome(), hubHome, tmpDir: tmpdir(), homeDir: homedir(), ...roots };
  const k = pathKey(dir);
  return isDriveRoot(dir) || k === pathKey(r.homeDir) || under(k, pathKey(r.tmpDir)) || under(k, pathKey(r.claudeHome)) || under(k, pathKey(r.hubHome));
}

export const markerFile = (root: string) => join(root, MARKER_REL);

export async function readMarker(root: string): Promise<string | undefined> {
  try {
    const id = (JSON.parse(await readFile(markerFile(root), 'utf8')) as { id?: unknown }).id;
    return typeof id === 'string' && ID_RE.test(id) ? id : undefined;
  } catch { return undefined; }
}

/** §7.3 step 1: own marker always counts; a parent's marker only if the climb reaches a folder holding `.git` (we are in a repo). */
export async function findMarker(dir: string): Promise<{ id?: string; last: string }> {
  const start = resolve(dir);
  let d = start;
  let parent: { id: string; last: string } | undefined;
  for (;;) {
    const id = await readMarker(d);
    if (id && d === start) return { id, last: d };
    if (id) parent ??= { id, last: d };
    const up = dirname(d);
    if (existsSync(join(d, '.git'))) return parent ?? { last: d };
    if (up === d) return { last: d };
    d = up;
  }
}

export type Resolution =
  | { status: 'excluded' }
  | { status: 'resolved'; id: string; via: 'marker' | 'registry' }
  | { status: 'unregistered' };

/** Session-time resolution (hook, MCP): never runs git, never writes. */
export async function resolveProject(dir: string, o: { hubHome: string; exclude?: Partial<ExcludeRoots> }): Promise<Resolution> {
  if (isExcludedDir(dir, o.hubHome, o.exclude)) return { status: 'excluded' };
  const { id } = await findMarker(dir);
  if (id) return { status: 'resolved', id, via: 'marker' };
  const hit = findByPath((await readRegistry(o.hubHome)).reg, dir);
  return hit ? { status: 'resolved', id: hit, via: 'registry' } : { status: 'unregistered' };
}

export interface EnsureOpts {
  hubHome: string;
  /** `false` (hook): git is never launched. `true` (MCP): fingerprint computed. */
  git: boolean;
  exclude?: Partial<ExcludeRoots>;
  log?: Log;
  /** Registry lock wait; the hook passes 500. */
  lockTimeoutMs?: number;
}

/** G = `.git` dir, or for a worktree the `gitdir:` target then `commondir` (§7.3). */
async function gitDirOf(root: string): Promise<string> {
  const dotGit = join(root, '.git');
  if (!(await stat(dotGit)).isFile()) return dotGit;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'));
  if (!m) throw new Error('.git sans ligne gitdir');
  let g = resolve(root, m[1]!);
  if (existsSync(join(g, 'commondir'))) g = resolve(g, (await readFile(join(g, 'commondir'), 'utf8')).trim());
  return g;
}

async function addExcludeLine(root: string): Promise<void> {
  const g = await gitDirOf(root);
  if (!existsSync(join(g, 'HEAD'))) return; // unvalidated `gitdir:` target: never write there
  const file = join(g, 'info', 'exclude');
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (text.split('\n').some((l) => l.replace(/\r/g, '').trim() === EXCLUDE_LINE)) return;
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, (text && !text.endsWith('\n') ? '\n' : '') + EXCLUDE_LINE + '\n');
}

/** §7.3. `null` when `dir` is excluded (nothing written). Marker/exclude failures are logged, not thrown. */
export async function ensureProject(dir: string, o: EnsureOpts): Promise<{ id: string; root: string } | null> {
  const log = o.log ?? (() => {});
  if (isExcludedDir(dir, o.hubHome, o.exclude)) return null;
  const found = await findMarker(dir);
  const root = found.id || (existsSync(join(found.last, '.git')) && !isExcludedDir(found.last, o.hubHome, o.exclude)) ? found.last : resolve(dir);
  const fp = o.git ? await gitFingerprint(root) : undefined;
  const id = await updateRegistry(o.hubHome, async (reg) => {
    let id = found.id ?? findByPath(reg, root) ?? randomUUID();
    if (!found.id) {
      try { await mkdir(dirname(markerFile(root)), { recursive: true }); await writeFile(markerFile(root), JSON.stringify({ id }) + '\n', { flag: 'wx' }); } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        const other = code === 'EEXIST' ? await readMarker(root) : undefined;
        if (other) id = other; else log(`marqueur non écrit (${code ?? (e as Error).message}) : ${root}`);
      }
    }
    const entry = (reg.projects[id] ??= newEntry(root));
    if (fp !== undefined && !('git' in entry)) entry.git = fp;
    const k = pathKey(root);
    for (const [pid, p] of Object.entries(reg.projects)) if (pid !== id) p.paths = p.paths.filter((x) => pathKey(x) !== k);
    if (!entry.paths.some((x) => pathKey(x) === k)) entry.paths.push(root);
    return id;
  }, { timeoutMs: o.lockTimeoutMs });
  if (existsSync(join(root, '.git'))) await addExcludeLine(root).catch((e) => log(`info/exclude non modifié : ${(e as Error).message}`));
  return { id, root };
}
