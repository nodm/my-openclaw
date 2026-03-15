# Deployment Guide

OpenClaw on Hetzner CPX22 (hel1) with Vercel AI Gateway and tiered model routing.

## Model tier reference

| Env var | Slug | Use case | ~Cost |
|---------|------|----------|-------|
| `MODEL_INTERACTIVE` | `vercel-ai-gateway/anthropic/claude-sonnet-4.6` | Main agent — all user chat | $3/1M tok |
| `MODEL_MEDIUM` | `vercel-ai-gateway/deepseek/deepseek-v3.2` | Research, code, multi-step | $0.14/1M tok |
| `MODEL_REASONING` | `vercel-ai-gateway/deepseek/deepseek-v3.2-thinking` | Math, architecture, deep debug | $0.55/1M tok |
| `MODEL_SIMPLE` | `vercel-ai-gateway/google/gemini-2.5-flash-lite` | Cron heartbeat | $0.01/1M tok |

## Project layout

```
infra/
  Pulumi.yaml          # Pulumi project (pnpm, nodejs runtime)
  package.json
  tsconfig.json
  index.ts             # SshKey + Firewall + Volume + Server + VolumeAttachment
  cloud-init.yaml      # Docker, UFW, image pull, mount point

server/
  docker-compose.yml   # Template — copy to server at /root/docker-compose.yml
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
docker info                   # should succeed
cat /root/bootstrap.log       # check for errors

# Mount Hetzner volume (one-time — use volumeLinuxDevice from pulumi output)
VOLUME_DEV=<volumeLinuxDevice>   # e.g. /dev/disk/by-id/scsi-0HC_Volume_12345678
mount "$VOLUME_DEV" /root/.openclaw
echo "$VOLUME_DEV /root/.openclaw ext4 defaults,nofail 0 2" >> /etc/fstab

# Create directory structure and fix ownership for container user (uid 1000)
mkdir -p /root/.openclaw/workspace /root/.openclaw/workspace-honey
chown -R 1000:1000 /root/.openclaw

# Verify
df -h /root/.openclaw         # should show 10G volume mounted
```

## Step 4 — Vercel AI Gateway

1. Go to [vercel.com/ai-gateway](https://vercel.com/ai-gateway).
2. Create a new API key — copy the `vai-…` value.
3. Confirm these models are available in the catalog:
   - `deepseek/deepseek-v3.2`
   - `deepseek/deepseek-v3.2-thinking`
   - `google/gemini-2.5-flash-lite`
   - `anthropic/claude-sonnet-4.6`

## Step 5 — Review openclaw.json

The `openclaw.json` in the repo root is ready to use. Open it and replace the placeholder comments if needed — all sensitive values are injected from `.env` via `${VAR}` substitution.

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

# Fix ownership after every rsync (container runs as uid 1000)
ssh $SERVER 'chown -R 1000:1000 /root/.openclaw'
```

## Step 7 — Server .env and docker-compose.yml

SSH in and create the files:

```bash
ssh root@<serverIp>

# .env — fill in real values
cp /dev/stdin /root/.openclaw/.env << 'EOF'
AI_GATEWAY_API_KEY=vai-REPLACE_ME
TELEGRAM_BOT_TOKEN=REPLACE_ME
OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
GOG_KEYRING_PASSWORD=$(openssl rand -hex 32)
YOUR_TG_ID=REPLACE_ME
HONEY_TG_ID=REPLACE_ME
YOUR_WHATSAPP_NUMBER=REPLACE_ME
HONEY_WHATSAPP_NUMBER=REPLACE_ME
MODEL_INTERACTIVE=vercel-ai-gateway/anthropic/claude-sonnet-4.6
MODEL_MEDIUM=vercel-ai-gateway/deepseek/deepseek-v3.2
MODEL_REASONING=vercel-ai-gateway/deepseek/deepseek-v3.2-thinking
MODEL_SIMPLE=vercel-ai-gateway/google/gemini-2.5-flash-lite
EOF
chmod 600 /root/.openclaw/.env

# openclaw.json
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json

# docker-compose.yml
scp server/docker-compose.yml root@<serverIp>:/root/docker-compose.yml
```

## Step 8 — Build and launch

```bash
ssh root@<serverIp>
cd /root
docker compose pull               # pull latest image (~1 min)
docker compose up -d
docker compose logs -f            # watch for "[gateway] listening on ws://127.0.0.1:18789"
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

```bash
# Open SSH tunnel (keep running — or use autossh, see docs/access-and-sync.md)
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp> &

# Open Control UI
open http://localhost:18789
```

Or just message your Telegram bot — it should respond via Vercel AI Gateway.

---

## Ongoing operations

### Restart after config change

```bash
ssh root@<serverIp>
cd /root && docker compose restart   # for openclaw.json changes

# For .env changes, restart alone is NOT enough — must recreate:
cd /root && docker compose up -d --force-recreate
```

### Update OpenClaw version

```bash
ssh root@<serverIp>
docker compose pull
docker compose up -d
```

### Swap a model tier

Edit `/root/.openclaw/.env` on the server, then restart:

```bash
docker compose restart
```

Also update the hardcoded slugs in `workspace/skills/routing/SKILL.md` and re-rsync.

### View logs

```bash
docker compose logs -f --tail=100
```
