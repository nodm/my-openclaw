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
  index.ts             # SshKey + Firewall + Volume + Server + VolumeAttachment
  cloud-init.yaml      # OpenClaw (via official installer), Tailscale, UFW

server/
  .env.example         # Template — copy to server at /root/.openclaw/.env (fill secrets)

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
```

## Step 2 — Provision infrastructure

```bash
pulumi up
```

Note outputs:
```
serverIp          = <IPv4>
volumeLinuxDevice = /dev/disk/by-id/scsi-0HC_Volume_<id>
```

## Step 3 — Verify server and mount volume

```bash
ssh root@<serverIp>
openclaw --version            # should show installed version
cat /root/bootstrap.log       # check for errors

# Mount Hetzner volume (one-time — use volumeLinuxDevice from pulumi output)
VOLUME_DEV=<volumeLinuxDevice>   # e.g. /dev/disk/by-id/scsi-0HC_Volume_12345678
mount "$VOLUME_DEV" /root/.openclaw
echo "$VOLUME_DEV /root/.openclaw ext4 defaults,nofail 0 2" >> /etc/fstab

# Create directory structure and fix ownership for openclaw user
mkdir -p /root/.openclaw/workspace /root/.openclaw/workspace-honey
chown -R openclaw:openclaw /root/.openclaw

# Verify
df -h /root/.openclaw         # should show 10G volume mounted
```

## Step 4 — Google AI API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) or GCP console → APIs & Services → Credentials.
2. Create an API key (linked to your GCP project for billing).
3. Verify: `curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"` — should return a model list.

## Step 5 — Review openclaw.json

The `openclaw.json` in the repo root is ready to use. All sensitive values are injected from `.env` via `${VAR}` substitution.

Sync it to the server (covered in Step 7).

## Step 6 — Rsync workspace files

From your Mac:

```bash
SERVER=root@<serverIp>

rsync -av --delete \
  --exclude '.env' \
  --exclude 'sessions/' \
  workspace/ \
  $SERVER:/root/.openclaw/workspace/

# Fix ownership after every rsync
ssh $SERVER 'chown -R openclaw:openclaw /root/.openclaw'
```

## Step 7 — Server .env and openclaw.json

SSH in and create the `.env` file:

```bash
ssh root@<serverIp>

# .env — fill in real values
cp /dev/stdin /root/.openclaw/.env << 'EOF'
GEMINI_API_KEY=REPLACE_ME
TELEGRAM_BOT_TOKEN=REPLACE_ME
OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
GOG_KEYRING_PASSWORD=$(openssl rand -hex 32)
YOUR_TG_ID=REPLACE_ME
HONEY_TG_ID=REPLACE_ME
YOUR_WHATSAPP_NUMBER=REPLACE_ME
HONEY_WHATSAPP_NUMBER=REPLACE_ME
OPENCLAW_GATEWAY_BIND=loopback
MODEL_INTERACTIVE=google/gemini-2.5-flash
MODEL_MEDIUM=google/gemini-2.5-flash
MODEL_REASONING=google/gemini-2.5-pro
MODEL_SIMPLE=google/gemini-2.5-flash-lite
EOF
chmod 600 /root/.openclaw/.env

# openclaw.json
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
```

## Step 8 — Onboard, Tailscale, and start

```bash
ssh root@<serverIp>

# Run OpenClaw onboarding (creates systemd service)
openclaw onboard --install-daemon

# Join your tailnet (follow the auth URL)
tailscale up

# Expose gateway via Tailscale Serve (HTTPS, tailnet-only)
tailscale serve --bg 18789

# Start OpenClaw
systemctl start openclaw
journalctl -u openclaw -f      # watch for "[gateway] listening on ws://127.0.0.1:18789"
```

## Step 9 — Configure routing skill

The `workspace/skills/routing/SKILL.md` was already synced in Step 6.
Verify it landed on the server:

```bash
cat /root/.openclaw/workspace/skills/routing/SKILL.md
```

Clawd will load this skill automatically on next session start.

## Step 10 — Workspace seed files

Also synced in Step 6. Edit `workspace/USER.md` on your Mac with your personal context, then re-run the rsync command from Step 6.

## Step 11 — Connect and verify

Open `https://<hostname>.<tailnet>/` from any device on your tailnet — the Control UI should load.

Or just message your Telegram bot — it should respond via Google AI.

---

## Ongoing operations

### Restart after config change

```bash
ssh root@<serverIp>
systemctl restart openclaw     # for openclaw.json or .env changes
```

### Update OpenClaw version

```bash
ssh root@<serverIp>
curl -fsSL https://openclaw.ai/install.sh | bash
systemctl restart openclaw
```

### Swap a model tier

Edit `.env` on server, then restart:

```bash
ssh root@<serverIp>
# edit /root/.openclaw/.env
systemctl restart openclaw
```

Also update the slugs in `workspace/skills/routing/SKILL.md` and re-rsync if you change `MODEL_MEDIUM` or `MODEL_REASONING`.

### View logs

```bash
journalctl -u openclaw -f -n 100
```
