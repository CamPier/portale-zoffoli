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

  -- ── Documenti (metadati; i PDF stanno in DATA_DIR/documenti) ──
  create table if not exists documenti (
    id text primary key,
    progetto_id text not null references progetti(id) on delete cascade,
    nome_file text not null,
    tipo text not null check (tipo in ('scheda_tecnica', 'preventivo', 'altro')),
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

  -- ── Sessioni di login (sopravvivono al riavvio del servizio) ──
  create table if not exists sessioni (
    token text primary key,
    scade_il integer not null
  );
`);
