# Agent Coworking Space Deployment Guide

This directory contains production deployment examples for a single-host Linux setup.

Included files:

- `deploy/production.env.template`: runtime environment template
- `deploy/agent-coworking-space@.service`: example user-level systemd service
- `deploy/agent-coworking-space-backup.service`: one-shot runtime backup service
- `deploy/agent-coworking-space-backup.timer`: daily backup timer
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
cp deploy/production.env.template deploy/.env.production
```

Set at minimum:

- `OAUTH_ENCRYPTION_SECRET`
- `INBOX_WEBHOOK_SECRET`
- `API_AUTH_TOKEN` for non-loopback access
- `OAUTH_BASE_URL` if the public URL differs from `http://127.0.0.1:8790`

If you run behind nginx on the same host, keep:

- `HOST=127.0.0.1`
- `PORT=8790`
- `PUBLIC_API_DOCS=false`

For production, prefer proxy-only access: keep the Node service bound to loopback and expose only nginx/Tailscale/Cloudflare Tunnel. If you expose the Node server directly on a LAN or VPN, set `HOST=0.0.0.0`, require `API_AUTH_TOKEN`, and review `ALLOWED_ORIGINS` or `ALLOWED_ORIGIN_SUFFIXES`.

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

## 4. Install daily backup

```bash
mkdir -p ~/.config/systemd/user
cp deploy/agent-coworking-space-backup.service ~/.config/systemd/user/
cp deploy/agent-coworking-space-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now agent-coworking-space-backup.timer
```

Manual backup:

```bash
pnpm run backup:runtime
```

Backups are written to `BACKUP_DIR` and pruned by `BACKUP_RETENTION_DAYS`.

## 5. Seed Hermes workflow tasks

After Hermes is connected and the three real projects are registered in Office Manager, seed the read-only verification tasks:

```bash
pnpm run hermes:seed-workflows
```

To create and immediately start them:

```bash
pnpm run hermes:seed-workflows -- --run
```

If a project is not yet registered, provide its path before seeding:

```bash
EXPANDLY_PROJECT_PATH=/home/ubuntu/projects/expandly \
ARCH_VIZ_PROJECT_PATH=/home/ubuntu/projects/architecture-visualization \
NEXAQUANT_PROJECT_PATH=/home/ubuntu/projects/nexaquant \
pnpm run hermes:seed-workflows
```

The seed command is idempotent and skips existing matching tasks.

## 6. Optional nginx reverse proxy

```bash
sudo cp deploy/nginx/agent-coworking-space.conf /etc/nginx/sites-available/agent-coworking-space
sudo ln -s /etc/nginx/sites-available/agent-coworking-space /etc/nginx/sites-enabled/agent-coworking-space
sudo nginx -t
sudo systemctl reload nginx
```

Update `server_name` before enabling the site. If you use Let's Encrypt, install the certificate after the site is reachable.

## 7. Smoke checks

Local health check:

```bash
curl http://127.0.0.1:8790/api/health
```

Authenticated remote check:

```bash
curl -H "Authorization: Bearer YOUR_API_AUTH_TOKEN" https://agent.example.com/api/health
```

Direct port check should fail from outside the host when proxy-only hardening is active:

```bash
curl --connect-timeout 5 http://YOUR_PUBLIC_IP:8790/api/health
```

## 8. Updating

```bash
git pull
pnpm install
pnpm run build
systemctl --user restart agent-coworking-space
pnpm run backup:runtime
```

## Notes

- `deploy/.env.production` is a local runtime file and should stay untracked.
- The service example writes logs to `./logs`.
- The template is intentionally conservative. Add provider-specific keys only if you use those integrations.
