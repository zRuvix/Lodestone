# Lodestone Design

Date: 2026-09-21. Target MC: 1.21.1 Java. Single Node process, custom agent loop on Anthropic Messages API.

## Decisions (docs-verified)
- SDK POSTs to `<baseURL>/v1/messages`; base URL must NOT include `/v1/messages`. Normalize both forms, warn on odd values.
- `apiKey` -> `x-api-key`, `authToken` -> `Authorization: Bearer`. 9Router docs show Bearer; default `auth_type: "bearer"`.
- SDK always sends `anthropic-version: 2023-06-01`; cannot strip. check:llm proves gateway compat.
- `stop_reason`: end_turn, max_tokens, stop_sequence, tool_use, pause_turn, refusal, model_context_window_exceeded. Loop handles all, never crashes on unknown.
- Abort via per-request `signal: AbortSignal`.
- Mineflayer tested versions include 1.21.1.
- Pathfinder real options: `canDig, allowSprinting, allowParkour, maxDropDown, allow1by1towers` (+ costs). No `allow_placing` flag; placing governed by placeCost/scaffolding. Config uses `can_dig, allow_sprinting, allow_parkour, max_drop_down, allow_1by1_towers`.
- Zod v4 built-in JSON-Schema converter; no zod-to-json-schema unless install resolves v3.
- No SDK `toolRunner` helper; own loop with `messages.create` / `messages.stream`.

## Architecture
`src/config/` loads+validates config.yaml + .env, typed config to all layers. `src/llm/` builds client from config, wraps create/stream with retries/timeout/abort/usage. `src/bot/` creates Mineflayer bot, emits damage/chat/death/health. `src/tools/` framework-agnostic definitions `(args,ctx,signal)=>{text,isError}`, registry to Messages tool format. `src/observe/` compact text snapshots. `src/agent/` own loop. `src/cli.ts` goal arg/stdin + `--config`, readable logs.

## Agent loop
Send messages+allowlisted tools -> accumulate response -> end_turn done; tool_use -> Zod-validate -> run sequential (parallel only read-only if enabled) -> exactly one tool_result per call (errors is_error) -> injection queue appended after tool_results -> trim older observe results beyond keep_last_observations to "[older observation omitted]" keeping valid history -> repeat to max_turns/cancel/fatal. beforeTool/afterTool hooks (logging now). Log per-turn + running tokens.

## Config schema
llm: base_url, api_key_env (default LODESTONE_API_KEY), auth_type api_key|bearer (default bearer), model passthrough, max_tokens 2048, temperature null=dont-send, stream true, prompt_caching false, extra_headers {}, request_timeout_seconds 120, max_retries 2. minecraft: host localhost, port 25565, version 1.21.1, username Agent, auth offline|microsoft, connect_timeout_seconds 30, auto_reconnect false. agent: max_turns 40, system_prompt_file prompts/system.md, allowed_tools subset of registered, parallel_read_only_tools false, keep_last_observations 3. observation: radius 16, max_entities 10, max_block_types 12, include_inventory true. tools: default_timeout_seconds 60, goto arrive_distance 1 timeout 90, collect_block search_radius 32 max_count 64 timeout 120. pathfinder: can_dig true, allow_sprinting true, allow_parkour false, max_drop_down 3, allow_1by1_towers (default false). logging: level info, show_reasoning true, log_file null.

Rules: yaml parse + Zod validate, defaults filled, readable per-field errors no stack. allowed_tools validated vs registry. Missing key env -> name variable, never value. Key redacted in logs/dumps/errors. Only model,max_tokens,system,messages,tools,stream by default; temperature/cache_control/extra headers only if enabled; never anthropic-beta unless configured. Retries on 429/5xx backoff; other 4xx fail fast with status+type+hint, no key.

## Tools (Milestone 1)
High-level async, block to complete/fail/timeout/cancel. Short text, isError+hint on failure. Timeout from config, respect AbortSignal. Read-only separate. observe (pos/health/food/time/dimension/inventory/entities/blocks), goto (coords or player via GoalNear/GoalFollow+goto), collect_block (findBlock+path+dig+pickup loop to count), say (chat).

## Testing
Vitest, mocked bot + scripted mock LLM: config validation/normalization/redaction, observation formatting, tool results; loop: multi-turn, malformed input, unknown tool, throw, cancel mid-tool, max_turns, inject ordering, trim validity. Integration behind RUN_INTEGRATION=1: check:llm flow, observe+goto only (no dig/place). Scripts: dev (tsx), build (tsc), test, lint, check:llm, test:integration.

## Risks
9Router documents /v1/chat/completions + /v1/models; /v1/messages tool_use+streaming unproven until check:llm. Custom model tool-use ability unproven. Demo digs live server — confirmed OK pending test area answer.
