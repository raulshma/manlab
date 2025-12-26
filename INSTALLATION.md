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

- Installs to `C:\ProgramData\ManLab\Agent`
- Creates a Scheduled Task named `ManLab Agent` (runs as `SYSTEM` at startup)
- Writes a config file `agent-config.json` and logs to `agent.log`

Example (elevated PowerShell):

- `./scripts/install.ps1 -Server http://localhost:5247 -AuthToken "YOUR_TOKEN" -Force`

After install:

- Task Scheduler → Task Scheduler Library → **ManLab Agent**
- Logs: `C:\ProgramData\ManLab\Agent\agent.log`

Uninstall / cleanup (removes Scheduled Task and deletes install directory):

- `./scripts/install.ps1 -Uninstall`

## SSH onboarding transport (server-side)

For the **zero-config bootstrap via SSH**, the server uses an **embedded SSH library** (`Renci.SshNet`, a.k.a. SSH.NET) in `src/ManLab.Server/Services/Ssh/SshProvisioningService.cs`.

The same SSH provisioning flow can also run the installer scripts in **uninstall mode** to remove and clean up the agent from a connected target.

Why this approach (vs spawning `ssh`/`scp` binaries):

- **Pros:** works cross-platform from the ASP.NET server, no dependency on external binaries, easier to stream progress and enforce host-key policy.
- **Cons:** the server must handle SSH behaviors itself (auth modes, host key verification, quoting/escaping), and Windows targets must have **OpenSSH Server** enabled.
