# Lodestone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Lodestone Milestone 1: bot joins 1.21.1 server and completes "collect 5 oak logs" via custom agent loop on a third-party Anthropic endpoint.

**Architecture:** Single Node process, layered src/ (config → llm → bot → tools/observe → agent → cli). Own Messages API loop, no Agent SDK. Zod-validated YAML config feeds every layer.

**Tech Stack:** Node 20+ (running 22), TypeScript strict ESM, mineflayer + mineflayer-pathfinder, @anthropic-ai/sdk, zod v4, yaml, dotenv, tsx, vitest.

**Spec:** `docs/superpowers/specs/2026-09-21-lodestone-design.md`

## Global Constraints

- Minecraft 1.21.1 Java Edition default; no server setup, no Docker.
- LLM via @anthropic-ai/sdk with custom baseURL only; never hardcode URL/key/model.
- Default request params only: model, max_tokens, system, messages, tools, stream. temperature/cache_control/extra headers only if config enables. Never anthropic-beta unless configured.
- baseURL must not include /v1/messages; normalize + warn.
- apiKey→x-api-key, authToken→Bearer. Default auth_type bearer.
- Key from env var named by llm.api_key_env; redacted in all logs/errors/dumps.
- Retry 429/5xx with backoff; other 4xx fail fast with status+hint, no key.
- Every tool_use gets exactly one tool_result; errors become is_error results, never crash.
- No file/shell access for agent tools; allowlist enforced.
- Commit messages end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

---

### Task 1: Scaffold + config layer + LLM layer + check:llm

**Files:**
- Create: `package.json`, `tsconfig.json`, `config.example.yaml`, `.env.example`, `.gitignore`, `src/config/schema.ts`, `src/config/loader.ts`, `src/config/base-url.ts`, `src/config/redact.ts`, `src/llm/client.ts`, `src/llm/check.ts`, `src/cli-check.ts` (or `src/check.ts` entry), `tests/unit/config.test.ts`, `tests/unit/redact.test.ts`, `README.md` (setup section)
- Modify: none (greenfield)

**Interfaces:**
- Consumes: yaml, dotenv, zod v4 (+ built-in JSON Schema converter only if needed later)
- Produces: `loadConfig(path: string) => Promise<LodestoneConfig>` (throws readable Error listing bad fields, no stack); `normalizeBaseUrl(raw: string) => { url: string; warnings: string[] }`; `redactSecrets(text: string, secrets: string[]) => string`; `createLlmClient(cfg) => Anthropic`; `runConnectivityCheck(cfg) => Promise<CheckReport>` with steps {text, stream, toolRoundTrip} each {pass, latencyMs, usage?, error?}

- [ ] **Step 1: Scaffold package + tsconfig + gitignore + examples**

Create `package.json` with deps: mineflayer, mineflayer-pathfinder, @anthropic-ai/sdk, zod, yaml, dotenv; devDeps: tsx, vitest, typescript, eslint (or biome — pick one, note it in README). Scripts: `dev` (tsx src/cli.ts), `build` (tsc), `test` (vitest run), `lint`, `check:llm` (tsx src/cli-check.ts), `test:integration` (RUN_INTEGRATION=1 vitest run tests/integration). `.gitignore`: config.yaml, .env, node_modules, dist. `config.example.yaml` per spec schema (auth_type bearer default). `.env.example` with LODESTONE_API_KEY=.

- [ ] **Step 2: Write failing config tests**

`tests/unit/config.test.ts`: valid file loads with defaults; missing required field errors naming field; bad value (e.g. port "abc") errors; unknown allowed_tools name errors; missing key env var errors naming var; base_url full .../v1/messages normalizes to base. Run: `npx vitest run tests/unit/config.test.ts`. Expected: FAIL (modules not defined).

- [ ] **Step 3: Implement config layer**

`src/config/schema.ts` (Zod schema + defaults + allowed_tools ⊆ registered names check done at load against registry list passed in), `src/config/base-url.ts` (strip trailing /v1/messages, warn if value contains /chat/completions or looks like OpenAI path), `src/config/loader.ts` (read yaml, dotenv load, Zod parse, friendly error join), `src/config/redact.ts` (replace key + env value occurrences with [REDACTED]).

