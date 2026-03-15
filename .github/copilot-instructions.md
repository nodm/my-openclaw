# Copilot Instructions

This repository is a **personal OpenClaw deployment configuration** — not a source code project. It manages deployment docs, agent workspace seed files, and server config templates for an AI assistant running on Hetzner with Vercel AI Gateway.

## What lives where

- `docs/` — Architecture, deployment, and access/sync guides. Read these before making changes.
- `workspace/` — **Source of truth** for agent runtime files. Synced one-way to the server via rsync. Never contains secrets.
- `server/.env.example` — Template for the server-side `.env` (never commit the real `.env`).
- `server/docker-compose.yml` — Template; copy to `/root/docker-compose.yml` on the server.
- `openclaw.json` — Gateway config (agents, channels, bindings). Deployed manually via `scp` then `docker compose restart`.
- `infra/` — Pulumi IaC (TypeScript/Node). Not yet in this repo snapshot; provisions Hetzner server, volume, and firewall.

## Deployment workflows

**Sync workspace to server** (the most common operation):
```bash
rsync -av --delete \
  --exclude '.env' --exclude 'sessions/' \
  workspace/ root@<serverIp>:/root/.openclaw/workspace/
```

**Push gateway config and restart:**
```bash
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "cd /root && docker compose restart"
```

**Open the Control UI** (port never exposed publicly — SSH tunnel required):
```bash
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
open http://localhost:18789
```

**View logs / rebuild:**
```bash
ssh root@<serverIp> "docker compose logs -f --tail=100"
ssh root@<serverIp> "cd /root && docker compose build --no-cache && docker compose up -d"
```

## Architecture overview

Three agents run in Docker on a Hetzner CX22 (Ubuntu 24.04, hel1):

| Agent id | Who | Workspace | Model |
|----------|-----|-----------|-------|
| `main` | You (nodm) | `workspace/` | `MODEL_INTERACTIVE` |
| `honey` | Your partner | `workspace-honey/` | `MODEL_INTERACTIVE` |
| `cron` | Background scheduler | `workspace/` (shared) | `MODEL_SIMPLE` |

Session isolation means `honey` has no access to your `MEMORY.md`, `USER.md`, or conversation history, and vice versa.

Inbound messages arrive via **Vercel AI Gateway** (outbound-initiated webhook from Telegram/WhatsApp) — the gateway port `18789` is never exposed publicly.

**Model tiers** (set in server `.env`, injected into `openclaw.json`):
| Var | Model | Use case |
|-----|-------|----------|
| `MODEL_INTERACTIVE` | Claude Sonnet 4.6 | All user chat ($3/1M tok) |
| `MODEL_MEDIUM` | DeepSeek v3.2 | Research, code, multi-step ($0.14/1M tok) |
| `MODEL_REASONING` | DeepSeek v3.2-thinking | Math, architecture, deep debug ($0.55/1M tok) |
| `MODEL_SIMPLE` | Gemini 2.5 Flash Lite | Cron heartbeat ($0.01/1M tok) |

## Workspace file conventions

Each file in `workspace/` has a specific runtime role:

| File | Written by | Purpose |
|------|-----------|---------|
| `USER.md` | Human | Personal context fed to every agent prompt |
| `AGENTS.md` | Human | Roster of agents the main agent can spawn |
| `MEMORY.md` | Agent | Persistent memory updated by the agent at runtime |
| `HEARTBEAT.md` | Human | Daily cron trigger prompt |
| `skills/routing/SKILL.md` | Human | Autonomous model-selection logic |

`workspace-honey/` mirrors the same structure for the `honey` agent — edit and rsync separately using the same rsync command with `workspace-honey/` as the source and `/root/.openclaw/workspace-honey/` as the destination.

`MEMORY.md` is written by the agent at runtime on the server — edits here will be overwritten by the next rsync unless intentional.

## Secrets rule

The `.env` file lives **only on the server** at `/root/.openclaw/.env`. It is `.gitignore`d and must never be committed. Use `server/.env.example` as the template when reprovisioning.

| Key | What |
|-----|------|
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (`vai-…`) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `OPENCLAW_GATEWAY_TOKEN` | Random 32-byte hex (`openssl rand -hex 32`), auth for Control UI |
| `YOUR_TG_ID` / `HONEY_TG_ID` | Telegram user IDs (find via @userinfobot) |
| `YOUR_WHATSAPP_NUMBER` / `HONEY_WHATSAPP_NUMBER` | E.164 phone numbers |
| `MODEL_*` | Model slugs — not secret, but env-injected for easy swapping |

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

# Examples
docs(architecture): update agent topology diagram
feat(workspace): add routing skill stub
fix(server): correct env var name for gateway token
chore: update .gitignore
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`.

## Infrastructure

Provisioned via Pulumi (`infra/`, TypeScript/Node). Key facts:
- Hetzner CX22, region `hel1`
- 10 GB Hetzner Volume mounted at `/root/.openclaw`
- Firewall: inbound SSH (22) only; all other access via tunnel or Tailscale

**Convenience alias** (add to `~/.zshrc` for faster syncing):
```bash
alias openclaw-sync='rsync -av --delete \
  --exclude ".env" --exclude "sessions/" \
  ~/Projects/GitHub/my-open-claw/workspace/ \
  root@<serverIp>:/root/.openclaw/workspace/'
```
