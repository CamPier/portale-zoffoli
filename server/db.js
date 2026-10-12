// ═══════════════════════════════════════════════════════════════
//  Database SQLite — Portale Zoffoli
//
//  Un unico file (DATA_DIR/portale.db): per il backup basta
//  copiarlo insieme alla cartella DATA_DIR/documenti.
// ═══════════════════════════════════════════════════════════════

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
export const DOCUMENTI_DIR = path.join(DATA_DIR, "documenti");
fs.mkdirSync(DOCUMENTI_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "portale.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- ── Progetti ──
  create table if not exists progetti (
    id text primary key,
    nome text not null,
    descrizione text,
    stato text not null default 'aperto',
    creato_il text not null
  );

  -- ── Documenti (metadati; i file PDF ed Excel stanno in DATA_DIR/documenti) ──
  create table if not exists documenti (
    id text primary key,
    progetto_id text not null references progetti(id) on delete cascade,
    nome_file text not null,
    tipo text not null check (tipo in ('scheda_tecnica', 'preventivo', 'altro', 'produzione')),
    fornitore text,
    storage_path text not null,
    caricato_il text not null
  );

  -- ── Analisi (risultati AI in formato JSON) ──
  create table if not exists analisi (
    id text primary key,
    progetto_id text not null references progetti(id) on delete cascade,
    risultato text not null,
    creata_il text not null
  );

  -- ── Studi di rendimento del macchinario (dai dati di produzione Excel) ──
  create table if not exists studi_rendimento (
    id text primary key,
    progetto_id text not null references progetti(id) on delete cascade,
    risultato text not null,
    creata_il text not null
  );

  -- ── Domande sui documenti e sull'analisi (conversazione per progetto) ──
  create table if not exists domande (
    id text primary key,
    progetto_id text not null references progetti(id) on delete cascade,
    domanda text not null,
    risposta text,
    errore text,
    stato text not null check (stato in ('in_corso', 'completata', 'errore')),
    creata_il text not null,
    risposta_il text
  );
  create index if not exists domande_progetto on domande(progetto_id, creata_il);

  -- ── Sessioni di login (sopravvivono al riavvio del servizio) ──
  create table if not exists sessioni (
    token text primary key,
    scade_il integer not null
  );
`);

// Migrazione: i database creati prima dei dati di produzione non accettano
// il tipo 'produzione' (SQLite non modifica i vincoli: si ricrea la tabella)
const sqlDocumenti = db.prepare("select sql from sqlite_master where type = 'table' and name = 'documenti'").get().sql;
if (!sqlDocumenti.includes("'produzione'")) {
  db.transaction(() => {
    db.exec(`
      create table documenti_nuova (
        id text primary key,
        progetto_id text not null references progetti(id) on delete cascade,
        nome_file text not null,
        tipo text not null check (tipo in ('scheda_tecnica', 'preventivo', 'altro', 'produzione')),
        fornitore text,
        storage_path text not null,
        caricato_il text not null
      );
      insert into documenti_nuova select id, progetto_id, nome_file, tipo, fornitore, storage_path, caricato_il from documenti;
      drop table documenti;
      alter table documenti_nuova rename to documenti;
    `);
  })();
  console.log("Database aggiornato: aggiunto il tipo documento 'produzione'.");
}

// Le domande rimaste "in corso" sono state interrotte da un riavvio del servizio
db.prepare("update domande set stato = 'errore', errore = ? where stato = 'in_corso'")
  .run("Risposta interrotta dal riavvio del server. Fai di nuovo la domanda.");
