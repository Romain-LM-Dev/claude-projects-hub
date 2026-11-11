# 0005 - Injection et écriture de la mémoire par Claude

Statut : acceptée (2026-11-06)

## Contexte
Claude doit savoir, dès le début de chaque session, quels topics existent, sans payer leur contenu en contexte, et
pouvoir les lire et les écrire. Leviers documentés : hooks (SessionStart, UserPromptSubmit, SubagentStart :
`additionalContext`, 10 000 caractères max par champ), serveurs MCP, skills.

## Options
1. Injecter le contenu complet des topics : simple, mais coûteux à chaque session et borné à 10 000 caractères.
2. **SessionStart injecte un index court (titre + résumé) ; lecture et écriture par outils MCP.** Même modèle que
   l'auto-mémoire (index chargé, détail à la demande).
3. UserPromptSubmit à chaque message : rappel permanent, coût multiplié par le nombre de messages.
4. Skill seule : chargée selon sa description, sans garantie que Claude connaisse les topics existants.
5. Écriture par Claude avec ses outils Edit/Write dans `HUB_HOME` : pas de verrou, pas de contrôle de révision, ni
   de garde-fou de secrets ; demande des permissions de fichiers hors projet.

## Décision
Option 2, contrats dans architecture §5 et §6 :
- Hook SessionStart sans matcher (y compris `compact` : réinjection après compactage), budget 4 000 caractères,
  en-tête toujours présent, topics du projet puis globaux par date, pied de page des omis, aucun processus lancé,
  silencieux en cas d'erreur.
- Quatre outils MCP : `memory_list`, `memory_read`, `memory_write` (création, ou remplacement avec
  `baseRevision`), `memory_append` (ajout daté sans conflit). Pas de suppression par Claude.
- Pas de skill, pas d'UserPromptSubmit : l'en-tête et les descriptions d'outils portent les consignes.

## Conséquences
- Coût fixe ≈ 450 caractères par session sans topic, 4 000 au plus.
- Les sous-agents ne reçoivent pas l'index (SubagentStart reporté, à évaluer après mesure du coût) ; ils peuvent
  appeler les outils si leurs permissions le permettent.
- Chaque appel d'outil demande une permission tant que la règle `mcp__plugin_projects-hub_hub` (préfixe relevé en
  T6) n'est pas dans `permissions.allow` de `~/.claude/settings.json` : sur ce poste, ajoutée après T6 par l'agent
  global de configuration (config-claude) ; ailleurs, par l'utilisateur (README) ; jamais par l'extension ni par
  l'équipe du projet (amendement du 2026-11-11, aligné sur architecture §9).
- La qualité de ce que Claude écrit dépend des consignes ; à juger sur sessions réelles (essai T6, puis usage).
