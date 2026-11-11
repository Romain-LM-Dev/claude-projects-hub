import { ensureProject, resolveProject, type ExcludeRoots } from '../core/identity.ts';
import { readRegistry } from '../core/registry.ts';
import { listTopics } from '../core/store.ts';
import { HOOK_BUDGET, PROJECT_NONE, PROJECT_UNREGISTERED, buildHeader, buildInjection, projectLabel } from './injection.ts';

export interface InjectionOpts {
  hubHome: string;
  /** true for the hook (§6.2: registers the project first); false for the read-only preview (§10). */
  ensure: boolean;
  exclude?: Partial<ExcludeRoots>;
  log?: (msg: string) => void;
}

/** Text injected at SessionStart for `dir` (§6.3); shared by the hook and the "Aperçu de l'injection" command. */
export async function injectionFor(dir: string, o: InjectionOpts): Promise<string> {
  const { hubHome: hub, log = () => {} } = o;
  let id: string | undefined;
  let excluded = false;
  const resolve = async () => {
    try {
      const r = await resolveProject(dir, { hubHome: hub, exclude: o.exclude });
      if (r.status === 'resolved') id = r.id; else excluded = r.status === 'excluded';
    } catch (e) { log(`resolveProject: ${(e as Error).message}`); }
  };
  if (o.ensure) {
    try {
      const p = await ensureProject(dir, { hubHome: hub, git: false, exclude: o.exclude, log, lockTimeoutMs: 500 });
      if (p) id = p.id; else excluded = true;
    } catch (e) {
      log(`ensureProject: ${(e as Error).message}`);
      await resolve();
    }
  } else await resolve();

  let project = excluded ? PROJECT_NONE : PROJECT_UNREGISTERED;
  if (id) {
    let name = id;
    try { name = (await readRegistry(hub)).reg.projects[id]?.name ?? id; } catch (e) { log(`registre: ${(e as Error).message}`); }
    project = projectLabel(name);
  }
  const valid = (await listTopics({ hubHome: hub, projectId: id }, 'all')).flatMap((t) => (t.valid ? [t] : []));
  return buildInjection(buildHeader(project), valid.filter((t) => t.ref.startsWith('project:')), valid.filter((t) => t.ref.startsWith('global:')), HOOK_BUDGET);
}