- [ ] **Step 4: Implement LLM client + check**

`src/llm/client.ts`: new Anthropic({baseURL normalized, apiKey or authToken per auth_type, defaultHeaders only from extra_headers, timeout ms, maxRetries}); wrapper `createMessage(params, signal)` with retry on 429/5xx backoff, fast-fail 4xx with {status, type, hint} redacted. `src/llm/check.ts`: step1 non-stream text request; step2 streaming assemble if stream enabled else skip-pass; step3 dummy tool (name `ping_check`, one string arg) → expect tool_use → reply tool_result → expect text. Return per-step pass/fail + usage + latency. `src/cli-check.ts` prints pass/fail lines, exits nonzero on fail, redacts everywhere.

- [ ] **Step 5: Run unit tests + lint + build**

Run: `npx vitest run tests/unit/config.test.ts tests/unit/redact.test.ts`, `npm run lint`, `npm run build`. Expected: PASS.

- [ ] **Step 6: Run check:llm for real**

Run: `LODESTONE_API_KEY=<key> npm run check:llm`. Expected: 3 passes printed. If fail: stop, report status+hint, do NOT proceed to Task 2.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold, config, llm client and check:llm

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 2: Bot layer + observation snapshot

**Files:**
- Create: `src/bot/manager.ts`, `src/observe/snapshot.ts`, `tests/unit/observe.test.ts`
- Modify: `README.md` (config reference: minecraft section)

**Interfaces:**
- Consumes: `LodestoneConfig` from Task 1
- Produces: `createBotManager(cfg) => { connect(): Promise<void>, on(event, cb), getBot(): Bot }` events: damage, chat, death, health; `buildSnapshot(bot, cfg) => string` (pos, health, food, time, dimension, inventory, entities≤max, block types≤max within radius)

- [ ] **Step 1: Write failing observe test with mocked bot**

Mock bot object: position, health/food, time, dimension, inventory items, entities, blockAt/findBlocks stubs. Assert snapshot contains pos + health + item counts, truncates entities to max_entities and block types to max_block_types. Run: `npx vitest run tests/unit/observe.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement manager + snapshot**

`manager.ts`: mineflayer.createBot({host,port,version:'1.21.1',username,auth}) — note mineflayer uses `auth` only for microsoft; offline = no auth field/password. Handle spawn resolve, kick/error/end reject-or-reconnect per auto_reconnect, re-emit damage/chat/death/health. `snapshot.ts`: pure function, token-compact lines, reads only config observation limits.

- [ ] **Step 3: Run tests + lint**

Run: `npx vitest run tests/unit/observe.test.ts`, `npm run lint`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/bot src/observe tests/unit/observe.test.ts README.md
git commit -m "feat: bot manager and observation snapshot

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: Tool layer (observe, goto, collect_block, say) + registry

**Files:**
- Create: `src/tools/types.ts`, `src/tools/registry.ts`, `src/tools/observe.ts`, `src/tools/goto.ts`, `src/tools/collectBlock.ts`, `src/tools/say.ts`, `tests/unit/tools.test.ts`
- Modify: `README.md` (tool reference)

**Interfaces:**
- Consumes: `BotManager`, `LodestoneConfig`, `buildSnapshot`
- Produces: `ToolDef { name, description, schema: ZodObject, readOnly: boolean, run(args, ctx, signal): Promise<{text, isError}> }`; `TOOL_REGISTRY: ToolDef[]`; `toAnthropicTools(allowlist) => {name, description, input_schema}[]` via Zod v4 converter; `ctx = { bot, manager, config }`

- [ ] **Step 1: Write failing tool tests (mocked bot)**

observe returns snapshot text; goto calls pathfinder with GoalNear/GoalFollow, times out per config, respects abort; collectBlock loops findBlock→goto→dig→pickup to count, stops with hint when none found; say calls chat. Error case: handler throw → {isError:true}. Run: `npx vitest run tests/unit/tools.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement types + registry + 4 tools**

