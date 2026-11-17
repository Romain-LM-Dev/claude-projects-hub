import * as vscode from "vscode";
import { join } from "node:path";
import { readAutoMemory } from "../core/automemory.ts";
import { adviseOrphan, IDLE_DAYS, relinkOrphan, type AdviceReason, type OrphanAction } from "../core/orphanAdvice.ts";
import { listTopics } from "../core/store.ts";
import type { SessionSummary } from "../core/transcript.ts";
import { sessionUri, type Hub, type Node } from "./tree.ts";

type Item = vscode.QuickPickItem & { run?: () => unknown };

const DAY = 86_400_000;
const mo = (b: number) => (b / 1048576).toFixed(1);

function adviceText(reason: AdviceReason, candidate = ""): string {
  switch (reason) {
    case "candidate": return vscode.l10n.t("A live project ({0}) looks like it: attach it to find sessions and memory in one place.", candidate);
    case "empty": return vscode.l10n.t("No session, no topic, no note: nothing to keep, ignore it.");
    case "keep": return vscode.l10n.t("It holds topics or auto-memory notes: delete nothing; point to its new folder or attach it to an existing project.");
    case "idle": return vscode.l10n.t("Idle for more than {0} days with no topic or note: its sessions can go to the trash.", IDLE_DAYS);
    case "recent": return vscode.l10n.t("Recent and without topics: if the folder was moved, point to its new folder; otherwise ignore the orphan.");
  }
}

