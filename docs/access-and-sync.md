# Access and Sync

How to reach the OpenClaw Control UI from your Mac and keep workspace files in sync.

---

## Accessing the Control UI

The gateway binds to `127.0.0.1:18789` on the server (never exposed publicly). Access it via SSH tunnel.

### Option A — Manual tunnel (ad-hoc)

```bash
ssh -N -L 18789:127.0.0.1:18789 root@<serverIp>
```

Then open `http://localhost:18789`. Kill with `Ctrl-C` when done.

### Option B — autossh (persistent, reconnects automatically)

```bash
brew install autossh

# Run once (add to ~/.zshrc or a launchd plist for auto-start)
autossh -M 0 -f -N \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -L 18789:127.0.0.1:18789 \
  root@<serverIp>
```

To persist across Mac reboots, create a launchd plist:

```xml
<!-- ~/Library/LaunchAgents/com.openclaw.tunnel.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/autossh</string>
    <string>-M</string><string>0</string>
    <string>-N</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-L</string><string>18789:127.0.0.1:18789</string>
    <string>root@REPLACE_SERVER_IP</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

```bash
# Load it
launchctl load ~/Library/LaunchAgents/com.openclaw.tunnel.plist
```

### Option C — Tailscale (zero-config VPN)

```bash
# On your Mac
brew install tailscale && open -a Tailscale

# On the server (one-time)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey <YOUR_TAILSCALE_AUTHKEY>
```

Once connected, replace `<serverIp>` everywhere with the Tailscale IP (stable even if public IP changes). Access the UI via the Tailscale IP directly: `http://<tailscale-ip>:18789` — no tunnel needed if you add port 18789 to UFW for the Tailscale subnet.

---

## Syncing workspace files

The `workspace/` directory in this repo is the single source of truth for everything under `/root/.openclaw/workspace/` on the server. Secrets (`.env`) and runtime data (`sessions/`) live on the server only and are never synced back.

### One-way push (Mac → Server)

```bash
SERVER=root@<serverIp>

rsync -av --delete \
  --exclude '.env' \
  --exclude 'sessions/' \
  workspace/ \
  $SERVER:/root/.openclaw/workspace/
```

Add `-n` (dry-run) first if you want to preview changes.

### What stays on the server only

| Path | Why |
|------|-----|
| `/root/.openclaw/.env` | Contains secrets — never commit or sync back |
| `/root/.openclaw/sessions/` | Runtime session state |
| `/root/.openclaw/openclaw.json` | Deployed config; update manually via `scp` |

### Convenience alias

Add to `~/.zshrc`:

```bash
alias openclaw-sync='rsync -av --delete \
  --exclude ".env" --exclude "sessions/" \
  ~/Projects/GitHub/my-open-claw/workspace/ \
  root@<serverIp>:/root/.openclaw/workspace/'
```

---

## Updating openclaw.json on the server

```bash
scp openclaw.json root@<serverIp>:/root/.openclaw/openclaw.json
ssh root@<serverIp> "cd /root && docker compose restart"
```
