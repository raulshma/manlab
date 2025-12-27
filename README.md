# ManLab (.NET 10)

ManLab is a hub-and-spoke home-lab / fleet management system:

- **Server (hub)**: `src/ManLab.Server` — ASP.NET Core Web API + SignalR + EF Core (Postgres)
- **Web dashboard**: `src/ManLab.Web` — Vite + React + TypeScript
- **Agent (spoke)**: `src/ManLab.Agent` — .NET console app intended for Native AOT (`PublishAot=true`)

The agent maintains a reverse connection to the server (SignalR) and periodically sends telemetry/heartbeats.

## Repo layout

- `src/ManLab.Server`: REST API (`/api/*`) + SignalR hub (`/hubs/agent`) + DB migrations
- `src/ManLab.Web`: dashboard UI (dev server proxies `/api` and `/hubs`)
- `src/ManLab.Agent`: agent app + command handlers
- `src/ManLab.AppHost`: .NET Aspire local orchestration (recommended)
- `src/ManLab.Build`: publishes/stages agent binaries for download from the server
- `scripts/`: convenience scripts (install + publish helpers)

## Local development (recommended): .NET Aspire

The Aspire AppHost orchestrates:

- PostgreSQL (container)
- `ManLab.Server`
- `ManLab.Web` (Vite dev server)

### Prereqs

- .NET SDK 10.x
- Docker Desktop (for the Postgres container)
- Node.js (for the Vite dev server)
- (Optional) Aspire CLI

### Run

- With Aspire CLI: run `aspire run` from the repo root
- Without Aspire CLI: run the AppHost project `src/ManLab.AppHost` (e.g., from VS Code / Visual Studio)

Open the Aspire dashboard URL shown in the terminal to view logs/traces/metrics and the allocated endpoints.

## Docker deployment (recommended): Aspire Docker hosting integration

For a containerized deployment (Postgres + Server + Web), this repo uses Aspire’s Docker hosting integration.

The source of truth is the Aspire app model in `src/ManLab.AppHost/AppHost.cs`.

### 1) Publish a Docker Compose bundle

- Run `aspire publish -o aspire-output` from the repo root.

This generates:

- `aspire-output/docker-compose.yaml`
- `aspire-output/.env`

### 2) Set required environment variables

Copy the example file and fill in values:

- Copy `aspire-output/.env.example` → `aspire-output/.env`
- Set at least:
	- `PGPASSWORD`
	- `SERVER_IMAGE`
	- `WEB_IMAGE`
	- `SERVER_PORT` (used for HTTPS endpoint metadata; set to `8081` if unsure)

### 3) Build/pull images

- Server image is built from `src/ManLab.Server/Dockerfile` (or pulled from your registry).
- Web image is built from `src/ManLab.Web/Dockerfile` (nginx serves the SPA and reverse-proxies `/api` and `/hubs`).

### 4) Run with Docker Compose

- Run `docker compose -f aspire-output/docker-compose.yaml --env-file aspire-output/.env up -d`

Then open:

- Dashboard: `http://localhost:8080`

### Agent onboarding note (important)

In the containerized topology, the dashboard container is the reverse proxy.

When installing agents (scripts or UI), use the **dashboard origin** as the server base URL (e.g. `http://<host>:8080`), not the internal server container port.

## Manual local run (no Aspire)

If you prefer running pieces yourself:

1) Start PostgreSQL (container or local install)
2) Run the server (`src/ManLab.Server`)
	- Dev default URL: `http://localhost:5247`
	- API reference (dev): `http://localhost:5247/scalar`
	- On startup the server applies EF Core migrations (`Database.MigrateAsync()`)
3) Run the web app (`src/ManLab.Web`)
	- Vite dev server proxies `/api` and `/hubs` to the backend.
	- Proxy target selection order is documented inline in `src/ManLab.Web/vite.config.ts` and falls back to `http://localhost:5247`.
4) Run an agent (`src/ManLab.Agent`) pointed at the hub URL

## Agent configuration

The SignalR hub endpoint is:

- `http(s)://<server-host>/hubs/agent`

You can configure the agent via `src/ManLab.Agent/appsettings.json` or environment variables:

- `MANLAB_SERVER_URL` (must include `/hubs/agent`)
- `MANLAB_AUTH_TOKEN` (optional)

Default dev config is:

- `ServerUrl`: `http://localhost:5247/hubs/agent`

## Publishing + staging agent binaries (server download API)

The server exposes a small “binary distribution” API used by the installer scripts:

- `GET /api/binaries/agent` (lists available RIDs)
- `GET /api/binaries/agent/{rid}` (downloads `manlab-agent` / `manlab-agent.exe`)

Binaries are served from the server’s distribution root:

- Default: `src/ManLab.Server/Distribution/agent/{rid}/...`
- Configurable via `BinaryDistribution:RootPath` (defaults to `{ContentRoot}/Distribution`)

To publish and stage binaries for common RIDs, use the build tool (or the wrapper script):

- `src/ManLab.Build` (authoritative implementation)
- `scripts/publish-agent.ps1` (convenience wrapper that invokes `ManLab.Build`)

## Installing the agent on machines

See `INSTALLATION.md` for the installer scripts:

- Linux: `scripts/install.sh` (systemd)
- Windows: `scripts/install.ps1` (Task Scheduler)

## Notes / gotchas

- **Aspire connection name**: the AppHost uses a Postgres database resource name of `manlab`; the server uses the same connection name via `builder.AddNpgsqlDbContext<DataContext>("manlab")`.
- **Generated deployment output**: `aspire-output/` is generated by `aspire publish` (Compose + `.env`). Treat it as build output; don’t commit it, except for the provided `aspire-output/.env.example`.
