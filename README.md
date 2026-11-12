# Claude Memory — Orca plugin

What Claude Code remembers about the project you are working on, and what no longer holds.

Claude Code writes memories on its own (`~/.claude/projects/<project>/memory/`) and reads them
at every session. Nobody rereads them; the code moves on, and a memory describing deleted files
keeps steering the agent.

## What it does

**A sidebar panel that follows the focused workspace**, like Orca's own tabs: switch workspace,
it switches project. A fixed header (project, branch, *Verify*, tabs, search, type filter) over
grouped lists:

- **To verify** — *broken by your branch* (files your branch removes that the default branch
  still has: fix them in the same PR), then *maybe no longer true* (cited files gone from the
  code, dead `[[links]]`, links aimed at a file name instead of a `name:`, memories missing
  from `MEMORY.md`), and index problems.
- **Recent** — what Claude wrote this week: new since your last visit, then earlier.
- **All** — by type (rules of work, project, references, profile), A to Z.

**A memory opens in place**: what is wrong with it, its text (`[[links]]` read as the titles
they name), what it points to and what points to it, then its file, whether it is in the index,
its cited paths, and **how often Claude read it**.

**Verify** starts a *new* Claude in a terminal of the workspace, the request as its first
message (`claude '<request>'`): it fixes what is still useful and *proposes* deletions, never
makes them alone. It never types into an existing terminal.

**When Claude writes a memory**, a notification says so — and says right away if it cites a
file missing from the agent's workspace, links to nothing, or is missing from the index.

**The status bar** shows the health of the focused project's memory: red when your branch
breaks memories, orange with the count to verify, green when sound, `+n` for new ones.

**The palette** has *Claude Memory: show the panel* and *Claude Memory: have Claude verify*.

## How it knows

- **Project.** Claude Code files the memory under the main checkout, so every worktree of a
  repository shares one memory. The panel finds it from the focused workspace (a linked
  worktree's `.git` file leads to its main checkout).
- **Code.** Cited paths are checked on the focused workspace's branch, working tree included
  (`git ls-files --cached --others --exclude-standard`, minus deleted files), and compared with
  the default branch (`origin/HEAD`) to tell what *your branch* broke. A path whose first folder
  is no folder of the repository (an npm package, a domain) is not judged.
- **Reads and writes.** An `agent.tool.after` hook sees every tool call of the agents running in
  Orca; it keeps only `Write`/`Edit`/`MultiEdit` and `Read` calls on a memory file.

## Limits

- **Read counts are a minimum.** Only reads through Claude Code's `Read` tool are counted. A
  memory opened another way (`cat`, `grep`, `head` in a shell, an agent outside Orca, a session
  over SSH or WSL) is not. Counting starts when the plugin first sees the project: « never read
  since <date> » says nothing about before that date.
- **Memories Claude loads by itself are not reads.** `MEMORY.md` is loaded at every session
  without a tool call, so it is never counted, and neither is anything Claude Code injects
  automatically.
- **Code checks see one checkout.** A file that exists only on another branch reads as missing.
- **The status bar opens the sidebar, not this panel**: Orca gives plugins no way to show a
  given panel.
- **No clipboard**: Orca panels cannot copy a path.

## Use

```bash
orca plugin dev watch . --check                  # load it in Orca (asks approval once)
orca plugin test .                               # tests
node src/cli.ts                                  # projects with memories, no Orca needed
node src/cli.ts -Users-me-Dev-app ~/Dev/app      # what to verify; exit 1 when anything is
```

Setting: `projectsRoot` (default `~/.claude/projects`).

Access asked: a Node worker on your machine (reads the memory folders, runs `git`), its own
settings and storage (what you saw, read counts), the focused workspace (to follow it), opening
the sidebar (status bar), typing in a new terminal (to start Claude), notifications. The panel
never writes a memory.
