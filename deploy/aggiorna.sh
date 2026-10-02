#!/usr/bin/env bash
# Aggiorna il portale all'ultima versione su GitHub.
# Uso:  sudo bash /opt/portale-zoffoli/deploy/aggiorna.sh
set -euo pipefail
cd /opt/portale-zoffoli
git pull --ff-only
cd server
npm install --omit=dev --no-audit --no-fund
cp /opt/portale-zoffoli/deploy/portale-zoffoli.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart portale-zoffoli
echo "✔ Portale aggiornato."
