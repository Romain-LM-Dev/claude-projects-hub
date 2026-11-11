import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatTopicLine } from '../hook/injection.ts';
import { ensureProject, resolveProject, type ExcludeRoots } from '../core/identity.ts';
import { HubError, isValidSlug, parseRef } from '../core/paths.ts';
import { readRegistry } from '../core/registry.ts';
import { appendTopic, listTopics, readTopic, writeTopic, type StoreCtx } from '../core/store.ts';

export interface ServerOpts {
  hubHome: string;
  projectDir: string;
  exclude?: Partial<ExcludeRoots>;
  log?: (msg: string) => void;
}

const LIST_MAX = 200;
const str = { type: 'string' } as const;

/** Descriptions: verbatim from architecture §5 (compared by a test). */
export const TOOLS = [
  { name: 'memory_list', description: 'Liste les topics de mémoire partagée (projet courant et globaux).',
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'global', 'all'] }, query: str, tag: str } } },
  { name: 'memory_read', description: 'Lit un topic complet et sa révision. À faire avant memory_write sur un topic existant.',
    inputSchema: { type: 'object', properties: { ref: str }, required: ['ref'] } },
  { name: 'memory_write',
    description: 'Crée ou remplace un topic. Un topic = un sujet durable (décision, convention, état d\'un chantier), résumé en une ligne utile seul. project: = ce projet ; global: = utile à tous les projets. Jamais de secret, de mot de passe ni de donnée client. Pour un topic existant, passer baseRevision lu par memory_read.',
    inputSchema: { type: 'object', properties: { ref: str, title: str, summary: str, body: str, tags: { type: 'array', items: str }, baseRevision: str }, required: ['ref', 'title', 'summary', 'body'] } },
  { name: 'memory_append', description: 'Ajoute une entrée datée à la fin d\'un topic existant, sans risque de conflit entre sessions.',
    inputSchema: { type: 'object', properties: { ref: str, text: str }, required: ['ref', 'text'] } },
];

/** Session project dir: `$CLAUDE_PROJECT_DIR`, else cwd (§5). */
export const sessionDir = (env: NodeJS.ProcessEnv, cwd: string) => env.CLAUDE_PROJECT_DIR || cwd;

type Args = Record<string, unknown>;
const bad = (m: string) => new HubError('invalid_input', m);

function need(a: Args, k: string): string {
  if (typeof a[k] !== 'string') throw bad(`${k} : chaîne attendue`);
  return a[k] as string;
}
function opt(a: Args, k: string): string | undefined {
  if (a[k] === undefined) return undefined;
  return need(a, k);
}

export function createServer(o: ServerOpts): Server {
  const log = o.log ?? (() => {});

  /** Project id for a `project:` ref; `create` = write path (ensureProject when unregistered). */
  async function projectId(create: boolean): Promise<string> {
    const r = await resolveProject(o.projectDir, { hubHome: o.hubHome, exclude: o.exclude });
    if (r.status === 'resolved') return r.id;
    const excluded = new HubError('excluded', 'dossier exclu (temporaire ou personnel) : topics global: seulement');
    if (r.status === 'excluded') throw excluded;
    if (!create) throw new HubError('not_found', 'projet non enregistré : aucun topic project:');
    const p = await ensureProject(o.projectDir, { hubHome: o.hubHome, git: true, exclude: o.exclude, log });
    if (!p) throw excluded;
    return p.id;
  }

  async function ctxFor(ref: string, create: boolean): Promise<StoreCtx> {
    const parsed = parseRef(ref);
    return { hubHome: o.hubHome, projectId: parsed.scope === 'project' ? await projectId(create) : undefined };
  }

  async function list(a: Args): Promise<string> {
    const scope = opt(a, 'scope') ?? 'all';
    if (scope !== 'project' && scope !== 'global' && scope !== 'all') throw bad('scope : project, global ou all');
    const query = opt(a, 'query')?.toLowerCase();
    const tag = opt(a, 'tag');
    if (tag !== undefined && !isValidSlug(tag)) throw bad('tag : slug attendu');

    let id: string | undefined;
    let head = 'Projet : non enregistré';
    try {
      const r = await resolveProject(o.projectDir, { hubHome: o.hubHome, exclude: o.exclude });
      if (r.status === 'resolved') {
        id = r.id;
        let name = id;
        try { name = (await readRegistry(o.hubHome)).reg.projects[id]?.name ?? id; } catch { /* name is cosmetic */ }
        head = `Projet : ${name} (${id})`;
      }
    } catch (e) { log(`resolveProject: ${(e as Error).message}`); }

    const wanted = scope === 'all' ? (id ? 'all' : 'global') : scope;
    const entries = wanted === 'project' && !id ? [] : await listTopics({ hubHome: o.hubHome, projectId: id }, wanted);
    const lines = entries.flatMap((t) => {
      if (!t.valid) return [];
      if (tag && !t.tags.includes(tag)) return [];
      if (query && ![t.title, t.summary, ...t.tags].some((s) => s.toLowerCase().includes(query))) return [];
      return [formatTopicLine(t)];
    });
    return [head, ...lines.slice(0, LIST_MAX)].join('\n');
  }

  async function call(name: string, a: Args): Promise<string> {
    switch (name) {
      case 'memory_list': return list(a);
      case 'memory_read': {
        const ref = need(a, 'ref');
        const t = await readTopic(await ctxFor(ref, false), ref);
        return [`ref: ${t.ref}`, `title: ${t.title}`, `summary: ${t.summary}`, `tags: [${t.tags.join(', ')}]`,
          `updated: ${new Date(t.mtimeMs).toISOString()}`, `revision: ${t.revision}`, '---', t.body].join('\n');
      }
      case 'memory_write': {
        const ref = need(a, 'ref');
        const { tags } = a;
        if (tags !== undefined && !(Array.isArray(tags) && tags.every((x) => typeof x === 'string'))) throw bad('tags : liste de chaînes');
        const r = await writeTopic(await ctxFor(ref, true), ref, {
          title: need(a, 'title'), summary: need(a, 'summary'), body: need(a, 'body'),
          tags: tags as string[] | undefined, baseRevision: opt(a, 'baseRevision'),
        });
        return `ref: ${r.ref}\nrevision: ${r.revision}\ncreated: ${r.created}`;
      }
      case 'memory_append': {
        const ref = need(a, 'ref');
        const r = await appendTopic(await ctxFor(ref, false), ref, need(a, 'text'));
        return `ref: ${r.ref}\nrevision: ${r.revision}`;
      }
      default: throw bad(`outil inconnu : ${name}`);
    }
  }

  const server = new Server({ name: 'hub', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const a = req.params.arguments ?? {};
      return { content: [{ type: 'text' as const, text: await call(req.params.name, a) }] };
    } catch (e) {
      const he = e instanceof HubError ? e : undefined;
      if (!he) log(`${req.params.name}: ${(e as Error).message}`);
      const code = he?.code ?? 'io';
      let msg = (e as Error).message;
      if (he?.currentRevision && !msg.includes(he.currentRevision)) msg += ` (révision courante : ${he.currentRevision})`;
      return { isError: true, content: [{ type: 'text' as const, text: `ERREUR ${code} : ${msg}` }] };
    }
  });
  return server;
}
