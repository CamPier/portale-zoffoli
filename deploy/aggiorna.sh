#!/usr/bin/env bash
# Aggiorna il portale all'ultima versione su GitHub.
# Uso:  sudo bash /opt/portale-zoffoli/deploy/aggiorna.sh
set -euo pipefail
cd /opt/portale-zoffoli
git pull --ff-only
# Pacchetti di sistema richiesti dalle versioni più recenti (Python + pandas per lo studio del rendimento)
apt-get install -y -qq python3 python3-pandas sqlite3 >/dev/null
cd server
npm install --omit=dev --no-audit --no-fund
cp /opt/portale-zoffoli/deploy/portale-zoffoli.service /etc/systemd/system/
systemctl daemon-reload
systemctl restart portale-zoffoli
echo "✔ Portale aggiornato."
