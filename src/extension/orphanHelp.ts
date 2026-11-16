import * as vscode from "vscode";
import { join } from "node:path";
import { readAutoMemory } from "../core/automemory.ts";
import { adviseOrphan, relinkOrphan, type OrphanAction } from "../core/orphanAdvice.ts";
import { listTopics } from "../core/store.ts";
import type { SessionSummary } from "../core/transcript.ts";
import { sessionUri, type Hub, type Node } from "./tree.ts";

type Item = vscode.QuickPickItem & { run?: () => unknown };

const DAY = 86_400_000;
const sep = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator });
const mo = (b: number) => (b / 1048576).toFixed(1);

/** `now` and `relink` are injectable: deterministic "il y a N jours", and test folders live under the excluded tmpdir. */
export function registerOrphanHelp(hub: Hub, refresh: () => void, { now = Date.now, relink: doRelink = relinkOrphan }: { now?: () => number; relink?: typeof relinkOrphan } = {}): vscode.Disposable[] {
  const exec = (id: string, ...a: unknown[]) => vscode.commands.executeCommand(`claudeProjectsHub.${id}`, ...a);
  const fail = (e: unknown) => void vscode.window.showErrorMessage(`Claude Hub : ${(e as Error).message}`);

  async function relink(orphan: Extract<Node, { kind: "orphan" }>, notes: number) {
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Choisir ce dossier", title: `Nouveau dossier de ${orphan.name}` });
    const dir = picked?.[0]?.fsPath;
    if (!dir) return;
    try {
      const r = await doRelink(hub.hubHome, orphan.id, dir, { log: hub.log });
      refresh();
      if (r.kind === "merged") {
        const c = await vscode.window.showInformationMessage(`Projet ${orphan.name} rattaché au projet déjà présent dans ${dir}.`, "Annuler");
        if (c === "Annuler") { await exec("undoMerge", [r.record]); return; }
      } else void vscode.window.showInformationMessage(`Claude Hub : ${orphan.name} est rattaché à ${dir}.`);
      if (notes && await vscode.window.showInformationMessage("Copier aussi l'auto-mémoire ?", "Copier") === "Copier") {
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
      const mark = (a: OrphanAction) => (a === advice.action ? " (conseillé)" : "");

      const items: Item[] = [
        sep("Ce que l'on sait"),
        { label: "Un orphelin est un projet dont le dossier n'existe plus à l'endroit connu : déplacé, renommé ou supprimé. Ses sessions et sa mémoire sont conservées." },
        { label: `Ancien dossier : ${former ?? "inconnu"}` },
        { label: last ? `Dernière activité : ${daysIdle ? `il y a ${daysIdle} jour(s)` : "aujourd'hui"}` : "Dernière activité : aucune session" },
        { label: `Sessions : ${sessions.length} (${mo(sessions.reduce((s, x) => s + x.sizeBytes, 0))} Mo)` },
        ...(last ? [{ label: `Dernière session : ${last.title || last.sessionId}`, description: "ouvrir", run: () => exec("openSession", sessionUri(last)) }] : []),
        { label: `Topics du projet : ${topics}` },
        { label: `Notes d'auto-mémoire : ${notes}` },
        ...(remote ? [{ label: `Remote git : ${remote}` }] : []),
        ...(candidate ? [{ label: `Candidat proposé : ${candidate}` }] : []),
        sep("Conseil"),
        { label: `$(lightbulb) ${advice.text}`, run: doAction[advice.action] },
        sep("Actions"),
        { label: `Indiquer son nouveau dossier…${mark("relink")}`, detail: "Le dossier a été déplacé ou renommé : on le désigne, l'orphelin y retrouve ses sessions et sa mémoire.", run: doAction.relink },
        candidate
          ? { label: `Rattacher à ${candidate}${mark("attachCandidate")}`, detail: "Le projet proposé est le même projet à son nouveau dossier.", run: doAction.attachCandidate }
          : { label: "Rattacher à un projet existant…", detail: "Le projet vit déjà sous un autre nom ou dans un autre dossier connu du hub.", run: () => exec("attachProject", orphan) },
        ...(last ? [{ label: "Ouvrir la dernière session", detail: "Pour relire de quoi il s'agissait avant de décider.", run: () => exec("openSession", sessionUri(last)) }] : []),
        ...(notes ? [{ label: "Copier l'auto-mémoire…", detail: "Le projet continue ailleurs et sa mémoire Claude doit le suivre ; rien n'est écrasé.", run: () => exec("copyAutoMemory", n) }] : []),
        { label: `Mettre ses sessions à la corbeille…${mark("deleteSessions")}`, detail: "Le projet est abandonné et ses conversations ne servent plus ; récupérables dans la corbeille.", run: doAction.deleteSessions },
        { label: "Supprimer l'orphelin et tout son contenu…", detail: "Rien à garder : sessions, topics, auto-mémoire et entrée du hub partent à la corbeille.", run: () => exec("deleteOrphan", orphan) },
        { label: `Ignorer cet orphelin${mark("dismiss")}`, detail: "Rien à garder ni à retrouver : il est masqué, et reste rattachable à la main.", run: doAction.dismiss },
      ];
      const pick = await vscode.window.showQuickPick(items, { title: `Orphelin ${name} : que faire ?` });
      await pick?.run?.();
    } catch (e) { fail(e); }
  };

  return [vscode.commands.registerCommand("claudeProjectsHub.orphanHelp", help)];
}
