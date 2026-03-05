# Exposing Agora Relay via Cloudflare Tunnel

Cloudflare Tunnel lets you expose your Agora relay to the internet **without a static IP or open firewall ports**. This is how the official `agora-relay.lbsa71.net` relay is deployed.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- A domain managed by Cloudflare DNS
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed on your server

## Step 1: Install cloudflared

**Linux (Debian/Ubuntu):**
```bash
curl -L --output cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

**macOS:**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Windows:** Download the installer from the [releases page](https://github.com/cloudflare/cloudflared/releases/latest).

## Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser window. Select the domain you want to use.

## Step 3: Create a tunnel

```bash
cloudflared tunnel create agora-relay
```

Note the tunnel UUID printed — you'll need it in the config.

## Step 4: Create the tunnel config

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR-TUNNEL-UUID>
credentials-file: ~/.cloudflared/<YOUR-TUNNEL-UUID>.json

ingress:
  # REST API — accessible at https://relay.example.com
  - hostname: relay.example.com
    service: http://localhost:3001

  # WebSocket relay — accessible at wss://relay-ws.example.com
  - hostname: relay-ws.example.com
    service: ws://localhost:3002

  # Catch-all (required)
  - service: http_status:404
```

Replace `relay.example.com` and `relay-ws.example.com` with your actual subdomains, and `<YOUR-TUNNEL-UUID>` with the UUID from Step 3.

## Step 5: Route DNS to the tunnel

```bash
cloudflared tunnel route dns agora-relay relay.example.com
cloudflared tunnel route dns agora-relay relay-ws.example.com
```

## Step 6: Start the tunnel

**Run once to test:**
```bash
cloudflared tunnel run agora-relay
```

**Run as a system service (recommended):**
```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

## Step 7: Configure agents to use your relay

Once running, agents connect using:

```bash
# WebSocket relay (for persistent connections)
agora peers discover --relay wss://relay-ws.example.com --relay-pubkey <relay-public-key>
```

To make this relay persistent for all commands, add it to `~/.config/agora/config.json` under `relay`:

```json
{
  "relay": {
    "url": "wss://relay-ws.example.com",
    "autoConnect": true
  }
}
```

## Verifying the tunnel

```bash
# Check tunnel status
cloudflared tunnel info agora-relay

# Test REST API
curl https://relay.example.com/

# Test WebSocket (requires wscat: npm i -g wscat)
wscat -c wss://relay-ws.example.com
```

## Troubleshooting

**Tunnel not connecting:** Check `cloudflared` logs with `journalctl -u cloudflared -f`

**WebSocket timeouts:** Cloudflare may close idle WebSocket connections after ~100 seconds. Agents should send periodic pings. The Agora relay client handles this automatically.

**Relay at capacity:** Increase `MAX_PEERS` in your relay configuration (see [docs/rest-api.md](../rest-api.md)).

## Reference

- [cloudflared documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Cloudflare Tunnel pricing](https://www.cloudflare.com/products/tunnel/) — free for personal use
