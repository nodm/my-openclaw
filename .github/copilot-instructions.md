# Copilot Instructions

This repository is a **personal OpenClaw deployment configuration** — not a source code project. It manages deployment docs, agent workspace seed files, and server config templates for an AI assistant running on Hetzner with Google AI (Gemini).

## What lives where

- `docs/` — Architecture, deployment, and access/sync guides. Read these before making changes.
- `workspace/` — **Source of truth** for agent runtime files. Synced one-way to the server via rsync. Never contains secrets.
- `server/.env.example` — Template for the server-side `.env` (copy to `.env` at repo root before `pulumi up`). Never commit the real `.env`.
- `openclaw.json` — Gateway config (agents, channels, bindings). Uploaded to server automatically by `pulumi up`, or manually via `scp`.
- `infra/` — Pulumi IaC (TypeScript/Node). Provisions Hetzner server, volume, and firewall.

## Deployment workflows

**Full provision from scratch** (`pulumi up` does everything automatically):
```bash
# One-time Pulumi secrets setup
cd infra
pulumi config set hcloud:token $HCLOUD_TOKEN --secret
pulumi config set sshPublicKey "$(cat ~/.ssh/id_ed25519.pub)"
pulumi config set tailscaleAuthKey "tskey-auth-..." --secret
# Fill .env at repo root, then:
pulumi up
```

`pulumi up` provisions the server, installs OpenClaw + Tailscale, uploads `.env` / `openclaw.json` / workspaces, and starts the daemon — no manual SSH steps needed.

**Sync workspace to server** (the most common day-to-day operation):
```bash
rsync -av --delete \
  --exclude '.env' --exclude 'sessions/' \
  workspace/ root@<serverIp>:/root/.openclaw/workspace/
```

**Push gateway config and restart:**
```bash
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "openclaw daemon restart"
```

**Open the Control UI** (via Tailscale — no tunnel needed):
```
https://<hostname>.<tailnet>/
```

**View logs / restart:**
```bash
ssh root@<serverIp> "openclaw logs --follow"
ssh root@<serverIp> "openclaw daemon restart"
```

## Architecture overview

Three agents run as a systemd-managed Node.js process on a Hetzner CPX22 (Ubuntu 24.04, hel1):

| Agent id | Who | Workspace | Model |
|----------|-----|-----------|-------|
| `main` | You (nodm) | `workspace/` | `MODEL_INTERACTIVE` |
| `honey` | Your partner | `workspace-honey/` | `MODEL_INTERACTIVE` |
| `cron` | Background scheduler | `workspace/` (shared) | `MODEL_SIMPLE` |

Session isolation means `honey` has no access to your `MEMORY.md`, `USER.md`, or conversation history, and vice versa.

Inbound messages arrive via outbound-initiated webhook from Telegram/WhatsApp/Discord — the gateway port `18789` binds to loopback only, accessed via Tailscale Serve.

**Model tiers** (set in server `.env`, injected into `openclaw.json`):
| Var | Model | Use case |
|-----|-------|----------|
| `MODEL_INTERACTIVE` | Gemini 2.5 Flash | All user chat ($0.15/1M tok) |
| `MODEL_MEDIUM` | Gemini 2.5 Flash | Research, code, multi-step ($0.15/1M tok) |
| `MODEL_REASONING` | Gemini 2.5 Pro | Math, architecture, deep debug ($1.25/1M tok) |
| `MODEL_SIMPLE` | Gemini 2.5 Flash Lite | Cron heartbeat ($0.015/1M tok) |

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
| `GEMINI_API_KEY` | Google AI API key (from GCP console) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `OPENCLAW_GATEWAY_TOKEN` | Random 32-byte hex (`openssl rand -hex 32`), auth for Control UI |
| `YOUR_TG_ID` / `HONEY_TG_ID` | Telegram user IDs (find via @userinfobot) |
| `YOUR_WHATSAPP_NUMBER` / `HONEY_WHATSAPP_NUMBER` | E.164 phone numbers |
| `DISCORD_BOT_TOKEN` | Discord bot token from Developer Portal |
| `YOUR_DISCORD_ID` / `DISCORD_SERVER_ID` | Discord user/server IDs (enable Developer Mode to copy) |
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
- Hetzner CPX22, region `hel1`
- Firewall: inbound SSH (22) only; access via Tailscale Serve

**Convenience alias** (add to `~/.zshrc` for faster syncing):
```bash
alias openclaw-sync='rsync -av --delete \
  --exclude ".env" --exclude "sessions/" \
  ~/Projects/GitHub/my-open-claw/workspace/ \
  root@<serverIp>:/root/.openclaw/workspace/'
```
