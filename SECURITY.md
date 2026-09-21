# Security Policy

## Reporting a Vulnerability

Please report security issues privately — do not open a public issue.
Contact the maintainer at zruvix@outlook.com with a description of the
issue and steps to reproduce.

## Notes for this project

- API keys are loaded from environment variables only (never from YAML or
  git-tracked files) and are redacted in logs and error messages.
- `config.yaml` and `.env` are gitignored. Before committing, verify with
  `git status` that no secrets are staged.

## Agent chat exposure

The bot reads Minecraft chat as untrusted input. Worst case in v1: silly chat
messages, walking somewhere, or edits to its own SOUL.md/MEMORY.md/TASKS.md.
Remove `write_file` from `agent.allowed_tools` to make memory read-only.
