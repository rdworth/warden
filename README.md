# Warden

An agent harness (Node.js + Vercel AI SDK) with a Next.js front end that talks
to it over WebSockets. pnpm + Turborepo monorepo, deployed as two services on
Railway.

## Layout

```
warden/
├── apps/
│   ├── web/                 # Next.js frontend (UI + typed WS client)
│   └── server/              # Node WS server — thin transport over the harness
├── packages/
│   ├── core/                # the agent harness (no transport, no Next.js)
│   └── contracts/           # shared WS message schemas (zod) + types
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

**The boundary that matters:** `packages/core` is transport-agnostic — it turns
a conversation into an async stream of harness events and knows nothing about
WebSockets. `packages/contracts` is the single source of truth for every
message that crosses the wire, imported by both ends so the client and server
can't drift. `apps/server` is a thin layer: validate inbound events → drive
`core` → stream `contracts`-typed events back.

## Local development

```bash
pnpm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env   # used by apps/server
pnpm dev                                      # runs web + server together
```

- Web: http://localhost:3000
- Server: ws://localhost:8080 (WebSocket) — also serves HTTP `GET /` → 200,
  used as the deploy health check.

The web app defaults to `ws://localhost:8080`; override with
`NEXT_PUBLIC_WS_URL`.

> The server reads `ANTHROPIC_API_KEY` (and optional `MODEL`) from the
> environment, and auto-loads the repo-root `.env` on startup. Real environment
> variables (e.g. on Railway) take precedence and are not overridden.

## Deploying to Railway (both services)

Both apps run as **persistent Node processes** on Railway — exactly what a
long-lived WebSocket server needs, and what Vercel's serverless model can't
host. Create **two services** in one Railway project, both pointing at this
repo with **Root Directory = `/`**:

### 1. `server` service
- Config-as-code path: `apps/server/railway.json` (or set Builder = Dockerfile,
  Dockerfile Path = `apps/server/Dockerfile` in the dashboard).
- Variables: `ANTHROPIC_API_KEY` (required), `MODEL` (optional).
- Generate a public domain → this is your `wss://…` URL. Opening it over
  HTTPS in a browser returns `warden agent server: ok` (the health check).

### 2. `web` service
- Config-as-code path: `apps/web/railway.json`.
- Build variable: `NEXT_PUBLIC_WS_URL=wss://<your-server-domain>` — it's baked
  into the bundle at **build** time, so it must be set before the build runs.
- Generate a public domain → this is the app users visit.

Railway's proxy supports WebSocket upgrades natively, so no extra config is
needed. Bind to `0.0.0.0` and `process.env.PORT` (the server already does).

> Scaling note: this holds WS state in memory per process. Running multiple
> server replicas later means sticky sessions + a shared pub/sub (e.g. Redis)
> for cross-instance fan-out — not a day-one concern.

## Extending the harness

- **Add a tool:** edit the `tools` map in `packages/core/src/index.ts`. Promote
  real actions (sending messages, writing data) to dedicated tools so the
  harness can gate, render, or audit them.
- **Add a WS message type:** add it to the `ClientEvent` / `ServerEvent` unions
  in `packages/contracts/src/index.ts` — both ends pick up the type immediately.
