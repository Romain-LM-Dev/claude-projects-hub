# 0004 - Lecture des données Claude : JSONL en tête et queue, pas d'Agent SDK

Statut : acceptée (2026-11-06)

## Contexte
540 Mo de transcripts, fichiers jusqu'à 84 Mo, format officiellement interne et changeant. La liste doit être
rapide ; le détail d'une session est demandé rarement. L'Agent SDK expose `listSessions()`,
`getSessionInfo()`, `getSessionMessages()`, lisant les mêmes fichiers.

## Options
1. Agent SDK : API documentée qui suit le format. Mais : gros paquet qui embarque le CLI (taille du `.vsix`),
   version à aligner sur le Claude Code installé, et il ne rend pas tout ce qu'il faut (coût `cost-state`,
   métadonnées des sous-agents, auto-mémoire, sessions ouvertes) : il faudrait lire les fichiers quand même.
2. Lecture complète en flux de chaque fichier : simple, mais ~540 Mo lus à chaque scan à froid.
3. **Lecteur maison : tête (64 Kio, jusqu'au cwd) + queue (256 Kio) pour la liste, flux complet seulement pour le
   document de session, cache par taille et `mtime`.**

## Décision
Option 3, contrat dans architecture §8. Lecture tolérante : ligne illisible ou type inconnu comptés et ignorés,
champs absents = indéfinis. Une sonde `npm run probe` parcourt le vrai `CLAUDE_HOME` en lecture seule et sort
l'histogramme des types, les erreurs et les temps ; des fixtures synthétiques couvrent les cas connus.

## Conséquences
- Scan à froid estimé à ~12 Mo lus au lieu de 540 Mo ; cible < 2 s (architecture §11).
- Un titre qui n'apparaît qu'au milieu d'un long transcript n'est pas vu (repli sur le dernier prompt) : accepté.
- Un changement de format Claude Code casse au pire l'affichage, jamais les données ; la sonde le révèle. Repli
  sur l'Agent SDK reporté, à rouvrir si le format casse deux fois.
