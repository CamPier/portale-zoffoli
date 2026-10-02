#!/usr/bin/env bash
# Backup di database e PDF in un unico archivio .tar.gz.
# Uso:  sudo bash /opt/portale-zoffoli/deploy/backup.sh [cartella-destinazione]
# Esempio cron giornaliero (sudo crontab -e):
#   30 2 * * * bash /opt/portale-zoffoli/deploy/backup.sh /root/backup-portale
set -euo pipefail
DEST=${1:-/root/backup-portale}
DATA=/var/lib/portale-zoffoli/data
mkdir -p "$DEST"
FILE="$DEST/portale-$(date +%Y%m%d-%H%M).tar.gz"
# Copia coerente del database anche con il servizio acceso
sqlite3 "$DATA/portale.db" ".backup '$DATA/portale-backup.db'" 2>/dev/null \
  || cp "$DATA/portale.db" "$DATA/portale-backup.db"
tar -czf "$FILE" -C "$DATA" portale-backup.db documenti
rm -f "$DATA/portale-backup.db"
# Tiene gli ultimi 30 backup
ls -1t "$DEST"/portale-*.tar.gz | tail -n +31 | xargs -r rm -f
echo "✔ Backup creato: $FILE"
