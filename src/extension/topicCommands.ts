import * as vscode from "vscode";
import { isValidSlug, type Scope } from "../core/paths.ts";
import { writeTopic } from "../core/store.ts";
import { topicUri, type Hub, type Node } from "./tree.ts";

export interface TopicPreset { scope?: Scope; slug: string; title: string; summary: string }

const projectIdOf = (n?: Node) => (n?.kind === "memory" || n?.kind === "project" ? n.p.id : n?.kind === "topic" ? n.projectId : undefined);

/** Prompts for the missing fields; undefined = cancelled. */
async function ask(preset?: Partial<TopicPreset>, slugHint = ""): Promise<TopicPreset | undefined> {
  const slug = preset?.slug ?? await vscode.window.showInputBox({ title: vscode.l10n.t("Topic id"), value: slugHint, validateInput: (v) => (isValidSlug(v) ? undefined : vscode.l10n.t("lowercase letters, digits and hyphens")) });
  if (!slug) return;
  const title = preset?.title ?? await vscode.window.showInputBox({ title: vscode.l10n.t("Title"), value: slug });
  if (!title) return;
  const summary = preset?.summary ?? await vscode.window.showInputBox({ title: vscode.l10n.t("Summary (one line)"), value: title });
  if (!summary) return;
  return { slug, title, summary };
}

export function registerTopicCommands(hub: Hub, refresh: () => void): vscode.Disposable[] {
  const fail = (e: unknown) => void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0}", (e as Error).message));
  return [
    // Palette or global view: global topic; project or Mémoire node: topic of that project. `preset` skips the prompts (tests).
    vscode.commands.registerCommand("claudeProjectsHub.newTopic", async (n?: Node, preset?: TopicPreset) => {
      try {
        const projectId = projectIdOf(n);
        const scope: Scope = preset?.scope ?? (projectId ? "project" : "global");
        const t = await ask(preset);
        if (!t) return;
        const ref = `${scope}:${t.slug}`;
        await writeTopic({ hubHome: hub.hubHome, projectId }, ref, { title: t.title, summary: t.summary, body: "" });
        refresh();
        if (!preset) await vscode.commands.executeCommand("vscode.open", topicUri(hub, ref, projectId));
      } catch (e) { fail(e); }
    }),
    vscode.commands.registerCommand("claudeProjectsHub.deleteTopic", async (n?: Node) => {
      if (n?.kind !== "topic") return;
      const del = vscode.l10n.t("Delete");
      const ok = await vscode.window.showWarningMessage(vscode.l10n.t("Delete topic {0}?", n.entry.ref), { modal: true }, del);
      if (ok !== del) return;
      try {
        await vscode.workspace.fs.delete(topicUri(hub, n.entry.ref, n.projectId), { useTrash: true });
      } catch (e) { fail(e); }
      refresh();
    }),
    vscode.commands.registerCommand("claudeProjectsHub.importTopic", async (n?: Node) => {
      if (n?.kind !== "note") return;
      try {
        const pick = await vscode.window.showQuickPick(
          [...(n.p.id ? [{ label: vscode.l10n.t("Project topic"), scope: "project" as Scope }] : []), { label: vscode.l10n.t("Global topic"), scope: "global" as Scope }],
          { title: vscode.l10n.t("Import as topic") },
        );
        if (!pick) return;
        const name = n.note.name ?? "";
        const slugHint = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
        const t = await ask({ title: name || undefined, summary: n.note.description }, slugHint);
        if (!t) return;
        await writeTopic({ hubHome: hub.hubHome, projectId: n.p.id }, `${pick.scope}:${t.slug}`, { title: t.title, summary: t.summary, body: n.note.body, importedFrom: n.note.file });
        refresh();
      } catch (e) { fail(e); }
    }),
  ];
}
