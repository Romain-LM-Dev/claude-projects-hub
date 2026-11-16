# Journal des modifications

## 0.5.0 - 2026-11-16

- Ajouté : commande « Supprimer le projet… » (menu d'un projet enregistré) : comme pour un orphelin, plus le fichier marqueur `.claude/projects-hub.json` ; le dossier du projet n'est jamais supprimé. Un dossier Claude listé par une autre entrée du registre n'est pas touché.
- Modifié : « Supprimer l'orphelin… » et « Supprimer le projet… » demandent une double confirmation (récapitulatif, puis saisie du nom exact du projet) ; refus avant toute question si une session est ouverte (ADR 0007).

## 0.4.0 - 2026-11-16

- Ajouté : commande « Supprimer l'orphelin… » (menu de l'orphelin et aide « Que faire de cet orphelin ? ») : sessions, dossier Claude (auto-mémoire comprise) et topics mis à la corbeille après confirmation, puis entrée du registre retirée ; l'entrée reste si un élément n'a pas pu partir (ADR 0007).

## 0.3.0 - 2026-11-16

- Ajouté : aide « Que faire de cet orphelin ? » (clic sur un orphelin, ou menu d'un orphelin ou d'une proposition) : ce que l'on sait (ancien dossier, sessions, topics, notes, remote git, candidat), un conseil et les actions possibles.
- Ajouté : action « Indiquer son nouveau dossier… » pour un projet déplacé : le dossier choisi est rattaché à l'orphelin (ou fusionné, annulable, s'il appartient déjà à un projet) ; copie de l'auto-mémoire proposée ensuite.

## 0.2.0 - 2026-11-11

- Ajouté : commande « Supprimer la session… » (sélection multiple, projet ou orphelin) : fichiers de la session mis à la corbeille après confirmation, jamais une session ouverte (ADR 0007).

## 0.1.0 - 2026-11-11

Première version fonctionnelle (extension et plugin), après la revue finale T11 (`docs/recette-t11.md`).

### Ajouté
- Serveur MCP `hub` : `memory_list`, `memory_read`, `memory_write`, `memory_append`.
- Hook SessionStart : injection de l'index des topics (4 000 caractères au plus).
- Magasin de topics en Markdown dans `~/.claude-projects-hub` (topics de projet et globaux), écritures verrouillées.
- Identité de projet : marqueur local `.claude/projects-hub.json`, registre, rapprochement au scan, rattachement des
  orphelins, annulation d'une fusion automatique.
- Vues VS Code « Projets » et « Mémoire globale », et 18 commandes « Claude Hub » (voir README).
- Installation et retrait du plugin `projects-hub` (marketplace `projects-hub-local`) par commande.
- Réglage `claudeProjectsHub.showTemporaryProjects`.
- Refus d'écriture d'un topic contenant un format de secret connu.

### Reporté
Voir la section « Reporté » du README (architecture §13).
