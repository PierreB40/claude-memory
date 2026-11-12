---
name: cart
description: The cart page keeps its state in the URL — a shared link reopens the same cart
metadata:
  type: project
---

`apps/web/pages/cart.vue` reads the cart from the query string, so a shared link reopens it.
Totals follow [[prices-in-cents]].
