# ⚙️ Portale Zoffoli

Web app interna per la valutazione di acquisti di macchinari: si caricano schede tecniche
e preventivi in PDF, e l'assistente AI (Claude) produce un'analisi comparativa scritta
in linguaggio semplice, con consiglio sull'offerta migliore e piano manutenzioni.

## Architettura

Tutto gira su una VM Debian 13 aziendale (`192.168.3.220`); i documenti non lasciano
l'azienda, tranne quando vengono inviati a Claude per l'analisi.

| Componente | Tecnologia | Dove |
|---|---|---|
| Frontend | HTML/CSS/JS statici | `public/`, servito dal backend |
| Backend e API | Node.js + Express | `server/`, servizio systemd `portale-zoffoli` |
| Database | SQLite (un solo file) | `/var/lib/portale-zoffoli/data/portale.db` |
| Archivio PDF | cartella su disco | `/var/lib/portale-zoffoli/data/documenti/` |
| Analisi AI | CLI di Claude Code (`claude -p`) | utente di servizio `portale` |
| Porta | **3000** (8080 e 8085 sono già occupate) | `http://192.168.3.220:3000` |

**Login**: una password aziendale unica per tutti gli operatori. Sul server ne viene
salvato solo l'hash (file `server/.env`).

**Claude**: il backend copia i PDF del progetto in una cartella temporanea e lancia
Claude Code in modalità non interattiva. Può usare solo lo strumento di lettura file
e deve rispondere secondo lo schema JSON che il frontend sa visualizzare.
L'analisi gira in background: si può chiudere la pagina e tornare più tardi.

**Rapporto per la direzione**: dentro ogni progetto con un'analisi ci sono due pulsanti:
- **Esporta PDF** apre una pagina impaginata A4 (copertina con logo, consiglio, offerte,
  confronto, manutenzioni, punti di attenzione) da salvare con *Stampa → Salva come PDF*;
- **Esporta Word** scarica lo stesso rapporto in `.docx`, modificabile prima dell'invio.

### Autenticazione verso Claude: test e produzione

| Fase | Cosa mettere in `server/.env` |
|---|---|
| **Test** (uso personale) | `CLAUDE_CODE_OAUTH_TOKEN=` → token del proprio account Claude Pro/Max |
| **Produzione** (licenza acquistata) | `ANTHROPIC_API_KEY=sk-ant-...` e svuotare `CLAUDE_CODE_OAUTH_TOKEN` |

Il codice non cambia: basta modificare `.env` e riavviare il servizio.

> ⚠️ Il token di un account Claude personale va usato **solo per i test e solo dal titolare
> dell'account**. I termini d'uso Anthropic non consentono di usare un abbonamento personale
> per un servizio aperto ad altri colleghi. Prima di aprire il portale agli operatori
> va attivata la licenza aziendale (chiave API).

---

## Installazione sulla VM — passo per passo

Tutti i comandi vanno eseguiti sulla VM, collegati in SSH con un utente che può usare `sudo`.

### 1. Scarica il progetto

```bash
sudo apt-get install -y git
sudo git clone https://github.com/CamPier/portale-zoffoli.git /opt/portale-zoffoli
```

> Se il repository è privato, `git clone` chiederà le credenziali GitHub (usa un
> *personal access token* come password). In alternativa copia la cartella dal PC con
> `scp -r portale-zoffoli utente@192.168.3.220:/tmp/` e poi `sudo mv /tmp/portale-zoffoli /opt/`.

### 2. Lancia l'installazione

```bash
sudo bash /opt/portale-zoffoli/deploy/install.sh
```

Lo script (si può rieseguire senza perdere dati):
- installa Node.js, sqlite3 e gli strumenti di compilazione dai repository Debian;
- crea l'utente di servizio `portale` (senza login) e la cartella dati;
- installa le dipendenze del portale e Claude Code;
- crea `server/.env` da `server/.env.example`;
- installa e avvia il servizio `portale-zoffoli`.

### 3. Imposta la password aziendale

```bash
cd /opt/portale-zoffoli/server
sudo -u portale node imposta-password.js
```

### 4. Collega il tuo account Claude (fase di test)

```bash
sudo -u portale -H /var/lib/portale-zoffoli/.local/bin/claude setup-token
```

Il comando mostra un link: aprilo nel browser del PC, accedi con il tuo account Claude
e autorizza. Copia il token che compare (`sk-ant-oat01-...`) e incollalo in `.env`:

```bash
sudo nano /opt/portale-zoffoli/server/.env
#   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

### 5. Riavvia e prova

```bash
sudo systemctl restart portale-zoffoli
sudo systemctl status portale-zoffoli
```

Dal PC apri **http://192.168.3.220:3000**, entra con la password, crea un progetto,
carica un PDF e premi **Analizza**.

---

## Gestione quotidiana

| Cosa | Comando |
|---|---|
| Vedere i log (anche delle analisi) | `sudo journalctl -u portale-zoffoli -f` |
| Riavviare | `sudo systemctl restart portale-zoffoli` |
| Aggiornare all'ultima versione su GitHub | `sudo bash /opt/portale-zoffoli/deploy/aggiorna.sh` |
| Cambiare la password aziendale | passo 3, poi riavvio |
| Backup manuale | `sudo bash /opt/portale-zoffoli/deploy/backup.sh` |

**Backup automatico**: con `sudo crontab -e` aggiungi la riga

```
30 2 * * * bash /opt/portale-zoffoli/deploy/backup.sh /root/backup-portale
```

per un backup ogni notte alle 2:30 (vengono tenuti gli ultimi 30). Meglio ancora se
la cartella di destinazione è una condivisione di rete o un disco diverso dalla VM.

### Passare alla licenza (chiave API)

1. In `server/.env`: compila `ANTHROPIC_API_KEY=sk-ant-...` e svuota `CLAUDE_CODE_OAUTH_TOKEN=`.
2. `sudo systemctl restart portale-zoffoli`.

## Sviluppo in locale

Serve Node.js ≥ 20.12 e Claude Code installato (`claude` nel PATH).

```bash
cd server
npm install
cp .env.example .env      # poi imposta DATA_DIR=./data e CLAUDE_BIN=claude
npm run password
npm start                 # http://localhost:3000
```

## Limiti da conoscere

- Solo file **PDF**, max 20 MB l'uno.
- Un'analisi richiede qualche minuto (massimo `ANALISI_TIMEOUT_MIN`, di default 15).
- Se il servizio viene riavviato durante un'analisi, l'analisi si interrompe: va rilanciata.
- Con il token personale valgono i limiti d'uso del proprio abbonamento Claude, condivisi
  con l'uso personale di Claude.
- L'AI indica sempre le **fonti** (documento e pagina): per le decisioni importanti
  verifica i numeri sui documenti originali.
- Il portale è in HTTP sulla rete interna. Se un giorno dovrà essere raggiungibile
  dall'esterno, va messo dietro un reverse proxy con HTTPS (e `COOKIE_SECURE=1`).
