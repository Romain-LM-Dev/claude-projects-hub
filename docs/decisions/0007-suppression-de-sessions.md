# 0007 - Suppression de sessions

Statut : acceptée (2026-11-11)

## Contexte
L'utilisateur veut supprimer complètement des sessions Claude dont il n'a plus besoin, en particulier celles des
projets orphelins. Jusqu'ici `CLAUDE_HOME` était en lecture seule (sauf la copie d'auto-mémoire, §7.5). Relevé sur
le poste (Claude Code 2.1.317), une session `<id>` laisse : `projects/<claudeDir>/<id>.jsonl` (transcript),
`projects/<claudeDir>/<id>/` (sous-agents, résultats d'outils), `file-history/<id>/` (points de retour arrière),
`session-env/<id>/`, et une file de télémétrie `telemetry/*.<id>.*.json`.

## Options
1. Suppression définitive des fichiers : irréversible, une erreur de sélection détruit un historique.
2. **Mise à la corbeille du système** (`vscode.workspace.fs.delete`, `useTrash: true`) : la session disparaît de
   Claude Code (`/resume`, vues) et reste récupérable depuis la corbeille.
3. Archivage dans `HUB_HOME` : un deuxième magasin de transcripts à tenir ; reporté (§13).

## Décision
Option 2, par la commande « Supprimer la session… » :
- Cibles : un ou plusieurs nœuds session (sélection multiple dans la vue Projets), ou toutes les sessions d'un
  projet ou d'un orphelin (même commande sur son nœud).
- Fichiers mis à la corbeille, s'ils existent : `projects/<claudeDir>/<id>.jsonl`, `projects/<claudeDir>/<id>/`,
  `file-history/<id>/`, `session-env/<id>/`. Jamais touchés : la télémétrie, `history.jsonl`, `~/.claude.json`,
  l'auto-mémoire du projet (partagée par toutes ses sessions), les topics de `HUB_HOME`, le registre.
- Garde-fous : `id` au format UUID et `claudeDir` d'un seul segment (ni séparateur ni `..`), chaque chemin résolu
  doit rester sous `CLAUDE_HOME` ; session vivante (`sessions/<pid>.json` de cet id avec pid vivant) refusée ;
  confirmation modale obligatoire avec le nombre de sessions et la taille totale ; si la corbeille est indisponible,
  erreur affichée et AUCUNE suppression définitive de repli.
- Le noyau fournit la liste des chemins (`sessionFiles`) et le contrôle de vie ; l'extension met à la corbeille,
  puis rafraîchit (le cache de scan ignore les fichiers disparus).

## Amendement du 2026-11-16 : « Supprimer l'orphelin… »
Supprimer les sessions d'un orphelin le laissait affiché : son entrée du registre, ses topics et son auto-mémoire
restaient. Commande sur un nœud orphelin (et dans l'aide de l'orphelin) qui retire TOUT l'orphelin :
- mis à la corbeille : les fichiers de chacune de ses sessions (`sessionFiles`), chacun de ses dossiers Claude
  `projects/<claudeDir>/` (auto-mémoire comprise ; `claudeDir` d'un seul segment, confiné sous `CLAUDE_HOME`), et son
  dossier de topics `HUB_HOME/projects/<id>/` ;
- puis son entrée retirée du registre (sous verrou), et son id retiré des `dismissed` des autres entrées.
- Refus si l'entrée a un chemin vivant (ce n'est plus un orphelin) ou si une de ses sessions est ouverte.
- Un dossier Claude que liste aussi un projet vivant (ancien chemin recréé) n'est jamais touché, ni les sessions
  qu'il contient : il appartient désormais à ce projet.
- Confirmation modale avec le nombre de sessions, de topics et de notes d'auto-mémoire, et la taille ; corbeille
  indisponible ou échec d'un chemin → l'entrée du registre n'est PAS retirée (rien d'orphelin dans le registre ne
  pointe vers des fichiers à moitié supprimés), message, aucune suppression définitive de repli.

## Conséquences
- `CLAUDE_HOME` n'est plus en lecture seule : deuxième exception après §7.5, toujours sur action confirmée.
- Un projet ou un orphelin peut rester sans session ; « Ignorer l'orphelin » le masque.
- Restauration : depuis la corbeille, en remettant les dossiers à leur place ; aucune commande dédiée en v1.
