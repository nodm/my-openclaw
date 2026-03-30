# Architecture

How the system fits together — components, data flows, agent topology, and config structure.

---

## System overview

```
┌─────────────────────────────────────────────────────────┐
│  Mac (your machine)                                      │
│                                                          │
│  VS Code / terminal          Control UI                  │
│  rsync workspace ──────────► https://<hostname>.<tailnet>│
│  scp openclaw.json           (via Tailscale Serve)       │
└──────────┬──────────────────────────────────────────────┘
           │ SSH / Tailscale
           ▼
┌─────────────────────────────────────────────────────────┐
│  Hetzner CPX22 — hel1  (root@<serverIp>)                 │
│                                                          │
│  systemd service: openclaw                              │
│  ├── gateway  →  127.0.0.1:18789 (loopback)             │
│  ├── Tailscale Serve  →  https://<hostname>.<tailnet>    │
│  ├── /root/.openclaw/openclaw.json    (config)           │
│  ├── /root/.openclaw/.env             (secrets)          │
│  ├── /root/.openclaw/workspace/       (you)              │
│  └── /root/.openclaw/workspace-honey/ (honey)            │
│                                                          │
│  10 GB Hetzner Volume → /root/.openclaw                  │
└──────────────────────┬──────────────────────────────────┘
                       │ outbound HTTPS
                       ▼
                  Google AI
                  └── Gemini 2.5 (Flash, Pro, Flash Lite)
```

Inbound channels (Telegram, WhatsApp) arrive as HTTPS webhooks / WebSocket maintained by the gateway. The gateway never has a public port — channels are outbound-initiated connections or Telegram long-polling.

---

## Agents

Two isolated agents, each with its own workspace and session store:

| Agent id | Who | Workspace | Model |
|----------|-----|-----------|-------|
| `main` | You (nodm) | `workspace/` | `MODEL_INTERACTIVE` |
| `honey` | Your partner | `workspace-honey/` | `MODEL_INTERACTIVE` |
| `cron` | Background scheduler | `workspace/` (shared) | `MODEL_SIMPLE` |

Session isolation means `honey` has no access to your `MEMORY.md`, `USER.md`, or conversation history, and vice versa.

---

## Channel routing

Inbound messages are routed to agents via `bindings` in `openclaw.json`. Unmatched senders are rejected (pairing mode) or blocked (allowlist).

```
Telegram DM → sender id ${YOUR_TG_ID}          ──► agent: main
Telegram DM → sender id ${HONEY_TG_ID}         ──► agent: honey
WhatsApp DM → ${YOUR_WHATSAPP_NUMBER}           ──► agent: main
WhatsApp DM → ${HONEY_WHATSAPP_NUMBER}          ──► agent: honey
Discord DM  → user id ${YOUR_DISCORD_ID}        ──► agent: main
cron trigger                                    ──► agent: cron
```

`dmPolicy: "pairing"` — first DM from an unknown sender generates a pairing code; explicit approval required before the agent responds.

---

## openclaw.json structure

