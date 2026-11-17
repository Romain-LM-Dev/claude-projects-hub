import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { formatTopicLine } from '../hook/injection.ts';
import { ensureProject, resolveProject, type ExcludeRoots } from '../core/identity.ts';
import { l10n } from '../core/l10n.ts';
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

/** Descriptions: verbatim from architecture §5 (compared by a test); a function, the language being set at start-up. */
export const tools = () => [
  { name: 'memory_list', description: l10n.t("Lists the shared memory topics (current project and global)."),
    inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['project', 'global', 'all'] }, query: str, tag: str } } },
  { name: 'memory_read', description: l10n.t("Reads a full topic and its revision. Do this before memory_write on an existing topic."),
    inputSchema: { type: 'object', properties: { ref: str }, required: ['ref'] } },
  { name: 'memory_write',
    description: l10n.t("Creates or replaces a topic. A topic = a lasting subject (decision, convention, state of a piece of work), summarized in one line that is useful on its own. project: = this project; global: = useful to every project. Never secrets, passwords or client data. For an existing topic, pass the baseRevision read by memory_read."),
    inputSchema: { type: 'object', properties: { ref: str, title: str, summary: str, body: str, tags: { type: 'array', items: str }, baseRevision: str }, required: ['ref', 'title', 'summary', 'body'] } },
  { name: 'memory_append', description: l10n.t("Appends a dated entry at the end of an existing topic, with no risk of conflict between sessions."),
    inputSchema: { type: 'object', properties: { ref: str, text: str }, required: ['ref', 'text'] } },
];

/** Session project dir: `$CLAUDE_PROJECT_DIR`, else cwd (§5). */
export const sessionDir = (env: NodeJS.ProcessEnv, cwd: string) => env.CLAUDE_PROJECT_DIR || cwd;

type Args = Record<string, unknown>;
const bad = (m: string) => new HubError('invalid_input', m);

function need(a: Args, k: string): string {
  if (typeof a[k] !== 'string') throw bad(l10n.t("{0}: string expected", k));
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
    const excluded = new HubError('excluded', l10n.t("excluded folder (temporary or personal): global: topics only"));
    if (r.status === 'excluded') throw excluded;
    if (!create) throw new HubError('not_found', l10n.t("project not registered: no project: topic"));
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
    if (scope !== 'project' && scope !== 'global' && scope !== 'all') throw bad(l10n.t("scope: project, global or all"));
    const query = opt(a, 'query')?.toLowerCase();
    const tag = opt(a, 'tag');
    if (tag !== undefined && !isValidSlug(tag)) throw bad(l10n.t("tag: slug expected"));

    let id: string | undefined;
    let head = l10n.t("Project: not registered");
    try {
      const r = await resolveProject(o.projectDir, { hubHome: o.hubHome, exclude: o.exclude });
      if (r.status === 'resolved') {
        id = r.id;
        let name = id;
        try { name = (await readRegistry(o.hubHome)).reg.projects[id]?.name ?? id; } catch { /* name is cosmetic */ }
        head = l10n.t("Project: {0} ({1})", name, id);
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
        if (tags !== undefined && !(Array.isArray(tags) && tags.every((x) => typeof x === 'string'))) throw bad(l10n.t("tags: list of strings"));
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
      default: throw bad(l10n.t("unknown tool: {0}", name));
    }
  }

  const server = new Server({ name: 'hub', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const a = req.params.arguments ?? {};
      return { content: [{ type: 'text' as const, text: await call(req.params.name, a) }] };
    } catch (e) {
      const he = e instanceof HubError ? e : undefined;
      if (!he) log(`${req.params.name}: ${(e as Error).message}`);
      const code = he?.code ?? 'io';
      let msg = (e as Error).message;
      if (he?.currentRevision && !msg.includes(he.currentRevision)) msg += l10n.t(" (current revision: {0})", he.currentRevision);
      return { isError: true, content: [{ type: 'text' as const, text: l10n.t("ERROR {0}: {1}", code, msg) }] };
    }
  });
  return server;
}
