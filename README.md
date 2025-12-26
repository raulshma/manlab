# ManLab (.NET 10)

ManLab is a small hub-and-spoke system:

- **Server**: `src/ManLab.Server` (ASP.NET Core Web API + SignalR + EF Core / Postgres)
- **Web dashboard**: `src/ManLab.Web` (Vite + React + TS)
- **Agent**: `src/ManLab.Agent` (.NET console app, Native AOT)

## Local development (recommended): .NET Aspire

ManLab includes an Aspire AppHost that orchestrates:

- PostgreSQL (container)
- `ManLab.Server`
- `ManLab.Web` (Vite dev server)

### Prereqs

- .NET SDK 10.x
- Docker Desktop (for the Postgres container)
- Node.js (for the Vite dev server)
- (Optional) Aspire CLI

### Run

- If you have the Aspire CLI installed: run the AppHost via `aspire run` from the repo root.
- Otherwise: run the AppHost project (`src/ManLab.AppHost`) with `dotnet run`.

Once running, open the Aspire dashboard URL shown in the terminal to view logs/traces/metrics and the allocated endpoints.

## Notes

- The AppHost uses a Postgres *database resource name* of `manlab`. The server uses the same connection name via `builder.AddNpgsqlDbContext<DataContext>("manlab")`.
- `src/ManLab.Web/vite.config.ts` is set up to proxy `/api` and `/hubs` to the backend using Aspire-injected endpoint environment variables when available, with a fallback to `http://localhost:5247`.

### Docker Compose vs Aspire

- **Aspire AppHost** is the preferred local-dev orchestrator.
- **docker-compose** remains useful for non-Aspire environments and can be kept for deployment scenarios.

## Agent installation

See `INSTALLATION.md` for the one-line installer scripts and agent service registration.
