# 0001 - Stack et empaquetage

Statut : acceptée (2026-11-06)

## Contexte
Trois exécutables : une extension VS Code (obligatoirement JS/TS), un hook SessionStart et un serveur MCP stdio
lancés par Claude Code, en CLI comme dans l'extension officielle. Poste : Windows 11, Node 24, VS Code 1.145.
L'extension officielle n'offre aucune API aux autres extensions. Les trois exécutables partagent la même logique
(magasin, registre, identité).

## Options
1. L'extension écrit elle-même le hook dans `~/.claude/settings.json` et déclare le MCP par
   `claude mcp add --scope user`. Fusion JSON dans un fichier de l'utilisateur, désinstallation manuelle, deux
   mécanismes à tenir.
2. **Plugin Claude Code** (`hooks/hooks.json` + `.mcp.json`) servi par une marketplace locale copiée dans
   `HUB_HOME/marketplace` : une unité activable, désinstallable, lue en place (pas de cache figé par version),
   `${CLAUDE_PLUGIN_ROOT}` et `CLAUDE_PROJECT_DIR` fournis par Claude Code.
3. Hook et MCP en Python : deuxième langage, deuxième chaîne de tests, aucun partage de code avec l'extension.

## Décision
Option 2, en TypeScript dans un seul paquet npm :
- `src/core` (Node pur) importé par `src/extension`, `src/hook`, `src/mcp` ; trois bundles esbuild autonomes.
- Plugin nommé `projects-hub` (préfixe `claude-` réservé par Claude Code), marketplace `projects-hub-local`.
- Hook et MCP lancés par `node` du PATH (Node ≥ 20, vérifié par la commande d'installation).
- Tests : `node --test` sur les `.ts` (suppression des types native de Node 24, `erasableSyntaxOnly`), plus un test
  d'activation dans un hôte VS Code.

Dépendances (chacune justifiée) :
| Paquet | Type | Raison |
|---|---|---|
| `@modelcontextprotocol/sdk` | exécution, embarqué dans le bundle | protocole MCP officiel (négociation de version, schémas) ; le refaire à la main serait fragile |
| `typescript` | dev | vérification de types (`tsc --noEmit`) |
| `esbuild` | dev | trois bundles autonomes, aucun `node_modules` à l'exécution |
| `@types/node`, `@types/vscode` | dev | types |
| `@vscode/vsce` | dev | fabrication du `.vsix` (`--skip-license` retiré le 2026-11-11 : licence `LICENSE.md` ajoutée) |
| `@vscode/test-electron` | dev | un test d'activation réel de l'extension (télécharge VS Code une fois dans `.vscode-test/`) |
Aucun analyseur YAML : le frontmatter est un sous-ensemble strict défini par nous (architecture §4.2).

## Conséquences
- Node doit être sur le PATH pour le hook et le MCP (repli par le Node de VS Code reporté).
- Une mise à jour de l'extension recopie le plugin ; les sessions déjà ouvertes gardent l'ancien code jusqu'au
  redémarrage.
- Le préfixe des outils MCP (`mcp__plugin_projects-hub_hub__`) est à confirmer sur une vraie session (étape T6).
- `engines.vscode` : `^1.100.0`.

## Amendement du 2026-11-11
- Versions : cet ADR choisit les paquets, pas leurs versions ; `package.json` et `package-lock.json` les fixent.
  `typescript ^7.0.2` et `@types/node ^26.6.6` (posés en T0) sont entérinés. Les types de Node 26 ne protègent pas
  le minimum d'exécution (Node ≥ 20, cible esbuild `node20`) : `src/core`, `src/hook` et `src/mcp` n'emploient
  aucune API Node postérieure à Node 20 ; contrôle par relecture (qa-reviewer, T11).
- Type de module : pas de `"type": "module"` dans `package.json` (les trois bundles restent en CJS `.js`, chemins
  §2, §6.1, §9 inchangés) ; l'avertissement `MODULE_TYPELESS_PACKAGE_JSON` est neutralisé par
  `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` dans les scripts `test` et `probe`. Rejeté : bundles en `.cjs`
  avec `"type": "module"` (renomme trois sorties et leurs références dans le plugin, l'extension et les docs, pour
  un simple avertissement) ; accepter l'avertissement (bruit à chaque test).
