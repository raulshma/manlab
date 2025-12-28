# ManLab Agent Installation

This repo includes simple installation scripts for the **ManLab Agent** that:

- Detect OS/architecture (RID)
- Download the staged Native AOT agent binary from the ManLab Server’s Binary API
- Configure `MANLAB_SERVER_URL` (SignalR hub) and optional `MANLAB_AUTH_TOKEN`
- Persist the hub URL + auth token into the installed agent's `appsettings.json` so the agent can authorize after reboot/restart
- Register the agent to run automatically at boot (systemd on Linux, Task Scheduler on Windows)

## Where the installer downloads the agent from

By default, installers download the agent from the **ManLab Server Binary API**:

- `GET /api/binaries/agent/{rid}`

Optionally, installers can **prefer GitHub Releases** (download an archive and extract the agent binary). This is useful when:

- you want installs to pull the *official* release assets from GitHub, or
- your server is not staging binaries under `/api/binaries`, or
- you’re using the web dashboard “Install local agent” flow and want it to use GitHub.

To use GitHub Releases, you can either:

1) Configure it on the server via Settings keys (recommended for dashboard-driven installs)
2) Force it in the installer script arguments / environment variables (useful for manual installs)

### Server settings for GitHub Releases

Set these keys (via the dashboard settings API `POST /api/settings` or your settings UI if you have one):

- `GitHub.EnableGitHubDownload` = `true`
- `GitHub.ReleaseBaseUrl` = `https://github.com/raulshma/manlab/releases/download` (or your fork)
- `GitHub.LatestVersion` = `v0.0.1-alpha` (or the tag you want)

When these are set, the installer will print something like:

- `Attempting download from GitHub release: ...`

If GitHub download fails, it falls back to the server binary API.

## Prerequisites

1. The ManLab Server is running and reachable.
2. The server has staged agent binaries for your RID under:

- `GET /api/binaries/agent` (lists available RIDs)
- `GET /api/binaries/agent/{rid}` (downloads `manlab-agent` or `manlab-agent.exe`)

## Choosing the correct `--server` / `-Server` URL

The installer scripts expect a **server base URL** (origin), not a hub URL:

- ✅ `http://<host>:<port>`
- ❌ `http://<host>:<port>/hubs/agent`

If you deployed ManLab using the containerized topology (Aspire Docker hosting integration), the web dashboard container acts as a reverse proxy for `/api` and `/hubs`.

In that case, point installers at the **dashboard URL** (default: `http://<host>:8080`).

## Linux (`install.sh`)

- Installs to `/opt/manlab-agent`
- Creates a systemd unit: `manlab-agent.service`
- Writes environment to `/etc/manlab-agent.env`
- Writes/updates the installed config at `/opt/manlab-agent/appsettings.json` (includes `Agent:ServerUrl` and `Agent:AuthToken`)

Example:

- Dev (Aspire/manual server): `sudo ./scripts/install.sh --server http://localhost:5247 --token "YOUR_TOKEN"`
- Containerized (dashboard proxy): `sudo ./scripts/install.sh --server http://localhost:8080 --token "YOUR_TOKEN"`

After install:

- `systemctl status manlab-agent`
- `journalctl -u manlab-agent -f`

Uninstall / cleanup (removes systemd unit, env file, and install directory):

- `sudo ./scripts/install.sh --uninstall`

#### Forcing GitHub Releases (manual install)

You can force the installer to prefer GitHub releases:

- Flags: `--prefer-github --github-release-base-url <url> --github-version <tag>`
- Or env vars:
  - `MANLAB_PREFER_GITHUB_DOWNLOAD=1`
  - `MANLAB_GITHUB_RELEASE_BASE_URL=...`
  - `MANLAB_GITHUB_VERSION=...`

## Windows (`install.ps1`)

### System Mode (Default, requires Admin)

- Installs to `C:\ProgramData\ManLab\Agent`
- Creates a Scheduled Task named `ManLab Agent` (runs as `SYSTEM` at startup)
  - Uses the built-in PowerShell **ScheduledTasks** module (Task Scheduler API)
- Writes/updates `appsettings.json` in the install directory (includes `Agent:ServerUrl` and `Agent:AuthToken`)
- Writes a config file `agent-config.json` (used by the runner) and logs to `agent.log`

Example (elevated PowerShell):

- Dev (Aspire/manual server): `./scripts/install.ps1 -Server http://localhost:5247 -AuthToken "YOUR_TOKEN" -Force`
- Containerized (dashboard proxy): `./scripts/install.ps1 -Server http://localhost:8080 -AuthToken "YOUR_TOKEN" -Force`

After install:

- Task Scheduler → Task Scheduler Library → **ManLab Agent**
- Logs: `C:\ProgramData\ManLab\Agent\agent.log`

Uninstall / cleanup (removes Scheduled Task and deletes install directory):

- `./scripts/install.ps1 -Uninstall`

#### Forcing GitHub Releases (manual install)

You can force the installer to prefer GitHub releases:

- Parameters: `-PreferGitHub -GitHubReleaseBaseUrl <url> -GitHubVersion <tag>`
- Or env vars:
  - `MANLAB_PREFER_GITHUB_DOWNLOAD=true`
  - `MANLAB_GITHUB_RELEASE_BASE_URL=...`
  - `MANLAB_GITHUB_VERSION=...`

### User Mode (No Admin Required)

Use `-UserMode` to install without administrator privileges:

- Installs to `%LOCALAPPDATA%\ManLab\Agent` (e.g., `C:\Users\<username>\AppData\Local\ManLab\Agent`)
- Attempts to create a Scheduled Task that runs as the current user on logon
- If Task Scheduler creation is blocked by policy for standard users, falls back to a per-user autostart entry (HKCU `...\Run`)
- Agent only runs when you are logged in

Example (no elevation required):

- Dev (Aspire/manual server): `./scripts/install.ps1 -Server http://localhost:5247 -AuthToken "YOUR_TOKEN" -UserMode`
- Containerized (dashboard proxy): `./scripts/install.ps1 -Server http://localhost:8080 -AuthToken "YOUR_TOKEN" -UserMode`

After install:

- Task Scheduler → Task Scheduler Library → **ManLab Agent**
- Logs: `%LOCALAPPDATA%\ManLab\Agent\agent.log`

Uninstall user mode installation:

- `./scripts/install.ps1 -Uninstall -UserMode`

### Web UI Installation

You can also install/uninstall the local agent from the ManLab web dashboard. The dashboard offers two installation modes:

- **System Install**: Requires the server to run with administrator privileges. Agent runs as SYSTEM at startup.
- **User Install**: No admin required. Agent runs as your user on logon.

## SSH onboarding transport (server-side)

For the **zero-config bootstrap via SSH**, the server uses an **embedded SSH library** (`Renci.SshNet`, a.k.a. SSH.NET) in `src/ManLab.Server/Services/Ssh/SshProvisioningService.cs`.

The same SSH provisioning flow can also run the installer scripts in **uninstall mode** to remove and clean up the agent from a connected target.

Why this approach (vs spawning `ssh`/`scp` binaries):

- **Pros:** works cross-platform from the ASP.NET server, no dependency on external binaries, easier to stream progress and enforce host-key policy.
- **Cons:** the server must handle SSH behaviors itself (auth modes, host key verification, quoting/escaping), and Windows targets must have **OpenSSH Server** enabled.
