# ManLab Agent Installation

This repo includes simple installation scripts for the **ManLab Agent** that:

- Detect OS/architecture (RID)
- Download the staged Native AOT agent binary from the ManLab Server’s Binary API
- Configure `MANLAB_SERVER_URL` (SignalR hub) and optional `MANLAB_AUTH_TOKEN`
- Register the agent to run automatically at boot (systemd on Linux, Task Scheduler on Windows)

## Prerequisites

1. The ManLab Server is running and reachable.
2. The server has staged agent binaries for your RID under:

- `GET /api/binaries/agent` (lists available RIDs)
- `GET /api/binaries/agent/{rid}` (downloads `manlab-agent` or `manlab-agent.exe`)

## Linux (`install.sh`)

- Installs to `/opt/manlab-agent`
- Creates a systemd unit: `manlab-agent.service`
- Writes environment to `/etc/manlab-agent.env`

Example:

- `sudo ./scripts/install.sh --server http://localhost:5247 --token "YOUR_TOKEN"`

After install:

- `systemctl status manlab-agent`
- `journalctl -u manlab-agent -f`

Uninstall / cleanup (removes systemd unit, env file, and install directory):

- `sudo ./scripts/install.sh --uninstall`

## Windows (`install.ps1`)

### System Mode (Default, requires Admin)

- Installs to `C:\ProgramData\ManLab\Agent`
- Creates a Scheduled Task named `ManLab Agent` (runs as `SYSTEM` at startup)
  - Uses the built-in PowerShell **ScheduledTasks** module (Task Scheduler API)
- Writes a config file `agent-config.json` and logs to `agent.log`

Example (elevated PowerShell):

- `./scripts/install.ps1 -Server http://localhost:5247 -AuthToken "YOUR_TOKEN" -Force`

After install:

- Task Scheduler → Task Scheduler Library → **ManLab Agent**
- Logs: `C:\ProgramData\ManLab\Agent\agent.log`

Uninstall / cleanup (removes Scheduled Task and deletes install directory):

- `./scripts/install.ps1 -Uninstall`

### User Mode (No Admin Required)

Use `-UserMode` to install without administrator privileges:

- Installs to `%LOCALAPPDATA%\ManLab\Agent` (e.g., `C:\Users\<username>\AppData\Local\ManLab\Agent`)
- Attempts to create a Scheduled Task that runs as the current user on logon
- If Task Scheduler creation is blocked by policy for standard users, falls back to a per-user autostart entry (HKCU `...\Run`)
- Agent only runs when you are logged in

Example (no elevation required):

- `./scripts/install.ps1 -Server http://localhost:5247 -AuthToken "YOUR_TOKEN" -UserMode`

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
