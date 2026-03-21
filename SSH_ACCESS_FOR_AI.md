# SSH Access Guide (for another AI to connect to the server)

This document describes how to set up SSH key–based access so another AI agent can log in to the server and run commands.

## Target server

- Host: `89.191.226.213`
- Username: `root`
- Port: `22` (default)
- Project path on server: `/var/www/plat3/hh`
- Systemd service (if installed): `hh-autopilot`

## Security notes (important)

1. Use SSH keys (recommended). Do not share passwords.
2. Keep the private key secret. Do not commit it into your repo.
3. Restrict access to the minimum set of actions possible (ideally separate user accounts). Since your current setup uses `root`, access is full.

## Step A — Create an SSH key (on the AI machine)

Run (PowerShell or any terminal with `ssh-keygen` available):

```bash
ssh-keygen -t ed25519 -a 100 -C "ai-ssh" -f "%USERPROFILE%/.ssh/id_ed25519_ai"
```

You will get:

- Private key: `%USERPROFILE%/.ssh/id_ed25519_ai` (keep secret)
- Public key: `%USERPROFILE%/.ssh/id_ed25519_ai.pub` (copy to the server)

## Step B — Add the public key to the server (`authorized_keys`)

Log into the server once using your current access method (where you can run commands as `root`).

Then run on the server:

```bash
mkdir -p /root/.ssh
chmod 700 /root/.ssh
```

Append the AI public key to:

```bash
/root/.ssh/authorized_keys
```

Example (manual append). Replace `PASTE_PUBLIC_KEY_HERE` with the contents of `id_ed25519_ai.pub`:

```bash
echo "PASTE_PUBLIC_KEY_HERE" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

## Step C — (Optional) Verify permissions

On the server:

```bash
ls -ld /root /root/.ssh /root/.ssh/authorized_keys
```

You want:

- `/root/.ssh` permissions: `700`
- `/root/.ssh/authorized_keys` permissions: `600`

## Step D — Test SSH login (from the AI machine)

From the AI machine, test:

```bash
ssh -i "%USERPROFILE%/.ssh/id_ed25519_ai" -o IdentitiesOnly=yes root@89.191.226.213
```

Useful quick checks after login:

```bash
uname -a
ls -la /var/www/plat3/hh
```

## Step E — Useful server commands for your HH AutoPilot

Restart service (if systemd unit exists):

```bash
systemctl restart hh-autopilot
systemctl status hh-autopilot --no-pager
```

Logs:

```bash
journalctl -u hh-autopilot -n 200 --no-pager
```

Run project manually (fallback if systemd is not present):

```bash
cd /var/www/plat3/hh/api
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001
```

## Common SSH troubleshooting

1. **Connection refused**: verify firewall / port 22 is open.
2. **Permission denied (publickey)**: wrong key added to `authorized_keys`, or key permissions are too open.
3. **Host key verification failed**: the AI machine does not trust the server yet. The safest workflow is to verify the server fingerprint out-of-band, then add it to `known_hosts`.

## What to share with the other AI (minimal)

Share only:

- Server host/port/username: `89.191.226.213:22` as `root`
- Private key file location/path on the AI machine (keep it secret)
- The command to connect via `ssh -i ...`

Do NOT share:

- HH.ru credentials / any app secrets
- Any sensitive tokens stored in your repo

