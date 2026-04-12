# Troubleshooting

How to diagnose and fix issues with the OpenClaw deployment on Hetzner.

---

## Quick health check

Run these in order. Each step narrows the problem.

```bash
SERVER=<serverIp>

# 1. Is the process alive?
ssh root@$SERVER "ps aux | grep openclaw-gateway | grep -v grep"

# 2. Can the CLI reach the gateway?
ssh root@$SERVER "openclaw logs --follow" # Ctrl-C after a few seconds

# 3. Are cron jobs scheduled?
ssh root@$SERVER "openclaw cron status"

# 4. Is Tailscale connected? (needed for Control UI + inbound webhooks)
ssh root@$SERVER "tailscale status"

# 5. Is Tailscale Serve proxying port 18789?
ssh root@$SERVER "tailscale serve status"
```

If step 1 shows nothing, the gateway is dead — jump to [Gateway is down](#gateway-is-down).
If step 2 fails with "Gateway not reachable", same thing.
If step 3 shows `nextWakeAtMs` in the past but no run happened, the scheduler stalled — restart the daemon.

---

## Gateway is down

### Symptoms

- No response from bot in Telegram/Discord.
- `openclaw logs` returns "Gateway not reachable".
- `ps aux | grep openclaw-gateway` returns nothing.
- Cron jobs (news digest, weather) stop firing.

### Why it happens

The gateway is a single Node.js process (`openclaw-gateway`). It can crash from:

- **Unhandled API errors** — a transient Gemini API failure during a cron job or user message that isn't caught internally.
- **Out of memory** — CPX22 has 4 GB RAM. A runaway session with very large context can exhaust it. Check with `dmesg | grep -i oom`.
- **Disk full** — session logs and SQLite WAL files grow over time. Check with `df -h`.
- **OpenClaw bug** — new versions installed via `openclaw doctor --fix` can introduce regressions.

### How to diagnose

```bash
# Check kernel OOM killer (most common silent crash cause)
ssh root@$SERVER "dmesg | grep -i 'oom\|killed process' | tail -10"

# Check disk space
ssh root@$SERVER "df -h /"

# Check systemd journal (if the service is registered)
ssh root@$SERVER "journalctl -u openclaw-gateway --since '1 hour ago' --no-pager 2>/dev/null | tail -50"

# If journalctl is empty, the service may not have systemd integration.
# Check if the process left a core dump or error in syslog:
ssh root@$SERVER "grep -i openclaw /var/log/syslog | tail -20"
```

### How to fix

```bash
# Restart the daemon
ssh root@$SERVER "openclaw daemon restart"

# Verify it's running
ssh root@$SERVER "ps aux | grep openclaw-gateway | grep -v grep"

# Verify the gateway is reachable
ssh root@$SERVER "openclaw cron status"
```

### Preventing future crashes

The `openclaw gateway install` command creates a user-level systemd service at `~/.config/systemd/user/openclaw-gateway.service` with `Restart=always`. To verify:

```bash
ssh root@$SERVER "export XDG_RUNTIME_DIR=/run/user/0 && systemctl --user show openclaw-gateway --property=Restart,RestartSec"
```

If the service unit doesn't exist at all, re-register it:

```bash
ssh root@$SERVER "set -a && source /root/.openclaw/.env && set +a && OPENCLAW_NO_RESPAWN=1 openclaw gateway install --force && export XDG_RUNTIME_DIR=/run/user/0 && systemctl --user daemon-reload && systemctl --user restart openclaw-gateway"
```

> **Critical: always pass `OPENCLAW_NO_RESPAWN=1`** when running `openclaw gateway install`. See [Dual-respawn crash loop](#dual-respawn-crash-loop) below.

---

## Dual-respawn crash loop

### Symptoms

- Gateway process restarts every 10–30 seconds.
- Logs show repeated `signal SIGTERM received` / `received SIGTERM; shutting down` entries with rapidly incrementing PIDs.
- Discord errors like `You are being rate limited` (429) from command registration on every restart.
- Bot appears online briefly, then drops.

### Why it happens

OpenClaw has a **built-in process respawner** that automatically restarts the gateway when it dies. Systemd's `Restart=always` does the same thing. When both are active, they race: each detects the other's instance, sends SIGTERM to kill it, and spawns its own — creating an infinite restart loop.

The env var `OPENCLAW_NO_RESPAWN=1` disables OpenClaw's internal respawner, letting systemd handle restarts exclusively. The Pulumi provisioning script passes this correctly during initial setup. But if you later run `openclaw gateway install --force` **without** the env var set, the regenerated service file drops `OPENCLAW_NO_RESPAWN=1`, reactivating the built-in respawner.

### How to diagnose

```bash
# Check if the service file has OPENCLAW_NO_RESPAWN
ssh root@$SERVER "grep OPENCLAW_NO_RESPAWN ~/.config/systemd/user/openclaw-gateway.service"

# Count SIGTERM events in today's log (more than 2–3 = crash loop)
ssh root@$SERVER "grep -c 'signal SIGTERM' /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"

# Count distinct PIDs spawned today
ssh root@$SERVER "grep DEP0040 /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep -o '(node:[0-9]*)' | sort -u | wc -l"
```

### How to fix

```bash
# Add the missing env var to the service file
ssh root@$SERVER "sed -i '/\[Service\]/a Environment=OPENCLAW_NO_RESPAWN=1' ~/.config/systemd/user/openclaw-gateway.service"

# Reload and restart
ssh root@$SERVER "export XDG_RUNTIME_DIR=/run/user/0 && systemctl --user daemon-reload && openclaw daemon restart"
```

### Preventing recurrence

Always reinstall with the env var set:

```bash
ssh root@$SERVER "set -a && source /root/.openclaw/.env && set +a && OPENCLAW_NO_RESPAWN=1 openclaw gateway install --force && export XDG_RUNTIME_DIR=/run/user/0 && systemctl --user daemon-reload && systemctl --user restart openclaw-gateway"
```

---

## Service unit embeds secrets

### Symptoms

- `openclaw doctor` reports: `Gateway service embeds OPENCLAW_GATEWAY_TOKEN and should be reinstalled`.
- `~/.config/systemd/user/openclaw-gateway.service` contains many `Environment=` lines with API keys/tokens.

### Why it happens

Some OpenClaw install/repair flows generate a user systemd unit with inlined env vars. That bakes secrets into the unit file and can leave the daemon in a "non-standard" config state.

### How to fix

```bash
# Rewrite the service to use EnvironmentFile instead of inlined secrets
ssh root@$SERVER "cat > /root/.config/systemd/user/openclaw-gateway.service <<'EOF'
[Unit]
Description=OpenClaw Gateway (hardened)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=-/root/.openclaw/.env
Environment=OPENCLAW_NO_RESPAWN=1
Environment=OPENCLAW_GATEWAY_BIND=loopback
Environment=OPENCLAW_GATEWAY_PORT=18789
Environment=HOME=/root
Environment=TMPDIR=/tmp
Environment=PATH=/usr/bin:/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.volta/bin:/root/.asdf/shims:/root/.bun/bin:/root/.nvm/current/bin:/root/.fnm/current/bin:/root/.local/share/pnpm:/usr/local/bin:/bin
ExecStart=/usr/bin/node /usr/lib/node_modules/openclaw/dist/index.js gateway --port 18789
Restart=always
RestartSec=5
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
KillMode=control-group

[Install]
WantedBy=default.target
EOF
export XDG_RUNTIME_DIR=/run/user/0
systemctl --user daemon-reload
systemctl --user restart openclaw-gateway
openclaw daemon status"
```

### Verify

```bash
ssh root@$SERVER "grep OPENCLAW_GATEWAY_TOKEN /root/.config/systemd/user/openclaw-gateway.service || echo 'token not embedded'"
ssh root@$SERVER "openclaw doctor"
```

---

## Cron job didn't fire

### Symptoms

- No morning news digest or weather forecast in Telegram.
- `openclaw cron status` shows `nextWakeAtMs` in the past.

### Why it happens

- **Gateway crashed** before the scheduled time — the scheduler runs inside the gateway process, so if the process is dead, nothing fires. This is the most common cause.
- **Timezone mismatch** — jobs use `Europe/Vilnius` (UTC+2 winter / UTC+3 summer). If the server clock drifts or the timezone data is stale, the schedule shifts.
- **Job disabled** — someone (or the agent itself) disabled the job.

### How to diagnose

```bash
# List all jobs with their state
ssh root@$SERVER "openclaw cron list"

# Check a specific job's run history (substitute the job ID)
ssh root@$SERVER "openclaw cron runs --id <job-id>"

# Check the raw job file for schedule and state
ssh root@$SERVER "cat /root/.openclaw/cron/jobs.json"
```

Key fields in `jobs.json` → `state`:

| Field | Meaning |
|-------|---------|
| `nextRunAtMs` | When the scheduler will next fire this job (epoch ms). Convert: `date -r $((ms / 1000))` |
| `lastRunAtMs` | When it last ran |
| `lastRunStatus` | `ok` or `error` |
| `consecutiveErrors` | If > 0, the job is failing repeatedly |
| `lastDelivered` | Whether the result was sent to Telegram |

### How to fix

```bash
# Manually trigger the job now
ssh root@$SERVER "openclaw cron run <job-id>"

# If it says "already-running", wait and retry, or restart:
ssh root@$SERVER "openclaw daemon restart"
sleep 5
ssh root@$SERVER "openclaw cron run <job-id>"
```

### Finding job IDs

```bash
# List jobs with IDs and names
ssh root@$SERVER "cat /root/.openclaw/cron/jobs.json | grep -E '\"id\"|\"name\"'"
```

Current jobs:

| Name | ID |
|------|----|
| Daily News Digest | `0ab21f0c-d0e9-4c79-bfd7-d383da6de549` |
| Daily weather forecast for Vilnius | `1b643af9-7374-461c-8a8c-588e3713db8b` |

---

## Message not delivered to Telegram

### Symptoms

- Cron job ran (visible in `openclaw cron runs --id <job-id>`) with `status: "ok"`, but `delivered: false` or `deliveryStatus` is not `"delivered"`.
- Or the run entry doesn't exist at all.

### Why it happens

- **Telegram Bot API outage** — rare but possible.
- **Bot token expired or revoked** — check with @BotFather.
- **Delivery queue stuck** — messages queue in `/root/.openclaw/delivery-queue/` and failed ones land in `delivery-queue/failed/`.

### How to diagnose

```bash
# Check for failed deliveries
ssh root@$SERVER "ls -la /root/.openclaw/delivery-queue/failed/"
ssh root@$SERVER "cat /root/.openclaw/delivery-queue/failed/* 2>/dev/null"

# Check the specific job's last run
ssh root@$SERVER "openclaw cron runs --id <job-id> --limit 1"

# Test Telegram connectivity directly
ssh root@$SERVER 'source /root/.openclaw/.env && curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"'
```

---

## Server filesystem layout

Knowing where things live is half the battle. All paths are under `/root/.openclaw/`:

```
/root/.openclaw/
├── .env                    # Secrets (API keys, tokens). chmod 600.
├── openclaw.json           # Gateway config (agents, channels, bindings)
├── openclaw.json.bak       # Previous config (auto-backup on write)
│
├── workspace/              # main + cron agent files (synced from repo)
│   ├── USER.md
│   ├── AGENTS.md
│   ├── MEMORY.md           # Written by agent at runtime
│   ├── HEARTBEAT.md
│   └── skills/routing/SKILL.md
│
├── workspace-honey/        # honey agent files (synced separately)
│
├── cron/
│   ├── jobs.json           # Job definitions + schedule state
│   ├── jobs.json.bak       # Previous jobs (auto-backup)
│   └── runs/               # Run history (one .jsonl per job ID)
│       └── <job-id>.jsonl
│
├── delivery-queue/
│   └── failed/             # Messages that failed to send
│
├── logs/
│   ├── commands.log        # CLI command invocations
│   ├── config-audit.jsonl  # Config file change audit trail
│   └── config-health.json  # Config integrity tracking
│
├── tasks/
│   └── runs.sqlite         # Task execution history (SQLite)
│
├── agents/                 # Agent runtime state
├── devices/                # Device registry (Control UI sessions)
├── flows/                  # Conversation flow state
├── identity/               # Agent identity config
├── telegram/               # Telegram adapter state
└── canvas/                 # Canvas/UI state
```

### Why each directory matters for troubleshooting

- **`cron/`** — First place to look when scheduled tasks don't fire. `jobs.json` has the schedule and `runs/` has the execution history with full output summaries.
- **`delivery-queue/failed/`** — If a cron job ran but the user didn't receive the message, check here.
- **`logs/`** — Sparse. OpenClaw doesn't log verbosely to disk by default. Most useful for config change auditing.
- **`tasks/runs.sqlite`** — Contains task execution records. Query with `sqlite3` if needed.
- **`.env`** — If API calls fail, verify keys here: `ssh root@$SERVER "grep GEMINI_API_KEY /root/.openclaw/.env"` (redact when sharing).

---

## Useful CLI commands

```bash
# Gateway
openclaw logs --follow              # Live log stream (requires running gateway)
openclaw doctor                     # Health check
openclaw doctor --fix               # Auto-fix + update

# Daemon
openclaw daemon start               # Start the gateway process
openclaw daemon restart             # Restart (required after .env changes)
openclaw gateway install --force    # Register/refresh systemd service

# Cron
openclaw cron list                  # List all jobs
openclaw cron status                # Scheduler state + next wake time
openclaw cron runs --id <id>        # Run history for a job
openclaw cron run <id>              # Force-run a job now
openclaw cron enable <id>           # Re-enable a disabled job
openclaw cron disable <id>          # Disable a job

# Devices
openclaw devices list               # List connected devices (Control UI)
openclaw devices approve --latest   # Approve latest device
```

---

## Common timestamp conversions

Timestamps in `jobs.json` and run logs are **epoch milliseconds**. Convert them:

```bash
# macOS
date -r $((1775451600000 / 1000))

# Linux (on server)
date -d @$((1775451600000 / 1000))

# In the other direction — current time as epoch ms:
echo $(($(date +%s) * 1000))
```

---

## Recovering from a full crash

If the server was rebooted or the process died and won't start:

```bash
# 1. SSH in
ssh root@$SERVER

# 2. Check basics
df -h /                      # Disk space
free -h                      # Memory
dmesg | tail -20             # Kernel messages (OOM, segfault)

# 3. Re-source env and start
set -a && source /root/.openclaw/.env && set +a
openclaw daemon restart

# 4. If daemon command fails, start manually (foreground, for debugging)
cd /root/.openclaw
openclaw gateway --port 18789

# 5. Verify
openclaw cron status
openclaw devices list

# 6. Re-run missed cron jobs
openclaw cron run <job-id>
```

---

## When to escalate

- **Repeated crashes** with no OOM or disk issue → likely an OpenClaw bug. Check the version with `openclaw --version` and compare with [release notes](https://docs.openclaw.ai).
- **Config corruption** → `openclaw.json.bak` is the previous known-good config. Restore with `cp openclaw.json.bak openclaw.json && openclaw daemon restart`.
- **Gemini API errors** → Check [Google AI status](https://status.cloud.google.com/) and verify the API key hasn't been revoked in the GCP console.
