# agent-proxy

Node.js rewrite of the Java `future-team-agent-proxy` service. It bridges to
local CLI tools (Claude Code / Hermes / OpenCode) and exposes an
OpenAI-compatible chat API on `127.0.0.1:9099` by default.

## Endpoints

| Method | Path                  | Purpose                                                 |
| ------ | --------------------- | ------------------------------------------------------- |
| GET    | `/health`             | Liveness probe (`{ "status": "ok" }`)                   |
| GET    | `/v1/cli-agents`      | List locally discovered CLIs + their registration state |
| POST   | `/v1/session/open`    | Open a session, bind a `cliType` / `agentId`            |
| POST   | `/v1/chat/completions`| OpenAI-compatible chat, stream or sync                  |

## Run

```bash
# from this directory
npm run build       # tsc -> dist/
npm start           # node dist/index.js
# or one-shot
npx tsc -p tsconfig.json && node dist/index.js
```

CLI flags:

- `--port=9099` (default) — listen port
- `--persist-dir=~/.future-team` (default) — where `cli-agents.json` and
  `sessions.json` live

## Routing

When `POST /v1/chat/completions` arrives, the proxy picks a CLI in this order:

1. session-bound `agentId` → exact registry match
2. session-bound `cliType` → registry match, or default config
3. `X-Agent-Id` header → exact registry match
4. `X-CLI-Type` header or `model` field (`hermes` / `opencode` / `claude`) →
   registry match, or default config
5. default (`claude-code`)

## Wrappers

- **ClaudeCodeWrapper** — `claude -p … --output-format stream-json
  --include-partial-messages`. Injects `ANTHROPIC_BASE_URL` +
  `ANTHROPIC_API_KEY` from `~/.hermes/config.yaml` so it routes through
  minimax without `/login`.
- **HermesProcessWrapper** — POSTs to the local hermes gateway
  (`127.0.0.1:8642/v1/chat/completions`). Reads `Authorization: Bearer …`
  from `/tmp/hermes_api_key.txt`. Per-session message history kept in memory.
- **OpencodeProcessWrapper** — talks to `127.0.0.1:8643`. Creates an opencode
  session per proxy session, caches the mapping.

If the gateway / opencode server isn't running, those wrappers will surface
an error in the SSE stream; the proxy itself still runs.

## Persistence

Two JSON files under `--persist-dir`:

- `cli-agents.json` — agents registered via `discoverAndRegister` at startup
- `sessions.json` — session → `{ cliType, agentId }` bindings

## Differences from the Java version

- No Nacos registration (the Java `NacosRegistryService` is for
  multi-machine agent discovery; not needed on a single dev box)
- No JAR launcher / fat-jar packaging
- Built-in `http` instead of `com.sun.net.httpserver`
- Same wire format and same wrapper contract
