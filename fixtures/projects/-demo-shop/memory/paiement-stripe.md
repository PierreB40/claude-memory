---
name: paiement-stripe
description: Webhooks Stripe idempotents — une clé par événement, rejouer ne paie jamais deux fois
metadata:
  type: project
---

Les webhooks passent par `apps/api/src/webhooks/stripe.ts`. Chaque événement est enregistré avec son id avant traitement.

Les montants suivent [[prix-en-centimes]] ; le déploiement suit [[deploiement]].
