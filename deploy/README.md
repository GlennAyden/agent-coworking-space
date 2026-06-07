# Agent Coworking Space Deployment Guide

This directory contains production deployment examples for a single-host Linux setup.

Included files:

- `deploy/.env.production.template`: runtime environment template
- `deploy/agent-coworking-space@.service`: example user-level systemd service
- `deploy/nginx/agent-coworking-space.conf`: example nginx reverse proxy

## Assumptions

- Node.js 22 or newer
- pnpm 9 or newer
- Linux with `systemd`
- Optional: nginx for TLS termination and reverse proxying

## 1. Build the app

```bash
git clone https://github.com/GlennAyden/agent-coworking-space.git
cd agent-coworking-space
pnpm install
pnpm run build
```

## 2. Create the runtime env file

```bash
cp deploy/.env.production.template deploy/.env.production
```

Set at minimum:

- `OAUTH_ENCRYPTION_SECRET`
- `INBOX_WEBHOOK_SECRET`
- `API_AUTH_TOKEN` for non-loopback access
- `OAUTH_BASE_URL` if the public URL differs from `http://127.0.0.1:8790`

If you run behind nginx on the same host, keep:

- `HOST=127.0.0.1`
- `PORT=8790`

If you expose the Node server directly on a LAN or VPN, set `HOST=0.0.0.0` and review `ALLOWED_ORIGINS` or `ALLOWED_ORIGIN_SUFFIXES`.

## 3. Install the user service

```bash
mkdir -p ~/.config/systemd/user
cp deploy/agent-coworking-space@.service ~/.config/systemd/user/agent-coworking-space.service
systemctl --user daemon-reload
systemctl --user enable --now agent-coworking-space
```

If you want the service to survive logout:

```bash
sudo loginctl enable-linger "$USER"
```

Useful commands:

```bash
systemctl --user status agent-coworking-space
journalctl --user -u agent-coworking-space -f
```

## 4. Optional nginx reverse proxy

```bash
sudo cp deploy/nginx/agent-coworking-space.conf /etc/nginx/sites-available/agent-coworking-space
sudo ln -s /etc/nginx/sites-available/agent-coworking-space /etc/nginx/sites-enabled/agent-coworking-space
sudo nginx -t
sudo systemctl reload nginx
```

Update `server_name` before enabling the site. If you use Let's Encrypt, install the certificate after the site is reachable.

## 5. Smoke checks

Local health check:

```bash
curl http://127.0.0.1:8790/api/health
```

Authenticated remote check:

```bash
curl -H "Authorization: Bearer YOUR_API_AUTH_TOKEN" https://agent.example.com/api/health
```

## 6. Updating

```bash
git pull
pnpm install
pnpm run build
systemctl --user restart agent-coworking-space
```

## Notes

- `deploy/.env.production` is a local runtime file and should stay untracked.
- The service example writes logs to `./logs`.
- The template is intentionally conservative. Add provider-specific keys only if you use those integrations.
