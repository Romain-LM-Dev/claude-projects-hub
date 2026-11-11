# Journal des modifications

## 0.1.0 - 2026-11-11

Première version fonctionnelle (version du plugin ; `package.json` porte encore `0.0.1`).

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
