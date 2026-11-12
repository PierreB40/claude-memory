---
name: stripe-payments
description: Idempotent Stripe webhooks — one key per event, replaying never charges twice
metadata:
  type: project
---

Webhooks go through `apps/api/src/webhooks/stripe.ts`, signed with `STRIPE_WEBHOOK_SECRET`. Each event is recorded with its id before it is handled.

Amounts follow [[prices-in-cents]]; releases follow [[deployment]].
