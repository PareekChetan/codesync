#!/usr/bin/env bash
# One-command deploy for a fresh Ubuntu 22.04 / 24.04 server.
#
#   bash deploy.sh                    # first deploy, or redeploy after `git pull`
#   DOMAIN=code.example.com bash deploy.sh
#
# What it does:
#   1. Installs Docker if missing.
#   2. Adds swap on small machines (compiling the images needs memory).
#   3. Creates .env with strong random secrets (only the first time).
#   4. Builds and starts everything, with Caddy serving HTTPS on your domain.
#      No domain? It uses <your-ip>.sslip.io, a free hostname that points at your IP.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "${USER:-root}" || true
fi

# 2. Swap (only if the machine has under ~3 GB RAM and no swap yet)
MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
if [ "$MEM_KB" -lt 3000000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB swap (small machine)"
  $SUDO fallocate -l 2G /swapfile && $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile && $SUDO swapon /swapfile
  echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

# 3. Secrets and domain (kept across redeploys)
if [ ! -f .env ]; then
  PUBLIC_IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
  DOMAIN=${DOMAIN:-"$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"}
  say "Creating .env for https://$DOMAIN"
  cat > .env <<EOF
DOMAIN=$DOMAIN
PUBLIC_URL=https://$DOMAIN
WEB_BIND=127.0.0.1:8080
TRUST_PROXY=2
JWT_SECRET=$(openssl rand -hex 32)
RUNNER_TOKEN=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
EOF
  chmod 600 .env
fi
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)

# 4. Build and start
say "Building and starting (first time takes 5-15 minutes)"
$SUDO docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

say "Waiting for the site to come up"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "https://$DOMAIN/" 2>/dev/null; then
    say "Live at https://$DOMAIN"
    exit 0
  fi
  sleep 5
done
echo "Started, but https://$DOMAIN isn't answering yet."
echo "Check: ports 80 and 443 open in your cloud firewall, then run:"
echo "  sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs caddy"
