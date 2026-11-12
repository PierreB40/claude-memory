---
name: test-before-commit
description: Run the targeted suite before each commit — CI takes ten minutes, a local test ten seconds
metadata:
  type: feedback
---

Before each commit, run the tests of the package you touched (`pnpm --filter <package> test`).

**Why:** CI takes ten minutes to say what a local test says in ten seconds.
**How to apply:** always, except for a documentation-only change. See [[prices-in-cents]].
