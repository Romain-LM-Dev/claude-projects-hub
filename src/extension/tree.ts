import * as vscode from "vscode";
import { basename, join } from "node:path";
import { scanClaudeData, type ProjectInfo } from "../core/claudeData.ts";
import { readAutoMemory, type MemoryNote } from "../core/automemory.ts";
import { resolveProject } from "../core/identity.ts";
import { parseRef, topicFile } from "../core/paths.ts";
import { emptyRegistry, pathKey, readRegistry, type Registry } from "../core/registry.ts";
import { reconcile, type Proposal, type ReconcileResult } from "../core/relocate.ts";
import { listTopics, type TopicEntry } from "../core/store.ts";
import type { SessionSummary, SubagentInfo } from "../core/transcript.ts";

export interface Proj { info: ProjectInfo; id?: string; name: string }

export type Node =
  | { kind: "project"; p: Proj; open?: boolean }
  | { kind: "temp"; items: Proj[] }
  | { kind: "proposals"; items: Extract<Node, { kind: "proposal" }>[] }
  | { kind: "proposal"; pr: Proposal; orphan: string; candidate: string }
  | { kind: "orphans"; items: Extract<Node, { kind: "orphan" }>[] }
  | { kind: "orphan"; id: string; name: string; claudeDirs: string[] }
  | { kind: "memory"; p: Proj; items: TopicEntry[] }
  | { kind: "auto"; p: Proj; items: MemoryNote[] }
  | { kind: "sessions"; p: Proj }
  | { kind: "topic"; entry: TopicEntry; projectId?: string }
  | { kind: "note"; note: MemoryNote; p: Proj }
  | { kind: "session"; s: SessionSummary; p: Proj }
  | { kind: "subagent"; s: SessionSummary; a: SubagentInfo };

export interface Data { projects: Proj[]; temp: Proj[]; reg: Registry; reloc: ReconcileResult }

/** Shared roots and memoized scan; `invalidate()` forces the next rescan. */
export class Hub {
  readonly hubHome: string;
  readonly claudeHome: string;
  log: (msg: string) => void = () => {};
  /** Called after each scan's reconciliation (§7.4). */
  onReconcile: (r: ReconcileResult) => void = () => {};
  private data?: Promise<Data>;
  constructor(hubHome: string, claudeHome: string) { this.hubHome = hubHome; this.claudeHome = claudeHome; }
  get cachePath() { return join(this.hubHome, "cache", "sessions-v1.json"); }
  invalidate() { this.data = undefined; }
  get(): Promise<Data> { return (this.data ??= this.load()); }

  private async load(): Promise<Data> {
    const t0 = Date.now();
    const { projects, sessions } = await scanClaudeData(this.claudeHome, { cachePath: this.cachePath });
    let reloc: ReconcileResult = { merges: [], proposals: [], orphans: [] };
    try { reloc = await reconcile(projects, { hubHome: this.hubHome, log: this.log }); } catch (e) { this.log(`rapprochement : ${(e as Error).message}`); }
    const reg = (await readRegistry(this.hubHome).catch(() => ({ reg: emptyRegistry() }))).reg;
    const out: Data = { projects: [], temp: [], reg, reloc };
    for (const info of projects) {
      const r = await resolveProject(info.cwd, { hubHome: this.hubHome });
      const id = r.status === "resolved" ? r.id : undefined;
      const p: Proj = { info, id, name: (id && reg.projects[id]?.name) || basename(info.cwd) || info.cwd };
      (r.status === "excluded" ? out.temp : out.projects).push(p);
    }
    const recent = (p: Proj) => p.info.sessions[0]?.mtimeMs ?? 0;
    out.projects.sort((a, b) => recent(b) - recent(a));
    this.log(`scan : ${projects.length} projets, ${sessions.length} sessions en ${Date.now() - t0} ms`);
    this.onReconcile(reloc);
    return out;
  }
}

export const topicUri = (hub: Hub, ref: string, projectId?: string) =>
  vscode.Uri.file(topicFile(hub.hubHome, parseRef(ref), projectId));

export const sessionUri = (s: SessionSummary, agent?: SubagentInfo) =>
  vscode.Uri.from({
    scheme: "claude-session",
    path: agent ? `/${s.claudeDir}/${s.sessionId}/subagents/${agent.id}.md` : `/${s.claudeDir}/${s.sessionId}.md`,
    query: "page=1",
  });

function describe(s: SessionSummary): string {
  const when = s.endedAt ?? s.startedAt ?? new Date(s.mtimeMs).toISOString();
  return [
    new Date(when).toLocaleString(),
    s.entrypoint,
    s.costUsd !== undefined ? `$${s.costUsd.toFixed(2)}` : undefined,
    s.live ? "en cours" : undefined,
  ].filter(Boolean).join(" · ");
}

