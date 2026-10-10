#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 server. Run as root. Safe to run again.
# From your computer:
#   scp deploy/setup-server.sh root@<server-ip>:
#   ssh root@<server-ip> 'DOMAIN=news.example.com ADMIN_EMAIL=you@example.com GHA_PUBKEY="ssh-ed25519 AAAA..." bash setup-server.sh'
# The first run stops after printing a deploy key: add it to the GitHub repo, then run the same command again.
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=news.example.com}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL (admin login and HTTPS certificate notices)}"
REPO=${REPO:-git@github.com:venkimani1120/jaathiya-vaarthalu.git}
APP=/srv/jaathiya-vaarthalu   # must match cwd in deploy/pm2.config.js and the paths in deploy/nginx.conf
U=jv                          # the app runs as this user, never as root
HOME_U=/home/$U
as_u() { runuser -l "$U" -c "$1"; }

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

echo "== Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl git nginx sqlite3 poppler-utils ufw certbot python3-certbot-nginx
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

echo "== App user"
id "$U" >/dev/null 2>&1 || useradd -m -s /bin/bash "$U"
install -d -m 700 -o "$U" -g "$U" "$HOME_U/.ssh"
touch "$HOME_U/.ssh/authorized_keys"
if [ -n "${GHA_PUBKEY:-}" ] && ! grep -qF "$GHA_PUBKEY" "$HOME_U/.ssh/authorized_keys"; then
  echo "$GHA_PUBKEY" >> "$HOME_U/.ssh/authorized_keys"
fi
chmod 600 "$HOME_U/.ssh/authorized_keys"

# Read-only key that lets this server pull the private repo from GitHub
if [ ! -f "$HOME_U/.ssh/github_deploy" ]; then
  ssh-keygen -t ed25519 -N "" -C "$U@$DOMAIN deploy" -f "$HOME_U/.ssh/github_deploy" >/dev/null
  printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' > "$HOME_U/.ssh/config"
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null > "$HOME_U/.ssh/known_hosts"
chown -R "$U:$U" "$HOME_U/.ssh"

echo "== Code"
if [ ! -d "$APP/.git" ]; then
  install -d -o "$U" -g "$U" "$APP"
  if ! as_u "git clone -q '$REPO' '$APP'"; then
    echo
    echo "Could not clone the repo. Add this key on GitHub: repo Settings > Deploy keys > Add deploy key (leave write access off):"
    echo
    cat "$HOME_U/.ssh/github_deploy.pub"
    echo
    echo "Then run this script again with the same command."
    exit 1
  fi
fi

echo "== .env"
NEW_PASSWORD=""
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  NEW_PASSWORD=$(openssl rand -base64 18)
  setenv() { sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; }
  setenv NODE_ENV production
  setenv SITE_URL "https://$DOMAIN"
  setenv SESSION_SECRET "$(openssl rand -hex 32)"
  setenv ADMIN_EMAIL "$ADMIN_EMAIL"
  setenv ADMIN_PASSWORD "$NEW_PASSWORD"
  chown "$U:$U" "$APP/.env"
  chmod 600 "$APP/.env"
fi

echo "== Install, seed, start"
as_u "cd '$APP' && npm ci --omit=dev --no-audit --no-fund && npm run seed"
as_u "cd '$APP' && pm2 startOrReload deploy/pm2.config.js && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$U" --hp "$HOME_U" >/dev/null

echo "== Nginx"
sed "s/your-domain.example/$DOMAIN/g" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/jaathiya-vaarthalu
ln -sf /etc/nginx/sites-available/jaathiya-vaarthalu /etc/nginx/sites-enabled/jaathiya-vaarthalu
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "== HTTPS"
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect; then
  echo "HTTPS not set up yet: point the domain's DNS A record at this server, then run this script again."
fi

echo "== Nightly backup"
install -d -o "$U" -g "$U" /var/backups/jaathiya-vaarthalu
touch /var/log/jv-backup.log && chown "$U:$U" /var/log/jv-backup.log
CRON="30 2 * * * $APP/deploy/backup.sh >> /var/log/jv-backup.log 2>&1"
( crontab -u "$U" -l 2>/dev/null | grep -vF "deploy/backup.sh"; echo "$CRON" ) | crontab -u "$U" -

echo
echo "Done. Site: https://$DOMAIN   Admin: https://$DOMAIN/admin"
if [ -n "$NEW_PASSWORD" ]; then
  echo "Admin login: $ADMIN_EMAIL / $NEW_PASSWORD"
  echo "Write it down and change it after the first login. Then remove ADMIN_PASSWORD from $APP/.env."
fi
