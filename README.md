# Claude Memory — Orca plugin

What Claude Code remembers about the project you are working on, and what no longer holds.

Claude Code writes memories on its own (`~/.claude/projects/<project>/memory/`) and reads them
at every session. Nobody rereads them; the code moves on, and a memory describing deleted files
keeps steering the agent.

## What it does

**A sidebar panel that follows the focused workspace**, like Orca's own tabs: switch workspace,
it switches project. A fixed header (project, branch, *Verify*, tabs, search, type filter) over
grouped lists:

- **To verify** — *maybe no longer true*: cited files found neither in the workspace nor on the
  default branch, dead `[[links]]`, links aimed at a file name instead of a `name:`, memories
  missing from `MEMORY.md` (Claude never sees them), and index problems. Then, apart and not
  counted, *to update when your branch merges*: memories citing files your branch removed since
  it left the default branch. The memory is shared by every worktree and still true on the
  default branch, so nothing is to change before the merge.
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

**The status bar** shows the health of the focused project's memory: orange with the count to
verify, green when sound, `+n` for new ones. Clicking it shows or hides the sidebar.

**The palette** has *show or hide the sidebar* and *have Claude verify the memory*.

## How it knows

- **Project.** Claude Code files the memory under the main checkout, so every worktree of a
  repository shares one memory. The panel finds it from the focused workspace (a linked
  worktree's `.git` file leads to its main checkout).
- **Code.** A cited path holds if it is in the focused workspace (working tree included:
  `git ls-files --cached --others --exclude-standard`, minus deleted files), on the default
  branch's tip (`origin/HEAD`, else `main`), or on disk though git ignores it (`.env`). *Removed
  by your branch* means deleted or renamed between the branch's fork point (`git merge-base`)
  and now. A path whose first folder is no folder of the repository (an npm package, a domain)
  is not judged. Git answers are reused for 5 s.
- **Reads and writes.** An `agent.tool.after` hook sees every tool call of the agents running in
  Orca; it keeps only `Write`/`Edit`/`MultiEdit` and `Read` calls on a memory file, and never
  holds Orca up. Writing `MEMORY.md` refreshes without a notification. A notification never says
  « not in the index »: Claude writes the memory first, its index line right after.

## Limits

- **Read counts are a minimum, and a reading is a visit.** Reads of one memory less than ten
  minutes apart count once (Claude reads long files in parts). Only reads through Claude Code's `Read` tool are counted. A
  memory opened another way (`cat`, `grep`, `head` in a shell, an agent outside Orca, a session
  over SSH or WSL) is not. Counting starts when the plugin first sees the project: « never read
  since <date> » says nothing about before that date.
- **Memories Claude loads by itself are not reads.** `MEMORY.md` is loaded at every session
  without a tool call, so it is never counted, and neither is anything Claude Code injects
  automatically.
- **Code checks see the focused workspace and the default branch.** A file that exists only on a
  third branch reads as missing.
- **Two workspaces with the same name on the same branch** cannot be told apart: Orca gives a
  panel only the focused workspace's name and branch. The panel says so instead of guessing.
- **Local workspaces only.** A workspace on an SSH host is read as if its path were local.
- **POSIX shells.** *Verify* types `claude '…'` in a new terminal: fine in sh, bash, zsh, fish;
  not in PowerShell or cmd.
- **A failed write** leaves no file and is ignored; a write that failed after creating it is not
  told apart.
- **The status bar shows or hides the sidebar, not this panel**: Orca gives plugins no way to show a
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
