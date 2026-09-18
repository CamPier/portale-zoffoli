# ⚙️ Portale Zoffoli

Web app interna per la valutazione di acquisti di macchinari: si caricano schede tecniche
e preventivi in PDF, e l'assistente AI (Claude) produce un'analisi comparativa scritta
in linguaggio semplice, con consiglio sull'offerta migliore e piano manutenzioni.

## Architettura

| Componente | Dove gira | Costo |
|---|---|---|
| Frontend (questa cartella) | GitHub Pages | Gratis |
| Login, database, archivio PDF | Supabase (cloud, migrabile su server aziendale) | Gratis (piano Free) |
| Analisi AI | Edge Function Supabase → API Claude (`claude-opus-5`) | ~0,30–0,60 € per analisi |

La chiave API di Claude sta **solo** sul server (Edge Function), mai nel browser.
In caso di blocco di sicurezza del modello è attivo il **fallback automatico**
su un modello alternativo (parametro `fallbacks` dell'API Anthropic), così
l'analisi non si interrompe.

---

## Installazione — passo per passo

### 1. Crea il progetto Supabase (≈ 5 minuti)

1. Vai su **[supabase.com](https://supabase.com)** → **Start your project** → accedi con GitHub o Google.
2. **New project**:
   - *Name*: `portale-zoffoli`
   - *Database password*: generane una e **salvala** (serve solo per amministrazione)
   - *Region*: **Central EU (Frankfurt)** — dati in Europa (GDPR)
3. Attendi ~2 minuti che il progetto sia pronto.

### 2. Crea il database

1. Nel menu a sinistra apri **SQL Editor** → **New query**.
2. Copia tutto il contenuto di [`supabase/schema.sql`](supabase/schema.sql), incollalo e premi **Run**.
   Crea le tabelle (progetti, documenti, analisi), le regole di sicurezza e l'archivio PDF privato.

### 3. Crea l'utente aziendale

1. Menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: `operatori@portale-zoffoli.it` (o quella che preferisci — va scritta anche in `js/config.js`).
3. Password: la **password aziendale** che tutti gli operatori useranno per entrare.
4. Spunta **Auto Confirm User** e salva.

> Consiglio: disattiva le registrazioni libere in **Authentication → Sign In / Up →
> disabilita "Allow new users to sign up"**, così nessun estraneo può crearsi un account.

### 4. Collega l'app a Supabase

1. Nel dashboard: **Project Settings → API**.
2. Apri il file **`js/config.js`** di questa cartella e compila:
   - `SUPABASE_URL` → il campo **Project URL**
   - `SUPABASE_ANON_KEY` → la chiave **anon / public**
   - `LOGIN_EMAIL` → l'email dell'utente creato al passo 3

### 5. Crea la chiave API Claude (a carico dell'azienda)

1. Vai su **[console.anthropic.com](https://console.anthropic.com)** → crea l'account aziendale.
2. **Billing** → carica un credito iniziale (es. 20 €) — *consiglio: NON attivare l'auto-ricarica, così la spesa è sempre sotto controllo*.
3. **API Keys** → **Create key** → copia la chiave `sk-ant-...`.

### 6. Pubblica la funzione di analisi

Serve [Node.js](https://nodejs.org) installato. Da terminale, dentro questa cartella:

```bash
# Accedi a Supabase (apre il browser)
npx supabase login

# Collega la cartella al tuo progetto (il "project ref" è in Project Settings → General)
npx supabase link --project-ref IL-TUO-PROJECT-REF

# Salva la chiave Claude sul server (MAI nel codice!)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-LA-TUA-CHIAVE

# Pubblica la funzione
npx supabase functions deploy analizza
```

### 7. Prova in locale

```bash
# Sempre dentro questa cartella:
npx serve .
```

Apri l'indirizzo mostrato (di solito `http://localhost:3000`), entra con la password
aziendale, crea un progetto, carica un PDF e premi **Analizza**.

### 8. Pubblica su GitHub Pages

1. Crea un repository su GitHub (es. `portale-zoffoli`).
2. Carica questa cartella (da terminale: `git init`, `git add .`, `git commit -m "Prima versione"`, poi segui le istruzioni di GitHub per il push).
3. Nel repository: **Settings → Pages → Source: Deploy from a branch → Branch: main / root** → Save.
4. Dopo ~1 minuto l'app è online su `https://TUO-UTENTE.github.io/portale-zoffoli/`.

> Il repository può restare pubblico senza rischi: contiene solo il codice.
> I documenti, la password e la chiave API **non sono mai** nel repository.

---

## Migrazione futura sul server aziendale

Supabase è open source e si installa on-premise con Docker
([docs](https://supabase.com/docs/guides/self-hosting)). Quando l'azienda vorrà
ospitare tutto internamente:

1. Installare Supabase sul server aziendale (Docker Compose).
2. Rieseguire `supabase/schema.sql` e ricreare l'utente.
3. Esportare/importare i dati (Postgres `pg_dump`) e i file dello Storage.
4. Cambiare **due righe** in `js/config.js` (URL e anon key). Fine.

## Limiti da conoscere

- Solo file **PDF**, max 20 MB l'uno e ~25 MB totali per analisi.
- L'analisi richiede 1–3 minuti: non chiudere la pagina.
- L'AI indica sempre le **fonti** (documento e pagina): per le decisioni importanti
  verifica i numeri sui documenti originali.
- Piano Free di Supabase: 500 MB di database, 1 GB di storage — ampiamente
  sufficienti per iniziare; si può passare al piano Pro o al server aziendale in seguito.
