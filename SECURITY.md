# Security

Claude Memory is a trusted worker: it runs in a Node process with your user account's access. It
reads Claude Code's memory folders and runs `git` read-only in your workspaces. It never writes a
memory and sends nothing over the network.

## Reporting a vulnerability

Please report it privately through
[GitHub's private vulnerability reporting](https://github.com/PierreB40/claude-memory/security/advisories/new),
not in a public issue. Say what an attacker could do and how to reproduce it. You will get an
answer within a week.

Only the latest release is supported.
