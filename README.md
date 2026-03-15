# my-open-claw

Personal OpenClaw deployment — Hetzner CX22 (hel1), Vercel AI Gateway, Telegram.

## Docs

| | |
|---|---|
| [Architecture](docs/architecture.md) | Components, agent topology, channel routing, config structure |
| [Deployment](docs/deployment.md) | Provision infra, configure gateway, launch stack |
| [Access & Sync](docs/access-and-sync.md) | SSH tunnel, autossh, Tailscale, rsync workspace |

## Quick reference

```bash
# Sync workspace to server
rsync -av --delete \
  --exclude '.env' --exclude 'sessions/' \
  workspace/ root@<serverIp>:/root/.openclaw/workspace/

# Push config and restart
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "cd /root && docker compose restart"

# Open UI (manual tunnel)
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
open http://localhost:18789
```
