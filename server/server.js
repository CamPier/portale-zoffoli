// ═══════════════════════════════════════════════════════════════
//  Portale Zoffoli — server
//
//  Serve il frontend (cartella ../public) e le API /api/*.
//  Configurazione nel file .env accanto a questo file
//  (vedi .env.example).
// ═══════════════════════════════════════════════════════════════

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const QUI = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(QUI, ".env")); } catch { /* .env facoltativo se l'ambiente è già impostato */ }

const { default: express } = await import("express");
const { default: multer } = await import("multer");
const { db, DOCUMENTI_DIR } = await import("./db.js");
const { avviaAnalisi, statoAnalisi } = await import("./analisi.js");
const { verificaPassword } = await import("./password.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const SESSIONE_ORE = Number(process.env.SESSIONE_ORE || 12);
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const COOKIE = "pz_sessione";

if (!process.env.PORTALE_PASSWORD_HASH) {
  console.warn("⚠  PORTALE_PASSWORD_HASH non impostata: nessuno può entrare. Esegui `npm run password`.");
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(QUI, "..", "public")));

const ora = () => new Date().toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ─────────────────────────────────────────────
//  Sessioni
// ─────────────────────────────────────────────
function leggiCookie(req, nome) {
  for (const parte of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

function impostaCookie(res, valore, maxAgeSec) {
  res.setHeader("Set-Cookie",
    `${COOKIE}=${valore}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (COOKIE_SECURE ? "; Secure" : ""));
}

function sessioneValida(req) {
  const token = leggiCookie(req, COOKIE);
  if (!token) return false;
  const s = db.prepare("select scade_il from sessioni where token = ?").get(token);
  return !!s && s.scade_il > Date.now();
}

function richiediLogin(req, res, next) {
  if (sessioneValida(req)) return next();
  res.status(401).json({ errore: "Sessione scaduta. Accedi di nuovo." });
}

// Pulizia periodica delle sessioni scadute
setInterval(() => db.prepare("delete from sessioni where scade_il < ?").run(Date.now()), 60 * 60 * 1000).unref();

// Limite tentativi di login: max 10 ogni 15 minuti per indirizzo IP
const tentativi = new Map();
function troppiTentativi(ip) {
  const adesso = Date.now();
  const t = (tentativi.get(ip) || []).filter((x) => adesso - x < 15 * 60 * 1000);
  tentativi.set(ip, t);
  return t.length >= 10;
}

app.post("/api/login", (req, res) => {
  const ip = req.socket.remoteAddress;
  if (troppiTentativi(ip)) {
    return res.status(429).json({ errore: "Troppi tentativi. Riprova tra qualche minuto." });
  }
  const password = String(req.body?.password || "");
  if (!verificaPassword(password, process.env.PORTALE_PASSWORD_HASH)) {
    tentativi.get(ip).push(Date.now());
    return res.status(401).json({ errore: "Password errata. Riprova." });
  }
  tentativi.delete(ip);
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("insert into sessioni (token, scade_il) values (?, ?)")
    .run(token, Date.now() + SESSIONE_ORE * 3600 * 1000);
  impostaCookie(res, token, SESSIONE_ORE * 3600);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  const token = leggiCookie(req, COOKIE);
  if (token) db.prepare("delete from sessioni where token = ?").run(token);
  impostaCookie(res, "", 0);
  res.json({ ok: true });
});

app.get("/api/sessione", (req, res) => {
  res.json({ autenticato: sessioneValida(req) });
});

// Da qui in poi tutte le API richiedono il login
app.use("/api", richiediLogin);

// Valida gli id nei percorsi (evita accessi a file arbitrari)
app.param("id", (req, res, next, id) => {
  if (!UUID.test(id)) return res.status(400).json({ errore: "Identificativo non valido." });
  next();
});

// ─────────────────────────────────────────────
//  Progetti
// ─────────────────────────────────────────────
app.get("/api/progetti", (req, res) => {
  res.json(db.prepare("select * from progetti order by creato_il desc").all());
});

app.post("/api/progetti", (req, res) => {
  const nome = String(req.body?.nome || "").trim();
  const descrizione = String(req.body?.descrizione || "").trim() || null;
  if (!nome) return res.status(400).json({ errore: "Il nome del progetto è obbligatorio." });
  const progetto = { id: crypto.randomUUID(), nome, descrizione, stato: "aperto", creato_il: ora() };
  db.prepare("insert into progetti (id, nome, descrizione, stato, creato_il) values (@id, @nome, @descrizione, @stato, @creato_il)")
    .run(progetto);
  res.status(201).json(progetto);
});

app.delete("/api/progetti/:id", (req, res) => {
  // Documenti e analisi si cancellano a cascata nel database
  db.prepare("delete from progetti where id = ?").run(req.params.id);
  fs.rmSync(path.join(DOCUMENTI_DIR, req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  Documenti
// ─────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

app.get("/api/progetti/:id/documenti", (req, res) => {
  res.json(db.prepare("select * from documenti where progetto_id = ? order by caricato_il").all(req.params.id));
});

app.post("/api/progetti/:id/documenti", upload.single("file"), (req, res) => {
  const progettoId = req.params.id;
  if (!db.prepare("select 1 from progetti where id = ?").get(progettoId)) {
    return res.status(404).json({ errore: "Progetto non trovato." });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ errore: "Nessun file ricevuto." });
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return res.status(400).json({ errore: "Puoi caricare solo file PDF." });
  }
  const tipo = req.body.tipo;
  if (!["scheda_tecnica", "preventivo", "altro"].includes(tipo)) {
    return res.status(400).json({ errore: "Tipo documento non valido." });
  }

  // Il nome file arriva come campo di testo (UTF-8) per conservare accenti e simboli
  const nomeFile = String(req.body.nome_file || file.originalname || "documento.pdf").slice(0, 255);
  const storagePath = `${progettoId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
  fs.mkdirSync(path.join(DOCUMENTI_DIR, progettoId), { recursive: true });
  fs.writeFileSync(path.join(DOCUMENTI_DIR, storagePath), file.buffer);

  const doc = {
    id: crypto.randomUUID(),
    progetto_id: progettoId,
    nome_file: nomeFile,
    tipo,
    fornitore: String(req.body.fornitore || "").trim() || null,
    storage_path: storagePath,
    caricato_il: ora(),
  };
  db.prepare(`insert into documenti (id, progetto_id, nome_file, tipo, fornitore, storage_path, caricato_il)
              values (@id, @progetto_id, @nome_file, @tipo, @fornitore, @storage_path, @caricato_il)`).run(doc);
  res.status(201).json(doc);
});

app.get("/api/documenti/:id/file", (req, res) => {
  const doc = db.prepare("select * from documenti where id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ errore: "Documento non trovato." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(doc.nome_file)}`);
  res.sendFile(path.join(DOCUMENTI_DIR, doc.storage_path));
});

app.delete("/api/documenti/:id", (req, res) => {
  const doc = db.prepare("select * from documenti where id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ errore: "Documento non trovato." });
  fs.rmSync(path.join(DOCUMENTI_DIR, doc.storage_path), { force: true });
  db.prepare("delete from documenti where id = ?").run(doc.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  Analisi
// ─────────────────────────────────────────────

// Avvia l'analisi in background; il browser controlla lo stato con GET
app.post("/api/progetti/:id/analisi", (req, res) => {
  const progettoId = req.params.id;
  const nDoc = db.prepare("select count(*) as n from documenti where progetto_id = ?").get(progettoId).n;
  if (nDoc === 0) return res.status(400).json({ errore: "Carica almeno un documento prima di avviare l'analisi." });
  avviaAnalisi(progettoId);
  res.status(202).json(statoAnalisi(progettoId));
});

// Stato dell'analisi in corso + ultima analisi salvata
app.get("/api/progetti/:id/analisi", (req, res) => {
  const ultima = db.prepare("select * from analisi where progetto_id = ? order by creata_il desc limit 1")
    .get(req.params.id);
  res.json({
    ...statoAnalisi(req.params.id),
    ultima: ultima ? { risultato: JSON.parse(ultima.risultato), creata_il: ultima.creata_il } : null,
  });
});

// ─────────────────────────────────────────────
//  Errori
// ─────────────────────────────────────────────
app.use("/api", (req, res) => res.status(404).json({ errore: "Risorsa non trovata." }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ errore: "Il file supera i 20 MB. Riduci il PDF e riprova." });
  }
  console.error(err);
  res.status(500).json({ errore: "Errore interno del server." });
});

app.listen(PORT, HOST, () => {
  console.log(`Portale Zoffoli in ascolto su http://${HOST}:${PORT}`);
});
