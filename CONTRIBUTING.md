# Contributing to Lodestone

Thanks for your interest! This is a small, early-stage project — issues and
small focused PRs are welcome.

## Setup

```bash
npm install
cp config.example.yaml config.yaml   # gitignored, never commit real configs
cp .env.example .env                  # gitignored, never commit keys
```

Requirements: Node.js 20+.

## Workflow

1. Run the connectivity check first: `npm run check:llm`
2. Unit tests: `npm test`
3. Lint: `npm run lint`
4. Build: `npm run build`
5. Opt-in live tests (needs a local 1.21.1 server + key, non-destructive):
   `LODESTONE_API_KEY=... RUN_INTEGRATION=1 npm run test:integration`

Please keep PRs small and include/extend tests for behavior changes.

## Rules

- **Never commit secrets.** `config.yaml` and `.env` are gitignored — keep it
  that way. API keys live only in env vars and are redacted in logs/errors.
- **No server setup code.** Lodestone joins an existing server; don't add
  Docker files or server start scripts.
- **The agent has no file or shell access** — don't add tools that execute
  arbitrary code.
- End commit messages with:
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`