/** `now` and `relink` are injectable: deterministic "N days ago", and test folders live under the excluded tmpdir. */
export function registerOrphanHelp(hub: Hub, refresh: () => void, { now = Date.now, relink: doRelink = relinkOrphan }: { now?: () => number; relink?: typeof relinkOrphan } = {}): vscode.Disposable[] {
  const exec = (id: string, ...a: unknown[]) => vscode.commands.executeCommand(`claudeProjectsHub.${id}`, ...a);
  const fail = (e: unknown) => void vscode.window.showErrorMessage(vscode.l10n.t("Claude Hub: {0}", (e as Error).message));

  async function relink(orphan: Extract<Node, { kind: "orphan" }>, notes: number) {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: vscode.l10n.t("Choose this folder"), title: vscode.l10n.t("New folder of {0}", orphan.name) });
    const dir = picked?.[0]?.fsPath;
    if (!dir) return;
    try {
      const r = await doRelink(hub.hubHome, orphan.id, dir, { log: hub.log });
      refresh();
      if (r.kind === "merged") {
        const undo = vscode.l10n.t("Undo");
        const c = await vscode.window.showInformationMessage(vscode.l10n.t("Project {0} attached to the project already in {1}.", orphan.name, dir), undo);
        if (c === undo) { await exec("undoMerge", [r.record]); return; }
      } else void vscode.window.showInformationMessage(vscode.l10n.t("Claude Hub: {0} is attached to {1}.", orphan.name, dir));
      const copy = vscode.l10n.t("Copy");
      if (notes && await vscode.window.showInformationMessage(vscode.l10n.t("Also copy the auto-memory?"), copy) === copy) {
        const p = { info: { cwd: dir, claudeDirs: [], sessions: [] }, id: orphan.id, name: orphan.name };
        await exec("copyAutoMemory", { kind: "project", p });
      }
    } catch (e) { fail(e); }
  }

  const help = async (n?: Node) => {
    if (n?.kind !== "orphan" && n?.kind !== "proposal") return;
    try {
      const id = n.kind === "orphan" ? n.id : n.pr.orphanId;
      const d = await hub.get();
      const entry = d.reg.projects[id];
      const name = entry?.name ?? (n.kind === "orphan" ? n.name : n.orphan);
      const claudeDirs = entry?.claudeDirs ?? (n.kind === "orphan" ? n.claudeDirs : []);
      const orphan: Extract<Node, { kind: "orphan" }> = { kind: "orphan", id, name, claudeDirs };
      const candidate = n.kind === "proposal" ? d.reg.projects[n.pr.candidateId]?.name ?? n.candidate : undefined;

      const sessions: SessionSummary[] = [...d.projects, ...(d.temp ?? [])].flatMap((p) => p.info.sessions).filter((s) => claudeDirs.includes(s.claudeDir));
      const last = sessions.reduce<SessionSummary | undefined>((a, s) => (!a || s.mtimeMs > a.mtimeMs ? s : a), undefined);
      const topics = (await listTopics({ hubHome: hub.hubHome, projectId: id }, "project")).filter((t) => t.valid).length;
      let notes = 0;
      for (const dir of claudeDirs) notes += (await readAutoMemory(join(hub.claudeHome, "projects", dir, "memory"))).notes.length;
      const daysIdle = last ? Math.max(0, Math.floor((now() - last.mtimeMs) / DAY)) : undefined;
      const remote = entry?.git?.remote;
      const former = entry?.formerPaths.at(-1) ?? entry?.paths[0];

      const advice = adviseOrphan({ candidate, sessions: sessions.length, topics, notes, daysIdle });
      const doAction: Record<OrphanAction, () => unknown> = {
        attachCandidate: () => exec("attachProject", n),
        dismiss: () => exec("dismissOrphan", n),
        relink: () => relink(orphan, notes),
        deleteSessions: () => exec("deleteSessions", orphan),
      };
      const label: Record<OrphanAction, string> = {
        relink: vscode.l10n.t("Point to its new folder…"),
        attachCandidate: vscode.l10n.t("Attach to {0}", candidate ?? ""),
        deleteSessions: vscode.l10n.t("Move its sessions to the trash…"),
        dismiss: vscode.l10n.t("Ignore this orphan"),
      };
      const act = (a: OrphanAction, detail: string): Item => ({ label: a === advice.action ? vscode.l10n.t("{0} (recommended)", label[a]) : label[a], detail, run: doAction[a] });
      const title = vscode.l10n.t("Orphan {0}: what to do?", name);
      const other = vscode.l10n.t("Other actions…");

      // Facts go in a modal: it wraps long paths and the advice, where quick pick items are cut to one line.
      const facts = [
        vscode.l10n.t("An orphan is a project whose folder no longer exists where it was known: moved, renamed or deleted. Its sessions and memory are kept."),
        "",
        vscode.l10n.t("Former folder: {0}", former ?? vscode.l10n.t("unknown")),
        !last ? vscode.l10n.t("Last activity: no session") : daysIdle ? vscode.l10n.t("Last activity: {0} day(s) ago", daysIdle) : vscode.l10n.t("Last activity: today"),
        vscode.l10n.t("Sessions: {0} ({1} MB)", sessions.length, mo(sessions.reduce((s, x) => s + x.sizeBytes, 0))),
        ...(last ? [vscode.l10n.t("Last session: {0}", last.title || last.sessionId)] : []),
        vscode.l10n.t("Project topics: {0}", topics),
        vscode.l10n.t("Auto-memory notes: {0}", notes),
        ...(remote ? [vscode.l10n.t("Git remote: {0}", remote)] : []),
        ...(candidate ? [vscode.l10n.t("Proposed candidate: {0}", candidate)] : []),
        "",
        vscode.l10n.t("Advice: {0}", adviceText(advice.reason, candidate)),
      ];
      const choice = await vscode.window.showInformationMessage(title, { modal: true, detail: facts.join("\n") }, label[advice.action], other);
      if (choice === label[advice.action]) return await doAction[advice.action]();
      if (choice !== other) return;

      // Details stay under ~70 characters so the quick pick shows them whole.
      const items: Item[] = [
        act("relink", vscode.l10n.t("Folder moved or renamed: it gets its sessions and memory back.")),
        candidate
          ? act("attachCandidate", vscode.l10n.t("The proposed project is the same project in its new folder."))
          : { label: vscode.l10n.t("Attach to an existing project…"), detail: vscode.l10n.t("It already lives under another name or folder known to the hub."), run: () => exec("attachProject", orphan) },
        ...(last ? [{ label: vscode.l10n.t("Open the last session"), detail: vscode.l10n.t("To reread what it was about before deciding."), run: () => exec("openSession", sessionUri(last)) }] : []),
        ...(notes ? [{ label: vscode.l10n.t("Copy the auto-memory…"), detail: vscode.l10n.t("Its Claude memory follows the project elsewhere; nothing is overwritten."), run: () => exec("copyAutoMemory", n) }] : []),
        act("deleteSessions", vscode.l10n.t("Abandoned project: conversations to the trash, recoverable.")),
        { label: vscode.l10n.t("Delete the orphan and all its content…"), detail: vscode.l10n.t("Sessions, topics, auto-memory and hub entry to the trash."), run: () => exec("deleteOrphan", orphan) },
        act("dismiss", vscode.l10n.t("Nothing to keep or recover: hidden, can still be attached by hand.")),
      ];
      const pick = await vscode.window.showQuickPick(items, { title });
      await pick?.run?.();
    } catch (e) { fail(e); }
  };

  return [vscode.commands.registerCommand("claudeProjectsHub.orphanHelp", help)];
}