Timeouts from tools.* config; goto arrive_distance→GoalNear range, timeout 90s; collect_block search_radius/max_count/timeout; all check signal.aborted each await. Pathfinding Movements: canDig←can_dig, allowSprinting, allowParkour, maxDropDown←max_drop_down, allow1by1towers. Placing guard: no placing in M1 (allow_placing false by design).

- [ ] **Step 3: Run tests + lint**

Run: `npx vitest run tests/unit/tools.test.ts`, `npm run lint`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tools tests/unit/tools.test.ts README.md
git commit -m "feat: M1 tools observe goto collect_block say

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 4: Agent loop

**Files:**
- Create: `src/agent/loop.ts`, `src/agent/history.ts`, `tests/unit/agent.test.ts`
- Modify: none

**Interfaces:**
- Consumes: `createLlmClient`, `TOOL_REGISTRY`, `toAnthropicTools`
- Produces: `runAgent({goal, config, ctx, llm, hooks?}) => Promise<{status: 'done'|'max_turns'|'cancelled'|'error', turns, usage}>`; `cancel()`; `inject(text)`; history helpers `appendTrim` honoring keep_last_observations with "[older observation omitted]"

- [ ] **Step 1: Write failing loop tests with scripted mock LLM**

Script: assistant text + tool_use(observe) → tool_result → done. Cases: multi-turn run; malformed input → is_error result, loop continues; unknown tool → is_error; handler throw → is_error; cancel mid-tool → cancelled + exactly one tool_result; max_turns hit; inject ordering (results before injected text); trim keeps valid history. Run: `npx vitest run tests/unit/agent.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement loop + history**

Non-stream default path + stream path if enabled; accumulate content blocks; validate Zod per call; sequential (parallel read-only only if flag); stop_reason switch (end_turn done; max_tokens → final message + done-error note; refusal/stop_sequence/pause_turn/context → sensible end, no crash); per-turn + total usage logs via hooks beforeTool/afterTool.

- [ ] **Step 3: Run tests + lint**

Run: `npx vitest run tests/unit/agent.test.ts`, `npm run lint`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/agent tests/unit/agent.test.ts
git commit -m "feat: agent loop with trim inject cancel

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 5: CLI + system prompt + README + integration tests

**Files:**
- Create: `src/cli.ts`, `prompts/system.md`, `tests/integration/llm.test.ts`, `tests/integration/bot.test.ts`
- Modify: `README.md` (setup, config reference, run instructions), `package.json` (test:integration script if missing)

**Interfaces:**
- Consumes: everything above
- Produces: CLI `lodestone [--config path] "<goal>"` (stdin fallback); integration: llm flow (RUN_INTEGRATION=1 only), bot observe+goto smoke (no dig/place)

- [ ] **Step 1: Implement CLI + prompt**

Parse --config default ./config.yaml; load config; connect bot; run agent; print text/tool calls/results/usage; exit codes. system.md: goal-driven, tool discipline, when to stop, chat completion notice.

- [ ] **Step 2: Integration tests (gated)**

`RUN_INTEGRATION=1` guard with skip otherwise. llm.test: reuse runConnectivityCheck. bot.test: connect, run observe + goto small move, assert text non-empty, no dig/place calls.

- [ ] **Step 3: Run unit suite + lint + build**

Run: `npm test`, `npm run lint`, `npm run build`. Expected: PASS (integration skipped without env).

- [ ] **Step 4: Live demo (needs user)**

`npm run check:llm` green, then goal "Collect 5 oak logs, then tell me in chat when you're done". Report result; do not claim success without running.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cli, prompt, readme, integration tests

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

## Self-review

- Spec coverage: config/llm/check (Task1), bot/observe (Task2), tools (Task3), loop incl. trim/inject/cancel/hooks/allowlist/logging (Task4), CLI/prompt/README/integration (Task5). All covered.
- No placeholders: commands, assertions, and interfaces are concrete per task.
- Type consistency: `loadConfig`, `normalizeBaseUrl`, `redactSecrets`, `createLlmClient`, `runConnectivityCheck`, `createBotManager`, `buildSnapshot`, `ToolDef/run`, `toAnthropicTools`, `runAgent/cancel/inject` named once and reused verbatim.