export class TreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly hub: Hub;
  private readonly mode: "projects" | "global";
  constructor(hub: Hub, mode: "projects" | "global") { this.hub = hub; this.mode = mode; }
  fire() { this.emitter.fire(undefined); }

  async getChildren(n?: Node): Promise<Node[]> {
    if (!n) return this.mode === "global" ? this.topics() : this.roots();
    switch (n.kind) {
      case "project": return this.projectChildren(n.p);
      case "temp": return n.items.map((p) => ({ kind: "project", p }));
      case "proposals": case "orphans": return n.items;
      case "memory": return n.items.map((entry) => ({ kind: "topic", entry, projectId: n.p.id }));
      case "auto": return n.items.map((note) => ({ kind: "note", note, p: n.p }));
      case "sessions": return n.p.info.sessions.map((s) => ({ kind: "session", s, p: n.p }));
      case "session": return n.s.subagents.map((a) => ({ kind: "subagent", s: n.s, a }));
      default: return [];
    }
  }

  private async topics(): Promise<Node[]> {
    const entries = await listTopics({ hubHome: this.hub.hubHome }, "global");
    return entries.map((entry) => ({ kind: "topic", entry }));
  }

  private async roots(): Promise<Node[]> {
    const { projects, temp, reg, reloc } = await this.hub.get();
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const open = ws ? projects.find((p) => pathKey(p.info.cwd) === pathKey(ws)) : undefined;
    const nodes: Node[] = [];
    if (open) nodes.push({ kind: "project", p: open, open: true });
    for (const p of projects) if (p !== open) nodes.push({ kind: "project", p });
    const name = (id: string) => reg.projects[id]?.name ?? id;
    const proposals = reloc.proposals.map((pr) => ({ kind: "proposal" as const, pr, orphan: name(pr.orphanId), candidate: name(pr.candidateId) }));
    if (proposals.length) nodes.push({ kind: "proposals", items: proposals });
    const proposed = new Set(reloc.proposals.map((x) => x.orphanId));
    const orphans = reloc.orphans.filter((id) => !proposed.has(id)).map((id) => ({ kind: "orphan" as const, id, name: name(id), claudeDirs: reg.projects[id]?.claudeDirs ?? [] }));
    if (orphans.length) nodes.push({ kind: "orphans", items: orphans });
    if (temp.length && vscode.workspace.getConfiguration("claudeProjectsHub").get<boolean>("showTemporaryProjects")) {
      nodes.push({ kind: "temp", items: temp });
    }
    return nodes;
  }

  private async projectChildren(p: Proj): Promise<Node[]> {
    const nodes: Node[] = [];
    if (p.id) nodes.push({ kind: "memory", p, items: await listTopics({ hubHome: this.hub.hubHome, projectId: p.id }, "project") });
    const notes: MemoryNote[] = [];
    for (const dir of p.info.claudeDirs) {
      notes.push(...(await readAutoMemory(join(this.hub.claudeHome, "projects", dir, "memory"))).notes);
    }
    nodes.push({ kind: "auto", p, items: notes }, { kind: "sessions", p });
    return nodes;
  }

  getTreeItem(n: Node): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    const mk = (label: string, state: number, contextValue: string) => {
      const it = new vscode.TreeItem(label, state);
      it.contextValue = contextValue;
      return it;
    };
    switch (n.kind) {
      case "project": {
        const it = mk(n.p.name, n.open ? C.Expanded : C.Collapsed, "project");
        it.description = n.open ? "projet ouvert" : n.p.info.cwd;
        it.tooltip = n.p.info.cwd;
        return it;
      }
      case "temp": return mk(`Temporaires (${n.items.length})`, C.Collapsed, "temp");
      case "proposals": return mk(`À rattacher (${n.items.length})`, C.Expanded, "proposals");
      case "orphans": return mk(`Orphelins (${n.items.length})`, C.Collapsed, "orphans");
      case "proposal": {
        const it = mk(`${n.orphan} → ${n.candidate}`, C.None, "proposal");
        it.description = n.pr.reason === "root-commit" ? "même historique git" : "même nom de dossier";
        return it;
      }
      case "orphan": {
        const it = mk(n.name, C.None, "orphan");
        it.description = "dossier introuvable";
        return it;
      }
      case "memory": return mk(`Mémoire (${n.items.length})`, n.items.length ? C.Collapsed : C.None, "memoryGroup");
      case "auto": return mk(`Auto-mémoire Claude (${n.items.length})`, n.items.length ? C.Collapsed : C.None, "autoGroup");
      case "sessions": return mk(`Sessions (${n.p.info.sessions.length})`, C.Collapsed, "sessionsGroup");
      case "topic": {
        const e = n.entry;
        const it = mk(e.valid ? e.title : e.ref, C.None, "topic");
        it.description = e.valid ? e.ref : `illisible : ${e.error}`;
        it.tooltip = e.valid ? e.summary : e.error;
        it.command = { command: "vscode.open", title: "Ouvrir", arguments: [topicUri(this.hub, e.ref, n.projectId)] };
        return it;
      }
      case "note": {
        const it = mk(n.note.name ?? basename(n.note.file), C.None, "note");
        it.description = n.note.type;
        it.tooltip = n.note.description;
        it.command = { command: "vscode.open", title: "Ouvrir", arguments: [vscode.Uri.file(n.note.file)] };
        return it;
      }
      case "session": {
        const s = n.s;
        const it = mk(s.title || s.sessionId, s.subagents.length ? C.Collapsed : C.None, "session");
        it.description = describe(s);
        it.tooltip = [s.cwd, s.gitBranch && `branche ${s.gitBranch}`, s.version && `version ${s.version}`].filter(Boolean).join("\n");
        it.command = { command: "claudeProjectsHub.openSession", title: "Ouvrir la session", arguments: [sessionUri(s)] };
        return it;
      }
      case "subagent": {
        const it = mk(n.a.description || n.a.id, C.None, "subagent");
        it.description = n.a.agentType;
        it.command = { command: "claudeProjectsHub.openSession", title: "Ouvrir le sous-agent", arguments: [sessionUri(n.s, n.a)] };
        return it;
      }
    }
  }
}
