# Claude Memory — Orca plugin

What Claude Code remembers about the project you are working on, and what no longer holds.

Claude Code writes memories on its own (`~/.claude/projects/<project>/memory/`) and reads them
at every session. Nobody rereads them; the code moves on, and a memory describing deleted files
keeps steering the agent. This panel shows, for the focused Orca workspace:

1. **To verify** — memories citing files that are gone from the repository (most of their code
   gone first), dead `[[links]]`, links aimed at a file name instead of a `name:`, memories
   missing from `MEMORY.md` (Claude never sees them), an index past what Claude loads.
   **Have Claude verify** hands the list to an idle Claude agent of the workspace (or launches
   one): it fixes what is still useful and *proposes* what to delete, never deletes alone.
2. **Learned this week** — what Claude wrote or changed by itself lately, to read it once.
3. **Everything** — searchable, grouped by type. Any memory opens in place, with what is wrong
   with it and the memories it links to.

The project is detected from the focused workspace (a linked worktree maps to its main
checkout, where Claude Code files the memory). Cited paths are checked with `git ls-files` on
that checkout; a path whose first folder is not in the repository (a package, a domain) is not
judged. The panel itself never writes a memory.

## Use

```bash
orca plugin dev watch . --check                  # load it in Orca (asks approval once)
orca plugin test .                               # tests
node src/cli.ts                                  # projects with memories, no Orca needed
node src/cli.ts -Users-me-Dev-app ~/Dev/app      # what to verify; exit 1 when anything is
```

Setting: `projectsRoot` (default `~/.claude/projects`).

Access asked: a Node worker on your machine (reads the memory folders and runs `git ls-files`),
its own settings, the focused workspace (to pick its project), agent status, typing into a
terminal and launching an agent (to hand over the verification).
