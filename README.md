# Claude Memory — Orca plugin

Audits Claude Code's auto-memory (`~/.claude/projects/<project>/memory/`) from Orca's sidebar.
The panel never writes a memory: "Ask Claude to fix" hands the problems to a Claude agent of the focused workspace (an idle one, else a new one).

## What it flags

| Kind | Severity | Meaning |
|---|---|---|
| `broken-link` | danger | `[[slug]]` matches no memory |
| `index-dangling` | danger | `MEMORY.md` links to a file that does not exist |
| `duplicate-name` | danger | two files share one `name:` |
| `index-too-long` | danger | `MEMORY.md` past 200 lines: Claude Code does not load the rest |
| `link-by-filename` | warning | `[[x]]` matches a file name, not that memory's `name:` |
| `not-indexed` | warning | a memory missing from `MEMORY.md` |
| `no-frontmatter` | warning | no `name` / `description` / `type` header |
| `stale` | info | a `project` memory untouched for 60+ days (setting): to reread |

## Use

```bash
orca plugin dev watch . --check            # load it in Orca while developing (asks approval)
orca plugin test .                         # tests
node src/cli.ts                            # list projects with memories, no Orca needed
node src/cli.ts -Users-me-Dev-app [--all]  # audit one; exit 1 on a danger
```

Settings: `projectsRoot` (default `~/.claude/projects`), `staleDays` (default 60).

Access asked: a Node worker on your machine (it reads the memory folders), its own settings, the focused workspace (to pick its project), agent status, typing into a terminal and launching an agent (to hand over the fix).
