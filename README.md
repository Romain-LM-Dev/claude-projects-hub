<div align="center">

🇫🇷 Français | 🇬🇧 [English](README.en.md)

</div>

# Projects Hub for Claude Code

Extension VS Code et plugin Claude Code (paquet `claude-projects-hub`, publisher `romain-lm-dev`). Elle liste les
projets et les sessions Claude Code du poste et fournit une mémoire par topics, partagée entre les sessions d'un
projet et entre les projets, que Claude lit et écrit par un serveur MCP `hub` et un hook SessionStart.

## État du projet

Version 0.2.0 (extension et plugin). Licence source-available non commerciale ([LICENSE.md](LICENSE.md)). Voir
[CHANGELOG.md](CHANGELOG.md). Point de reprise : `docs/reprise.md`. English: [README.en.md](README.en.md).

## Fonctionnalités

- **Projets et sessions** : tous les projets Claude Code du poste et leurs sessions (CLI et extension officielle
  confondues), sessions en cours et sous-agents compris.
- **Mémoire par topics** : topics d'un projet et topics globaux, en fichiers Markdown dans `~/.claude-projects-hub`,
  lisibles et modifiables par l'utilisateur.
- **Outils MCP** `memory_list`, `memory_read`, `memory_write` et `memory_append`, utilisés par Claude en session.
- **Hook SessionStart** : injecte l'index des topics au début de chaque session (4 000 caractères au plus). Les dates
  des lignes d'index sont en date locale.
- **Identité de projet** : la mémoire suit le projet quand son dossier est déplacé ou renommé ; les transcripts et
  l'auto-mémoire Claude orphelins sont rattachés.
- **Vues VS Code** : conteneur « Claude Hub » avec les vues « Projets » et « Mémoire globale ».

## Prérequis

| Élément | Version |
|---|---|
| VS Code | `^1.100.0` (`engines.vscode`) |
| Node.js | 20 ou plus, sur le PATH (hook et serveur MCP) ; développement avec Node 24 |
| Claude Code | 2.1.223 ou plus (CLI ou extension officielle) |

## Installation

1. Construire le paquet : `npm install`, `npm run build`, puis `npm run package` (produit un `.vsix`).
2. Installer le `.vsix` dans VS Code : `code --install-extension <fichier>.vsix`.
3. Lancer la commande « Claude Hub: Installer l'intégration Claude ». Elle vérifie Node, copie le plugin vers
   `~/.claude-projects-hub/marketplace`, puis exécute `claude plugin marketplace add` et `claude plugin install`
   (plugin `projects-hub`, marketplace `projects-hub-local`).
4. Si `claude` n'est pas sur le PATH, la commande affiche à la place deux commandes `/plugin …` à taper dans
   Claude Code.
5. « Claude Hub: Retirer l'intégration » désinstalle le plugin.

Après une mise à jour de l'extension, relancer « Installer l'intégration Claude » recopie le plugin.

### Règle de permission

Sans règle, Claude demande une permission à chaque appel d'outil MCP. Les outils s'appellent
`mcp__plugin_projects-hub_hub__memory_list`, `…_memory_read`, `…_memory_write` et `…_memory_append`. La règle
`mcp__plugin_projects-hub_hub` les autorise tous.

- Sur le poste du développeur, elle est déjà dans `~/.claude/settings.json`.
- Ailleurs, ajoutez-la vous-même dans `permissions.allow` :

```json
{
  "permissions": {
    "allow": ["mcp__plugin_projects-hub_hub"]
  }
}
```

L'extension ne modifie jamais ce fichier.

## Commandes

Toutes sont de catégorie « Claude Hub ». « Rattacher à un projet… », « Détacher ce dossier », « Ignorer ce candidat »,
« Ignorer l'orphelin », « Copier l'auto-mémoire » et « Supprimer la session… » n'existent que dans les menus contextuels des vues, pas dans la
palette de commandes.

