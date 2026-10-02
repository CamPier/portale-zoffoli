#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Portale Zoffoli — installazione su Debian 13
#
#  Uso (da root, dopo aver copiato il progetto in /opt/portale-zoffoli):
#    sudo bash /opt/portale-zoffoli/deploy/install.sh
#
#  Si può rieseguire senza problemi: non sovrascrive .env né i dati.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR=/opt/portale-zoffoli
HOME_DIR=/var/lib/portale-zoffoli
UTENTE=portale

if [[ $EUID -ne 0 ]]; then echo "Esegui come root (sudo)."; exit 1; fi
if [[ ! -f "$APP_DIR/server/server.js" ]]; then
  echo "Progetto non trovato in $APP_DIR. Copialo lì e riprova."; exit 1
fi

echo "▶ 1/6  Pacchetti di sistema (Node.js dai repository Debian)"
apt-get update -qq
apt-get install -y -qq nodejs npm curl ca-certificates git sqlite3 build-essential python3 >/dev/null
node -v

echo "▶ 2/6  Utente di servizio '$UTENTE'"
if ! id "$UTENTE" &>/dev/null; then
  useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$UTENTE"
fi
install -d -o "$UTENTE" -g "$UTENTE" -m 750 "$HOME_DIR" "$HOME_DIR/data"

echo "▶ 3/6  Dipendenze Node del portale"
cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

echo "▶ 4/6  Claude Code (per l'utente $UTENTE)"
if [[ ! -x "$HOME_DIR/.local/bin/claude" ]]; then
  sudo -u "$UTENTE" -H bash -c 'curl -fsSL https://claude.ai/install.sh | bash'
fi
sudo -u "$UTENTE" -H "$HOME_DIR/.local/bin/claude" --version

echo "▶ 5/6  File di configurazione .env"
if [[ ! -f "$APP_DIR/server/.env" ]]; then
  cp "$APP_DIR/server/.env.example" "$APP_DIR/server/.env"
  echo "   creato $APP_DIR/server/.env (da completare)"
fi
chown "$UTENTE:$UTENTE" "$APP_DIR/server/.env"
chmod 600 "$APP_DIR/server/.env"

echo "▶ 6/6  Servizio systemd"
cp "$APP_DIR/deploy/portale-zoffoli.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable portale-zoffoli >/dev/null
systemctl restart portale-zoffoli

# Se è attivo un firewall ufw, apri la porta del portale
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 3000/tcp
fi

cat <<EOF

✔ Installazione completata.

Passi rimanenti (una volta sola):

  1) Password aziendale del portale:
       cd $APP_DIR/server && sudo -u $UTENTE node imposta-password.js

  2) Collega il tuo account Claude (segui il link che compare, poi copia il token):
       sudo -u $UTENTE -H $HOME_DIR/.local/bin/claude setup-token
     e incolla il token nella riga CLAUDE_CODE_OAUTH_TOKEN= di:
       sudo nano $APP_DIR/server/.env

  3) Riavvia:
       sudo systemctl restart portale-zoffoli

  Portale:  http://$(hostname -I | awk '{print $1}'):3000
  Log:      sudo journalctl -u portale-zoffoli -f
EOF
