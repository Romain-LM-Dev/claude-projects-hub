import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExcludeRoots } from '../../src/core/identity.ts';

export interface Sandbox { base: string; hub: string; exclude: ExcludeRoots; dir: (...p: string[]) => string }

/** Temp sandbox; `tmpDir` exclusion root is moved elsewhere so projects under the real tmpdir are not excluded. */
export function sandbox(): Sandbox {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hub-t3-')));
  const hub = join(base, 'hub');
  const exclude: ExcludeRoots = { claudeHome: join(base, '_claude'), hubHome: hub, tmpDir: join(base, '_tmp'), homeDir: join(base, '_home') };
  return { base, hub, exclude, dir: (...p) => { const d = join(base, 'w', ...p); mkdirSync(d, { recursive: true }); return d; } };
}

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();

/** Repo with one commit (and optional origin). */
export function initRepo(dir: string, remote?: string, seed = 'x'): string {
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'f.txt'), seed);
  git(dir, 'add', 'f.txt');
  git(dir, 'commit', '-q', '-m', seed);
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  return dir;
}