| Commande | Rôle |
|---|---|
| Rafraîchir | relit projets, sessions et topics |
| Nouveau topic | crée un topic de projet ou global |
| Supprimer le topic | envoie le fichier du topic à la corbeille |
| Importer en topic | transforme un souvenir d'auto-mémoire en topic |
| Reprendre dans Claude | rouvre la session dans l'extension Claude |
| Reprendre dans un terminal | `claude --resume <id>` dans le dossier du projet |
| Ouvrir le dossier | ouvre le dossier du projet |
| Rattacher à un projet… | réunit un orphelin, un candidat ou un clone à un autre projet ; topics déplacés, slug en conflit suffixé |
| Détacher ce dossier | donne au dossier une identité neuve ; les topics restent au projet d'origine |
| Ignorer ce candidat | refuse un rattachement proposé |
| Ignorer l'orphelin | masque l'orphelin ; il reste rattachable à la main |
| Annuler le dernier rattachement | défait les fusions automatiques du dernier scan ; elles ne sont pas refaites au scan suivant |
| Copier l'auto-mémoire | copie, après confirmation, l'auto-mémoire Claude vers le nouveau dossier ; rien n'est écrasé |
| Supprimer la session… | met à la corbeille, après confirmation, les fichiers des sessions sélectionnées (ou d'un projet / orphelin) ; jamais une session ouverte |
| Rafraîchir les empreintes | recalcule les empreintes git des projets |
| Aperçu de l'injection | montre le texte que le hook injecte pour ce projet |
| Installer l'intégration Claude | installe le plugin (voir Installation) |
| Retirer l'intégration | désinstalle le plugin |
| Diagnostic | canal de sortie : lignes illisibles, types inconnus, fin des journaux |

Réglage : `claudeProjectsHub.showTemporaryProjects` (défaut `false`) affiche le nœud « Temporaires » (sessions des
dossiers exclus).

## Marqueur de projet

À la première session Claude dans un dossier, le hook pose `.claude/projects-hub.json` (un identifiant) à la racine
du projet.

| Règle | Détail |
|---|---|
| Local | jamais versionné : dans un dépôt git, la ligne `/.claude/projects-hub.json` est ajoutée à `.git/info/exclude`, jamais à un `.gitignore` |
| Absent | des dossiers temporaires, du dossier personnel, d'une racine de lecteur, de `~/.claude` et de `~/.claude-projects-hub` : seuls les topics globaux y sont injectés |
| Clones et worktrees | projets séparés, chacun avec son identité, sauf si vous les réunissez par « Rattacher à un projet… » |
| Copie du dossier | une copie avec son marqueur partage l'identité du projet |

## Emplacements

| Nom | Défaut | Variable |
|---|---|---|
| `HUB_HOME` | `~/.claude-projects-hub` | `CLAUDE_PROJECTS_HUB_HOME` |
| `CLAUDE_HOME` | `~/.claude` | `CLAUDE_CONFIG_DIR` |

`CLAUDE_HOME` est lu seulement, sauf la copie d'auto-mémoire que vous confirmez.

## Confidentialité

- Rien ne quitte le poste ; aucun appel réseau.
- **Les topics globaux sont injectés dans tous les projets** : une information d'un client peut atteindre un autre
  projet. N'y mettez rien de confidentiel. Ils sont visibles et modifiables dans la vue « Mémoire globale ».
- Avant toute écriture de topic, quelques formats de secrets sont refusés (clés privées, clés Anthropic, jetons
  GitHub, clés AWS, jetons Slack). La liste est fermée et ne détecte pas tout.

## Reporté (hors v1)

Injection dans les sous-agents ; rappel par UserPromptSubmit ; outil de suppression pour Claude ; recherche plein
texte dans les transcripts ; tableau de bord en webview ; archivage des transcripts avant leur purge par Claude Code ;
déplacement des transcripts orphelins ; repli sur l'Agent SDK si le format JSONL change ; synchronisation de la
mémoire entre postes ; Node fourni par VS Code quand Node manque ; règle de permission posée par l'extension ;
CI GitHub Actions ; publication sur la Marketplace.

## Développement

```powershell
npm install
npm run typecheck
npm run build
npm test
```

| Script | Rôle |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild : `dist/extension.js`, `claude-plugin/projects-hub/dist/hook.js`, `claude-plugin/projects-hub/dist/mcp.js` |
| `npm test` | `node --test "src/**/*.test.ts"` |
| `npm run test:ext` | tests de l'extension dans un hôte VS Code |
| `npm run probe` | sonde en lecture seule du vrai `CLAUDE_HOME` |
| `npm run package` | fichier `.vsix` (`vsce package --no-dependencies --skip-license`) |

## Architecture

Un noyau Node pur (`src/core/`) est partagé par trois exécutables : l'extension VS Code (`src/extension/`), le hook
SessionStart (`src/hook/`) et le serveur MCP stdio (`src/mcp/`). Le hook et le serveur MCP sont livrés sous forme de
plugin Claude Code (`projects-hub`) servi par une marketplace locale.

- Contrats : [docs/architecture.md](docs/architecture.md)
- Décisions : [docs/decisions/](docs/decisions/)
- Plan d'exécution : [docs/plan.md](docs/plan.md)

## Licence

Licence source-available non commerciale : voir [LICENSE.md](LICENSE.md). Usage commercial sur autorisation écrite
du titulaire.
