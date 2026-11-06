# 0003 - Identité de projet et relocalisation

Statut : acceptée (2026-11-06), révisée le 2026-11-06 sur décision de l'utilisateur : marqueur posé dès la première
session et jamais versionné (remplace « écrit au premier topic projet, versionné au choix »).

## Contexte
Claude Code identifie un projet par son chemin encodé (irréversible, casse du lecteur variable, troncature au-delà
de 200 caractères). Un dossier déplacé ou renommé repart d'un nouveau dossier `projects/<dir>` vide : transcripts
et auto-mémoire restent attachés à l'ancien chemin. L'utilisateur exige que les topics, et si possible ces données
Claude, restent au bon projet.

## Options
1. Chemin seul : perd tout au premier déplacement.
2. Empreinte git seule (commit racine + remote) : rien pour les dossiers sans git ; deux clones indiscernables ;
   l'empreinte d'un dossier disparu n'est connue que si elle a été relevée avant.
3. Marqueur dans le projet seul : certain, mais suppose d'écrire dans chaque projet, même ceux sans topic.
4. Marqueur écrit au premier topic projet + registre central (chemins, dossiers Claude, empreinte git relevée
   au scan) + rapprochement certain ou proposé (version initiale de cette décision).
5. **Comme 4, mais marqueur posé par le hook SessionStart dès la première session, non versionné (exclusion
   locale `info/exclude` du dépôt).**

## Décision
Option 5, algorithme complet dans architecture §7 :
- Un projet = un UUID ; il peut avoir plusieurs chemins vivants qui partagent sa mémoire : copies du dossier
  (le marqueur les suit), clones et worktrees réunis à la main ; « Détacher ce dossier » sépare un chemin.
- Le hook appelle `ensureProject` à chaque session : marqueur, ligne `/.claude/projects-hub.json` dans
  `info/exclude` du dépôt et entrée du registre, seulement s'ils manquent ; sans git, verrou attendu 500 ms au plus,
  tout échec journalisé sans gêner la session. Jamais dans un dossier exclu (temporaire, scratchpad de Claude,
  dossier personnel, racine de lecteur, `CLAUDE_HOME`, `HUB_HOME`). Le MCP refait la même chose avant une
  écriture `project:` si le hook a échoué.
- Pas de `.gitignore` : `info/exclude` est local, ne modifie aucun fichier suivi et ne peut pas être poussé.
- Résolution en session (hook, MCP) sans lancer git : marqueur (dossier puis parents jusqu'au dépôt), puis chemin
  du registre.
- Scan de l'extension : le marqueur l'emporte ; chemins disparus → `formerPaths` ; projet sans chemin vivant =
  orphelin ; dossier Claude dont le cwd a disparu = orphelin aussi.
- Rattachement automatique seulement si certain : commits racine communs, même remote, un seul candidat, candidat
  sans topic ; avec copie du registre et bouton Annuler. Sinon proposition (même commit racine, ou même nom de
  dossier), ou rattachement manuel. Rien n'est jamais écrasé ni supprimé.
- Données Claude rattachées : transcripts affichés sous le bon projet sans être déplacés ; copie de l'auto-mémoire
  vers le nouveau dossier Claude sur confirmation, sans écrasement.

## Conséquences
- Tout projet ouvert dans une session depuis l'installation suit son dossier avec certitude (le marqueur voyage
  avec lui), y compris pour le hook avant tout scan, qu'il ait des topics ou non.
- Un fichier `.claude/projects-hub.json` apparaît dans chaque projet ouvert avec Claude, invisible pour git ; un
  dossier en lecture seule n'en a pas et reste résolu par son chemin.
- Les clones ne partagent plus l'identité : chaque clone ou worktree reçoit la sienne à sa première session ;
  l'empreinte git (commit racine, remote) reste le seul moyen de rapprochement, réservé aux orphelins (règle
  « certain » inchangée : le candidat créé par le hook n'a pas de topic) ; réunir deux clones vivants est manuel.
- Un projet sans marqueur (connu du seul scan, ou marqueur supprimé) déplacé sans git ne peut être que proposé
  (nom du dossier).
- Le hook écrit désormais dans les projets et le registre : budget de 150 ms à tenir aussi à la première session.
- La reprise d'une session orpheline depuis le nouveau dossier repose sur la recherche inter-dossiers de
  `claude --resume` (Claude Code ≥ 2.1.223), à vérifier en T9.