```json5
{
  gateway: {
    mode: "local",
    controlUi: { allowedOrigins: ["http://localhost:18789", "https://*"] },
  },

  agents: {
    defaults: { workspace: "~/.openclaw/workspace" },
    list: [
      { id: "main",  model: "${MODEL_INTERACTIVE}", workspace: "~/.openclaw/workspace",       identity: { name: "Clawd",      emoji: "🦞" } },
      { id: "honey", model: "${MODEL_INTERACTIVE}", workspace: "~/.openclaw/workspace-honey/", identity: { name: "Clawd",      emoji: "🦞" } },
      { id: "cron",  model: "${MODEL_SIMPLE}",      workspace: "~/.openclaw/workspace",        identity: { name: "CronClawd",  emoji: "⏰" } },
    ],
  },

  bindings: [
    { match: { channel: "telegram", peer: { kind: "user", id: "${YOUR_TG_ID}" } },      agentId: "main" },
    { match: { channel: "telegram", peer: { kind: "user", id: "${HONEY_TG_ID}" } },     agentId: "honey" },
    { match: { channel: "whatsapp", peer: { kind: "user", id: "${YOUR_WHATSAPP_NUMBER}" } },  agentId: "main" },
    { match: { channel: "whatsapp", peer: { kind: "user", id: "${HONEY_WHATSAPP_NUMBER}" } }, agentId: "honey" },
    { match: { channel: "discord", peer: { kind: "dm",   id: "${YOUR_DISCORD_ID}" } },        agentId: "main" },
  ],

  channels: {
    telegram: {
      dmPolicy: "pairing",
      allowFrom: ["${YOUR_TG_ID}", "${HONEY_TG_ID}"],
    },
    whatsapp: {
      dmPolicy: "pairing",
      allowFrom: ["${YOUR_WHATSAPP_NUMBER}", "${HONEY_WHATSAPP_NUMBER}"],
    },
    discord: {
      dmPolicy: "pairing",
      allowFrom: ["${YOUR_DISCORD_ID}"],
      token: "${DISCORD_BOT_TOKEN}",
    },
  },
}
```

---

## Model tiers

Models are injected from `.env` — swapping a tier requires an env change + `systemctl restart openclaw`.

| Env var | Model | When |
|---------|-------|------|
| `MODEL_INTERACTIVE` | `google/gemini-2.5-flash` | All user chat |
| `MODEL_MEDIUM` | `google/gemini-2.5-flash` | Research, code, multi-step |
| `MODEL_REASONING` | `google/gemini-2.5-pro` | Math, architecture, deep debug |
| `MODEL_SIMPLE` | `google/gemini-2.5-flash-lite` | Cron heartbeat |

The routing skill (`workspace/skills/routing/SKILL.md`) instructs the agent when to escalate to `MODEL_MEDIUM` or `MODEL_REASONING` autonomously.

---

## Workspace layout

```
workspace/                    # you (agent: main, cron)
  USER.md                     # personal context — edit before first sync
  AGENTS.md                   # agent roster / tool config
  MEMORY.md                   # persistent memory, agent-written at runtime
  HEARTBEAT.md                # daily cron prompt
  skills/routing/SKILL.md     # autonomous model-tier routing logic

workspace-honey/              # honey (agent: honey)
  USER.md                     # her personal context
  AGENTS.md
  MEMORY.md
```

Source of truth: this repo. Deployed to server via rsync (one-way, Mac → server). See [access-and-sync.md](access-and-sync.md).

---

## Infrastructure

Provisioned by Pulumi (`infra/`):

| Resource | Value |
|----------|-------|
| Server | Hetzner CPX22, hel1 |
| OS | Ubuntu 24.04 |
| Volume | 10 GB, mounted at `/root/.openclaw` |
| Firewall | SSH (22) inbound only; all outbound allowed |
| Bootstrap | `cloud-init.yaml` — installs OpenClaw (official installer), Tailscale |

The gateway port (18789) is **never open on the firewall**. Access only via Tailscale Serve. See [access-and-sync.md](access-and-sync.md).

---

## Secrets

All secrets live exclusively in `/root/.openclaw/.env` on the server. Never committed, never synced back.

| Key | What |
|-----|------|
| `GEMINI_API_KEY` | Google AI API key (from AI Studio or GCP console) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `OPENCLAW_GATEWAY_TOKEN` | Random 32-byte hex, auth for Control UI |
| `GOG_KEYRING_PASSWORD` | Random 32-byte hex, encrypts credential store (WhatsApp session etc.) |
| `YOUR_TG_ID` / `HONEY_TG_ID` | Telegram user IDs (find via @userinfobot) |
| `YOUR_WHATSAPP_NUMBER` / `HONEY_WHATSAPP_NUMBER` | E.164 phone numbers |
| `MODEL_*` | Model slugs (not secret, but env-injected for easy swapping) |

Template: `server/.env.example`.
