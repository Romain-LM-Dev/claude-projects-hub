# Journal des modifications

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
