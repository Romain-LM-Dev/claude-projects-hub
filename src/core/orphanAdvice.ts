import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ensureProject, findMarker, isExcludedDir, markerFile, resolveProject, type ExcludeRoots, type Log } from './identity.ts';
import { HubError } from './paths.ts';
import { readRegistry } from './registry.ts';
import { attachProject, type MergeRecord } from './relocate.ts';

export type OrphanAction = 'attachCandidate' | 'dismiss' | 'relink' | 'deleteSessions';
export interface OrphanFacts { candidate?: string; sessions: number; topics: number; notes: number; daysIdle?: number }

export const IDLE_DAYS = 60;

/** §7.4 "Aide": first true case wins. */
export function adviseOrphan(f: OrphanFacts): { action: OrphanAction; text: string } {
  if (f.candidate) return { action: 'attachCandidate', text: `Un projet vivant (${f.candidate}) lui ressemble : rattachez-le pour retrouver sessions et mémoire au même endroit.` };
  if (!f.sessions && !f.topics && !f.notes) return { action: 'dismiss', text: 'Aucune session, aucun topic, aucune note : il ne contient rien à garder, ignorez-le.' };
  if (f.topics || f.notes) return { action: 'relink', text: 'Il porte des topics ou des notes d\'auto-mémoire : ne supprimez rien ; indiquez son nouveau dossier ou rattachez-le à un projet existant.' };
  if (f.daysIdle !== undefined && f.daysIdle > IDLE_DAYS) return { action: 'deleteSessions', text: `Inactif depuis plus de ${IDLE_DAYS} jours et sans topic ni note : ses sessions peuvent aller à la corbeille.` };
  return { action: 'relink', text: 'Récent et sans topic : si le dossier a été déplacé, indiquez son nouveau dossier ; sinon ignorez l\'orphelin.' };
}

/** §7.4 « Indiquer son nouveau dossier… ». */
export async function relinkOrphan(hubHome: string, orphanId: string, dir: string, o: { exclude?: Partial<ExcludeRoots>; log?: Log } = {}):
  Promise<{ kind: 'merged'; record: MergeRecord } | { kind: 'linked'; id: string }> {
  if (isExcludedDir(dir, hubHome, o.exclude)) throw new HubError('excluded', `dossier exclu : ${dir}`);
  if (!(await readRegistry(hubHome)).reg.projects[orphanId]) throw new HubError('not_found', 'projet inconnu');
  const ens = () => ensureProject(dir, { hubHome, git: true, exclude: o.exclude, log: o.log });
  const r = await resolveProject(dir, { hubHome, exclude: o.exclude });
  if (r.status === 'resolved' && r.id !== orphanId) {
    if (!(await readRegistry(hubHome)).reg.projects[r.id]) await ens(); // marker of a clone the registry has not seen yet
    return { kind: 'merged', record: await attachProject(hubHome, orphanId, r.id) };
  }
  if (r.status !== 'resolved') {
    const { last } = await findMarker(dir);
    const root = existsSync(join(last, '.git')) && !isExcludedDir(last, hubHome, o.exclude) ? last : resolve(dir);
    try {
      await mkdir(dirname(markerFile(root)), { recursive: true });
      await writeFile(markerFile(root), JSON.stringify({ id: orphanId }) + '\n', { flag: 'wx' });
    } catch (e) {
      // Without the marker, ensureProject would register the folder under a new id: stop, nothing written.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new HubError('io', `marqueur impossible à écrire dans ${root} : ${(e as Error).message}`);
    }
  }
  const got = await ens();
  if (!got) throw new HubError('excluded', `dossier exclu : ${dir}`);
  if (got.id !== orphanId) throw new HubError('conflict', 'le dossier appartient déjà à un autre projet');
  return { kind: 'linked', id: got.id };
}
