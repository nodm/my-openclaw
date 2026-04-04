# my-open-claw

Personal OpenClaw deployment — Hetzner CPX22 (hel1), Google AI (Gemini), Telegram + Discord.

## Docs

| | |
|---|---|
| [Architecture](docs/architecture.md) | Components, agent topology, channel routing, config structure |
| [Deployment](docs/deployment.md) | Provision infra, configure gateway, launch stack |
| [Access & Sync](docs/access-and-sync.md) | Tailscale Serve, SSH tunnel fallback, rsync workspace |

## Quick reference

```bash
# Full provision (first time or reprovisioning)
cd infra && pulumi up

# Sync workspace to server (day-to-day)
rsync -av --delete \
  --exclude '.env' --exclude 'sessions/' \
  workspace/ root@<serverIp>:/root/.openclaw/workspace/

# Push config and restart
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "openclaw daemon restart"

# Open Control UI (via Tailscale — no tunnel needed)
# https://<hostname>.<tailnet>/

# Fallback — SSH tunnel
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
open http://localhost:18789
```
