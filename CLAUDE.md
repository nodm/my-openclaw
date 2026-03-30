# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Personal OpenClaw deployment config — not a source code project. Manages deployment docs, agent workspace seed files, infrastructure-as-code, and server config templates for an AI assistant running on Hetzner with Vercel AI Gateway.

## Repository layout

- `openclaw.json` — Gateway config (agents, channels, bindings). Uses JSON5 with `${ENV_VAR}` interpolation from server `.env`.
- `workspace/` — Source of truth for `main` + `cron` agent runtime files. Synced one-way to server via rsync.
- `workspace-honey/` — Source of truth for `honey` agent. Same structure, synced separately.
- `server/docker-compose.yml` — Template; lives at `/root/docker-compose.yml` on server.
- `server/.env.example` — Template for server-side `.env` (never committed).
- `infra/` — Pulumi IaC (TypeScript). Provisions Hetzner CPX22, volume, firewall.
- `docs/` — Architecture, deployment, access/sync guides.

## Common operations

```bash
# Sync your workspace to server
rsync -av --delete --exclude '.env' --exclude 'sessions/' \
  workspace/ root@<serverIp>:/root/.openclaw/workspace/

# Sync honey's workspace
rsync -av --delete --exclude '.env' --exclude 'sessions/' \
  workspace-honey/ root@<serverIp>:/root/.openclaw/workspace-honey/

# Push gateway config and restart
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "cd /root && docker compose restart"

# Force-recreate (required after .env changes)
ssh root@<serverIp> "cd /root && docker compose up -d --force-recreate"

# View logs
ssh root@<serverIp> "docker compose logs -f --tail=100"

# Open Control UI (SSH tunnel)
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
# Then: http://localhost:18789
```

## Infrastructure (Pulumi)

```bash
cd infra && pnpm install
pulumi up          # provision/update
pulumi stack output serverIp
```

Hetzner CPX22, hel1, Ubuntu 24.04. 10 GB volume at `/root/.openclaw`. Firewall: SSH (22) only inbound.

## Agent topology

Three agents in one Docker container (`ghcr.io/openclaw/openclaw:latest`):

| Agent | Workspace | Model tier | Purpose |
|-------|-----------|------------|---------|
| `main` | `workspace/` | `MODEL_INTERACTIVE` | Your personal assistant |
| `honey` | `workspace-honey/` | `MODEL_INTERACTIVE` | Partner's assistant |
| `cron` | `workspace/` (shared) | `MODEL_SIMPLE` | Background scheduler |

Agents are session-isolated — `honey` cannot see your `MEMORY.md`, `USER.md`, or history.

## Channel routing

Bindings in `openclaw.json` map Telegram/WhatsApp/Discord DMs to agents by sender ID. `dmPolicy: "pairing"` requires explicit approval for new senders. Gateway port 18789 is never publicly exposed.

## Workspace file roles

| File | Author | Role |
|------|--------|------|
| `USER.md` | Human | Personal context injected into every prompt |
| `AGENTS.md` | Human | Agent roster / tool config |
| `MEMORY.md` | Agent | Persistent memory (agent-written at runtime on server) |
| `HEARTBEAT.md` | Human | Daily cron trigger prompt |
| `skills/routing/SKILL.md` | Human | Autonomous model-tier escalation logic |

`MEMORY.md` is overwritten by rsync — only edit locally if intentionally resetting agent memory.

## Model tiers

Set in server `.env`, interpolated into `openclaw.json`:

| Var | Current model | Use case |
|-----|---------------|----------|
| `MODEL_INTERACTIVE` | gemini-2.5-flash | All user chat |
| `MODEL_MEDIUM` | claude-sonnet-4-6 | Research, code, multi-step |
| `MODEL_REASONING` | gemini-2.5-pro | Math, architecture, deep debug |
| `MODEL_SIMPLE` | gemini-2.5-flash-lite | Cron heartbeat |

Swapping a model: edit `.env` on server, then `docker compose up -d --force-recreate`.

## Conventions

- Commits: [Conventional Commits](https://www.conventionalcommits.org/) — `feat`, `fix`, `docs`, `chore`, `refactor`
- Secrets: `.env` lives only on server at `/root/.openclaw/.env` — never commit
- Config format: `openclaw.json` is JSON5 with `${VAR}` env interpolation
