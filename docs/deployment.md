# Deployment Guide

OpenClaw on Hetzner CPX22 (hel1) with Google AI (Gemini) and tiered model routing.

## Model tier reference

| Env var | Slug | Use case | ~Cost |
|---------|------|----------|-------|
| `MODEL_INTERACTIVE` | `google/gemini-2.5-flash` | Main agent — all user chat | $0.15/1M tok |
| `MODEL_MEDIUM` | `google/gemini-2.5-flash` | Research, code, multi-step | $0.15/1M tok |
| `MODEL_REASONING` | `google/gemini-2.5-pro` | Math, architecture, deep debug | $1.25/1M tok |
| `MODEL_SIMPLE` | `google/gemini-2.5-flash-lite` | Cron heartbeat | $0.015/1M tok |

## Project layout

```
infra/
  Pulumi.yaml          # Pulumi project (pnpm, nodejs runtime)
  package.json
  tsconfig.json
  index.ts             # SshKey + Firewall + Server + post-provisioning automation
  cloud-init.yaml      # OpenClaw (via official installer), Tailscale, UFW

server/
  .env.example         # Template — fill and keep at repo root as .env (gitignored)

workspace/             # Agent: main (you)
  USER.md              # Personal context for Clawd
  AGENTS.md            # Agent roster
  MEMORY.md            # Persistent memory (agent-written)
  HEARTBEAT.md         # Daily cron prompt
  skills/routing/
    SKILL.md           # Autonomous model-routing logic

workspace-honey/       # Agent: honey (isolated)
  USER.md
  AGENTS.md
  MEMORY.md

openclaw.json          # Gateway config — agents, channels, bindings, model tiers
.env                   # Secrets — gitignored, read by pulumi up and copied to server
```

---

## Step 1 — Pulumi project setup

```bash
cd infra
pnpm install
pulumi login --local          # or 'pulumi login' for Pulumi Cloud
pulumi stack init prod        # if first time; use 'pulumi stack select prod' if stack exists
pulumi config set hcloud:token $HCLOUD_TOKEN --secret
pulumi config set sshPublicKey "$(cat ~/.ssh/id_ed25519.pub)"
pulumi config set tailscaleAuthKey "tskey-auth-..." --secret
```

Generate the Tailscale auth key at [Tailscale admin → Settings → Keys](https://login.tailscale.com/admin/settings/keys). Set it as **reusable**, no expiry.

## Step 2 — Prepare local .env

Copy `server/.env.example` to `.env` at the repo root and fill in all values:

```bash
cp server/.env.example .env
# edit .env with real secrets
```

This file is gitignored. `pulumi up` will `scp` it to the server automatically.

## Step 3 — Provision and configure everything

```bash
pulumi up
```

This does everything in one command:
1. Creates Hetzner SSH key, firewall, and CPX22 server
2. cloud-init installs OpenClaw, Tailscale, and UFW
3. Waits for cloud-init to complete
4. Uploads `.env`, `openclaw.json`, `workspace/`, and `workspace-honey/` to the server
5. Runs `tailscale up --authkey=...` (headless, no browser needed)
6. Enables Tailscale Serve on port 18789
7. Installs and starts the OpenClaw daemon (with correct model env vars and `OPENCLAW_NO_RESPAWN=1`)
8. Auto-approves the local gateway device and rotates its token with full operator scopes (required for cron jobs to work)

Note the output:
```
serverIp = <IPv4>
```

## Step 4 — Connect and verify

Open `https://<hostname>.<tailnet>/` from any device on your tailnet — the Control UI should load.

Or message your Telegram/Discord bot — it should respond immediately.

Check logs:

```bash
ssh root@<serverIp> "openclaw logs --follow"
```

---

## Ongoing operations

### Restart after config change

```bash
ssh root@<serverIp> "openclaw daemon restart"   # for openclaw.json or .env changes
```

### Update OpenClaw version

```bash
ssh root@<serverIp> "curl -fsSL https://openclaw.ai/install.sh | bash && openclaw daemon restart"
```

### Swap a model tier

Edit `.env` on server, then restart:

```bash
ssh root@<serverIp> "vi /root/.openclaw/.env"   # update MODEL_* value
ssh root@<serverIp> "openclaw daemon restart"
```

Also update the slugs in `workspace/skills/routing/SKILL.md` and re-rsync if you change `MODEL_MEDIUM` or `MODEL_REASONING`.

### View logs

```bash
openclaw logs --follow
```
