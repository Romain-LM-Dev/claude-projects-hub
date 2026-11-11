import * as vscode from "vscode";
import { join } from "node:path";
import { renderSessionPage } from "../core/transcript.ts";

export const SCHEME = "claude-session";
const SEG = /^[^\\/:*?"<>|]+$/;

export interface SessionRef { claudeDir: string; sessionId: string; agentId?: string; page: number }

/** `/<claudeDir>/<sessionId>.md` or `/<claudeDir>/<sessionId>/subagents/<agentId>.md`, `?page=N`. */
export function parseSessionUri(path: string, query: string): SessionRef {
  const parts = path.replace(/^\//, "").replace(/\.md$/, "").split("/");
  const ok = (parts.length === 2 || (parts.length === 4 && parts[2] === "subagents")) && parts.every((p) => SEG.test(p) && p !== "..");
  if (!ok) throw new Error(`URI de session invalide : ${path}`);
  const page = Math.max(1, Number(new URLSearchParams(query).get("page")) || 1);
  return { claudeDir: parts[0]!, sessionId: parts[1]!, agentId: parts[3], page };
}

const uriOf = (r: SessionRef, page: number) =>
  `${SCHEME}:/${r.claudeDir}/${r.sessionId}${r.agentId ? `/subagents/${r.agentId}` : ""}.md?page=${page}`;

export class SessionDocuments implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider {
  private readonly claudeHome: string;
  private readonly log: (msg: string) => void;
  constructor(claudeHome: string, log: (msg: string) => void) { this.claudeHome = claudeHome; this.log = log; }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const r = parseSessionUri(uri.path, uri.query);
      const base = join(this.claudeHome, "projects", r.claudeDir);
      const file = r.agentId ? join(base, r.sessionId, "subagents", `agent-${r.agentId}.jsonl`) : join(base, `${r.sessionId}.jsonl`);
      const t0 = Date.now();
      const { markdown, hasNext } = await renderSessionPage(file, r.page);
      this.log(`document ${r.sessionId}${r.agentId ? "/" + r.agentId : ""} page ${r.page} : ${Date.now() - t0} ms`);
      const nav = [r.page > 1 && `[← page précédente](${uriOf(r, r.page - 1)})`, hasNext && `[page suivante →](${uriOf(r, r.page + 1)})`].filter(Boolean).join(" · ");
      return `# Session ${r.sessionId} - page ${r.page}\n\n${nav}\n\n${markdown}\n\n${nav}\n`;
    } catch (e) {
      return `Erreur : ${(e as Error).message}\n`;
    }
  }

  provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      for (const m of doc.lineAt(i).text.matchAll(/\]\((claude-session:[^)\s]+)\)/g)) {
        const start = m.index + 2;
        links.push(new vscode.DocumentLink(new vscode.Range(i, start, i, start + m[1]!.length), vscode.Uri.parse(m[1]!)));
      }
    }
    return links;
  }
}

export async function openSession(uri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(doc, "markdown");
  await vscode.window.showTextDocument(doc, { preview: true });
}
