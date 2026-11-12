---
name: tests-avant-commit
description: Lancer la suite ciblée avant chaque commit — la CI coûte dix minutes, un test local dix secondes
metadata:
  type: feedback
---

Avant chaque commit, lancer les tests du paquet touché (`pnpm --filter <paquet> test`).

**Why:** la CI met dix minutes à dire ce qu’un test local dit en dix secondes.
**How to apply:** toujours, sauf pour un changement de documentation seule. Voir [[prix-en-centimes]].
