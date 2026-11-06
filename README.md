<div align="center">

🇫🇷 Français | 🇬🇧 [English](README.en.md)

</div>

# Projects Hub for Claude Code

Extension VS Code et plugin Claude Code (paquet `claude-projects-hub`, publisher `romain-lm-dev`). Elle liste les
projets et les sessions Claude Code du poste et fournit une mémoire par topics, partagée entre les sessions d'un
projet et entre les projets, que Claude lit et écrit par un serveur MCP `hub` et un hook SessionStart.

## État du projet

Version `0.0.1`, en développement. La conception est faite (`docs/architecture.md`, ADR 0001 à 0006, `docs/plan.md`)
et seul le socle du dépôt (tâche T0) est en place : l'activation de l'extension (`src/extension/extension.ts`) est
vide et `package.json` ne déclare encore aucune commande ni aucun réglage. Point de reprise : `docs/reprise.md`.

## Fonctionnalités prévues (v1)

Décrites dans `docs/architecture.md`, pas encore implémentées :

- **Projets et sessions** : lister dans VS Code tous les projets Claude Code du poste et leurs sessions (CLI et
  extension officielle confondues), y compris les sessions en cours et les sous-agents.
- **Mémoire par topics** : topics d'un projet et topics globaux, stockés en simples fichiers Markdown dans
  `~/.claude-projects-hub`, lisibles et modifiables par l'utilisateur.
- **Outils MCP** `memory_list`, `memory_read`, `memory_write` et `memory_append`, utilisés par Claude pendant les
  sessions.
- **Hook SessionStart** : injecte l'index des topics au début de chaque session (4 000 caractères au plus).
- **Identité de projet** : la mémoire reste attachée au bon projet quand son dossier est déplacé ou renommé, et les
  transcripts et l'auto-mémoire Claude devenus orphelins sont rattachés.
- **Vues VS Code** : conteneur « Claude Hub » avec les vues « Projets » et « Mémoire globale ».
- **Confidentialité** : rien ne quitte le poste, aucun appel réseau ; détection de quelques formats de secrets
  avant toute écriture de topic.

## Prérequis

- VS Code `^1.100.0` (champ `engines.vscode` de `package.json`).
- Node.js 20 ou plus sur le PATH pour le hook et le serveur MCP ; le développement se fait avec Node 24
  (`node --test` sur les fichiers `.ts`).
- Claude Code (CLI ou extension officielle).

## Installation et compilation

```powershell
npm install
npm run typecheck
npm run build
npm test
```

| Script | Rôle |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild : `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` (entrée absente sautée) |
| `npm test` | `node --test "src/**/*.test.ts"` |
| `npm run test:ext` | tests de l'extension dans un hôte VS Code |
| `npm run probe` | sonde en lecture seule du vrai `CLAUDE_HOME` |
| `npm run package` | fichier `.vsix` (`vsce package --no-dependencies --skip-license`) |

Les fichiers d'entrée de `test:ext` (`test/extension/run.ts`) et de `probe` (`scripts/probe.ts`) ne sont pas encore
écrits.

## Utilisation

Aucune commande ni aucun réglage n'est encore déclaré dans `package.json`. Les commandes prévues (Rafraîchir, Nouveau
topic, Installer l'intégration Claude, Aperçu de l'injection, etc.) et le réglage
`claudeProjectsHub.showTemporaryProjects` sont décrits aux §9 et §10 de `docs/architecture.md`.

## Architecture

Un noyau Node pur (`src/core/`) est partagé par trois exécutables : l'extension VS Code (`src/extension/`), le hook
SessionStart (`src/hook/`) et le serveur MCP stdio (`src/mcp/`). Le hook et le serveur MCP sont livrés sous forme de
plugin Claude Code (`projects-hub`) servi par une marketplace locale.

- Contrats : [docs/architecture.md](docs/architecture.md)
- Décisions : [docs/decisions/](docs/decisions/)
- Plan d'exécution : [docs/plan.md](docs/plan.md)
