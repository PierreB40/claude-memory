---
name: prices-in-cents
description: Never floats for an amount — every price is an integer in cents
metadata:
  type: feedback
---

Every amount is an integer in cents, from the database to the API. Only the display formats it.

**Why:** a floating-point rounding once made an invoice wrong.
