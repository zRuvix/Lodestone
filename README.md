# Lodestone

[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Minecraft 1.21.1](https://img.shields.io/badge/minecraft-1.21.1-blue)](https://www.minecraft.net)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

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
# with a custom config path:
npm run check:llm -- --config /path/to/config.yaml
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

## Tools (Milestone 1)

- `observe` (read-only) — position, health, food, time, dimension, inventory,
  nearby entities and block types within the observation radius.
- `goto` — pathfind to `{x, y, z}` or a named `{player}`; arrives within
  `tools.goto.arrive_distance`, times out per `tools.goto.timeout_seconds`.
- `collect_block` — find nearest `{block}`, path, dig, pick up drops, repeat to
  `{count}` (capped by `tools.collect_block.max_count`).
- `say` — send a chat message.
- Pathfinder `Movements` come from the `pathfinder:` block (`can_dig`,
  `allow_sprinting`, `allow_parkour`, `max_drop_down`, `allow_1by1_towers`).
  No placing in M1 by design.

## Running the agent

```bash
npm run dev -- "Collect 5 oak logs, then tell me in chat when you're done"
npm run dev -- --config ./config.yaml "Your goal here"
echo "Your goal here" | npm run dev
```

Ctrl+C cancels the run (aborts the in-flight LLM request and tool).

## Scripts

- `npm run dev` — run the agent (goal via CLI arg or stdin)
- `npm run build` — typecheck + emit to `dist/`
- `npm test` — unit tests (Vitest)
- `npm run lint` — eslint
- `npm run check:llm` — LLM connectivity check
- `npm run test:integration` — opt-in integration tests (`RUN_INTEGRATION=1`),
  non-destructive (observe + goto only, no digging/placing).
  Needs `config.yaml` plus the key env var, e.g.
  `LODESTONE_API_KEY=... RUN_INTEGRATION=1 npm run test:integration`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never commit `config.yaml` or `.env`
(both gitignored) — keys live in env vars only. Please report vulnerabilities
privately per [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
