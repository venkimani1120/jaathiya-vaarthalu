#!/usr/bin/env bash
# Update the server to the latest main and restart the site with no downtime.
# GitHub Actions runs this over SSH as the app user; it also works by hand:
#   ssh jv@<server-ip> 'bash /srv/jaathiya-vaarthalu/deploy/deploy.sh'
# .env, data/ and uploads/ are git-ignored, so the reset never touches them.
# Everything is inside main() so bash reads the whole script before git replaces this file.
set -euo pipefail

main() {
  cd /srv/jaathiya-vaarthalu
  git fetch -q origin main
  git reset -q --hard origin/main
  npm ci --omit=dev --no-audit --no-fund
  pm2 startOrReload deploy/pm2.config.js --update-env
  pm2 save

  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
      echo "Deployed $(git log -1 --format='%h %s')"
      exit 0
    fi
    sleep 2
  done
  echo "Site did not respond after the restart. Check: pm2 logs jaathiya-vaarthalu"
  exit 1
}

main "$@"
