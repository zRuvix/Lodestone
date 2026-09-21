# Lodestone

AI agent harness for Minecraft Java Edition bots (target **1.21.1**). An AI agent
controls a Mineflayer bot through high-level tools, driven by our own agent loop
built directly on the Anthropic Messages API (`@anthropic-ai/sdk` with a custom
`baseURL`). No Agent SDK, no server setup — the bot joins the server in `config.yaml`.

## Setup

Requirements: Node.js 20+ (LTS).

```bash
npm install
cp config.example.yaml config.yaml   # config.yaml is gitignored
cp .env.example .env                  # .env is gitignored
# put your API key in .env, e.g. LODESTONE_API_KEY=...
```

## Step 0: connectivity check (do this FIRST)

```bash
npm run check:llm
```

Sends a minimal non-streaming request, a streaming request (if `llm.stream` is true),
and a dummy-tool round trip (`tool_use` → `tool_result` → continuation) through the
configured endpoint, key and model. Prints pass/fail per step with token usage and
latency. On failure it shows HTTP status + hint without leaking the key. **If any
step fails, stop and fix it — don't continue to Minecraft code.**

## Config

All tunable values live in `config.yaml` (see `config.example.yaml` for the full
reference). Highlights:

- `llm.base_url`: base URL or full `.../v1/messages` URL (normalized; the SDK
  appends `/v1/messages` itself). `api_key_env` names the env var holding the key —
  the key never lives in YAML and is redacted in logs/errors.
- `llm.auth_type`: `api_key` (x-api-key) or `bearer` (Authorization: Bearer).
- `llm.model`: custom model ID, passed through exactly. `temperature: null` means
  "don't send"; prompt caching off unless enabled; no `anthropic-beta` headers
  unless configured.
- `minecraft`: host/port/version (`1.21.1`)/username/auth (`offline`|`microsoft`).
  `auth: offline` needs no credentials; `microsoft` triggers device-code auth.
- `agent.allowed_tools` must name known tools only.

## Scripts

- `npm run dev` — run the agent (goal via CLI arg or stdin)
- `npm run build` — typecheck + emit to `dist/`
- `npm test` — unit tests (Vitest)
- `npm run lint` — eslint
- `npm run check:llm` — LLM connectivity check
- `npm run test:integration` — opt-in integration tests (`RUN_INTEGRATION=1`),
  non-destructive (observe + goto only, no digging/placing)
