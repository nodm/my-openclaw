# Access and Sync

How to reach the OpenClaw Control UI from your devices and keep workspace files in sync.

---

## Accessing the Control UI

The gateway binds to `127.0.0.1:18789` on the server (loopback only, never exposed publicly). Access it via Tailscale Serve.

### Tailscale Serve (recommended)

Tailscale Serve proxies `https://<hostname>.<tailnet>/` → `http://127.0.0.1:18789` with auto-TLS. Only devices on your tailnet can reach it.

**Server setup (one-time):**

```bash
ssh root@<serverIp>

# Join your tailnet (follow the auth URL)
tailscale up

# Expose gateway via Tailscale Serve
tailscale serve --bg 18789
```

**Access from any tailnet device:**

```
https://<hostname>.<tailnet>/
```

No tunnel, no port forwarding, works from Mac, phone, or any enrolled device.

### Fallback — SSH tunnel

If Tailscale is unavailable, you can still use an SSH tunnel:

```bash
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
```

Then open `http://localhost:18789`. Kill with `Ctrl-C` when done.

---

## Syncing workspace files

Both `workspace/` (yours) and `workspace-honey/` (honey's) are the source of truth for their respective agent workspaces. Sync them independently.

### One-way push (Mac → Server)

```bash
SERVER=root@<serverIp>

# Your workspace
rsync -av --delete \
  --exclude '.env' \
  --exclude 'sessions/' \
  workspace/ \
  $SERVER:/root/.openclaw/workspace/

# Honey's workspace
rsync -av --delete \
  --exclude '.env' \
  --exclude 'sessions/' \
  workspace-honey/ \
  $SERVER:/root/.openclaw/workspace-honey/
```

Add `-n` (dry-run) first if you want to preview changes.

### What stays on the server only

| Path | Why |
|------|-----|
| `/root/.openclaw/.env` | Contains secrets — never commit or sync back |
| `/root/.openclaw/agents/*/sessions/` | Runtime session state |
| `/root/.openclaw/credentials/` | WhatsApp QR session, pairing allowlists |

### Convenience aliases

Add to `~/.zshrc`:

```bash
alias openclaw-sync='rsync -av --delete \
  --exclude ".env" --exclude "sessions/" \
  ~/Projects/GitHub/my-open-claw/workspace/ \
  root@<serverIp>:/root/.openclaw/workspace/'

alias openclaw-sync-honey='rsync -av --delete \
  --exclude ".env" --exclude "sessions/" \
  ~/Projects/GitHub/my-open-claw/workspace-honey/ \
  root@<serverIp>:/root/.openclaw/workspace-honey/'
```

---

## Updating openclaw.json on the server

```bash
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "systemctl restart openclaw"
```
