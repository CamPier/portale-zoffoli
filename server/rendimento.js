// ═══════════════════════════════════════════════════════════════
//  Studio del rendimento del macchinario — Portale Zoffoli
//
//  Claude analizza i dati di produzione caricati in Excel/CSV
//  (convertiti in CSV da claude.js), fa i calcoli con Python e li
//  confronta con i valori dichiarati nelle schede tecniche, se presenti.
//  Il risultato JSON viene salvato nella tabella "studi_rendimento".
// ═══════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { db } from "./db.js";
import { eseguiClaude, preparaCartella, rimuoviCartella, STRUMENTI_PYTHON } from "./claude.js";

const TIMEOUT_MS = Number(process.env.RENDIMENTO_TIMEOUT_MIN || 20) * 60 * 1000;

const GIUDIZIO = { type: "string", enum: ["verde", "giallo", "rosso"] };

const SCHEMA_RENDIMENTO = {
  type: "object",
  additionalProperties: false,
  required: ["riepilogo", "giudizio", "periodo_analizzato", "indicatori", "andamento", "fermi_e_problemi",
    "cosa_va_bene", "consigli", "dati_mancanti", "metodo"],
  properties: {
    riepilogo: { type: "string", description: "2-4 frasi semplici: come sta andando la macchina, per chi non ha tempo di leggere tutto" },
    giudizio: {
      type: "object",
      additionalProperties: false,
      required: ["valutazione", "spiegazione"],
      properties: {
        valutazione: { ...GIUDIZIO, description: "verde = rende bene, giallo = migliorabile, rosso = problemi seri" },
        spiegazione: { type: "string" },
      },
    },
    periodo_analizzato: { type: "string", description: "Es. 'dal 2 gennaio al 30 giugno 2026 (124 giorni lavorativi, 3 turni)'" },
    indicatori: {
      type: "array",
      description: "I numeri chiave calcolati dai dati: pezzi/ora, % scarti, ore di fermo, disponibilità, OEE se calcolabile...",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "valore", "cosa_significa", "riferimento", "giudizio"],
        properties: {
          nome: { type: "string" },
          valore: { type: "string", description: "Valore con unità, es. '87 pezzi/ora' o '3,2 %'" },
          cosa_significa: { type: "string", description: "Spiegazione semplice dell'indicatore" },
          riferimento: { type: "string", description: "Con cosa si confronta: valore di targa (con fonte), media del periodo, o 'nessun riferimento disponibile'" },
          giudizio: GIUDIZIO,
        },
      },
    },
    andamento: {
      type: "array",
      description: "Andamento nel tempo (per mese, o per settimana se il periodo è breve), dal più vecchio al più recente",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["periodo", "valori", "commento", "giudizio"],
        properties: {
          periodo: { type: "string", description: "Es. 'Gennaio 2026' o 'Settimana 12'" },
          valori: { type: "string", description: "I numeri principali del periodo, es. '18.400 pezzi · 85 pz/h · scarti 2,1 %'" },
          commento: { type: "string" },
          giudizio: GIUDIZIO,
        },
      },
    },
    fermi_e_problemi: {
      type: "array",
      description: "Cause di fermo, scarti o rallentamenti, dalla più pesante alla più leggera",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["problema", "quanto_pesa", "spiegazione"],
        properties: {
          problema: { type: "string" },
          quanto_pesa: { type: "string", description: "Es. '41 ore di fermo (38% del totale)'" },
          spiegazione: { type: "string" },
        },
      },
    },
    cosa_va_bene: { type: "array", items: { type: "string" } },
    consigli: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["azione", "perche", "priorita", "beneficio_atteso"],
        properties: {
          azione: { type: "string" },
          perche: { type: "string" },
          priorita: { type: "string", enum: ["alta", "media", "bassa"] },
          beneficio_atteso: { type: "string", description: "Stima concreta se i dati la permettono, es. '+6% di pezzi al mese'" },
        },
      },
    },
    dati_mancanti: {
      type: "array",
      items: { type: "string" },
      description: "Cosa aggiungere all'Excel per uno studio più preciso (es. 'colonna con la causa del fermo')",
    },
    metodo: { type: "string", description: "Come sono stati letti i dati e calcolati gli indicatori, quali colonne sono state usate e quali ipotesi fatte" },
  },
};

const PROMPT_RENDIMENTO = `Sei un esperto di produzione industriale ed efficienza dei macchinari (OEE, fermi, scarti) che lavora per un'azienda italiana.
Devi studiare come sta rendendo un macchinario a partire dai dati di produzione esportati in Excel e convertiti in CSV.

Il tuo pubblico: OPERATORI E RESPONSABILI NON TECNICI. Regole di scrittura, sempre:
- Italiano semplice e diretto, frasi corte, numeri concreti (con la virgola decimale all'italiana).
- Ogni indicatore va spiegato in parole semplici (es. "OEE: su 100 pezzi che la macchina potrebbe fare in teoria, quanti ne fa davvero buoni").

Come lavorare:
1. Guarda prima la struttura di ogni CSV (prime righe, colonne, tipi di dato) e capisci cosa rappresenta ogni colonna:
   data/turno/operatore, pezzi prodotti, pezzi scartati, ore lavorate, ore di fermo, causa del fermo, velocità, articolo...
2. FAI TUTTI I CALCOLI CON PYTHON, mai a occhio. Usa il comando python3 (è l'unico comando disponibile), per esempio:
   python3 -c "import pandas as pd; df = pd.read_csv('produzione-01-Foglio1.csv'); print(df.describe())"
   oppure python3 - <<'EOF' ... EOF per script più lunghi. pandas è installato. Non puoi creare file: stampa i risultati.
3. Calcola gli indicatori che i dati permettono: pezzi per ora, % scarti, ore e % di fermo, cause principali di fermo
   (in ordine di peso), disponibilità, e l'OEE (disponibilità × prestazione × qualità) solo se ci sono i dati necessari.
   Guarda l'andamento nel tempo (per mese, o per settimana se il periodo è breve) e le differenze tra turni/operatori/articoli se presenti.
4. Se ci sono schede tecniche PDF, leggile con lo strumento Read per trovare i valori di targa (velocità, capacità oraria,
   manutenzioni previste) e confronta il rendimento reale con quello dichiarato, citando documento e pagina.
5. Date e numeri nei CSV: date in formato aaaa-mm-gg; un valore "1899-12-30 hh:mm" è un orario o una durata, non una data.

Regole sul contenuto:
- Basati SOLO sui dati. Non inventare obiettivi o valori di riferimento: se non ci sono, scrivi "nessun riferimento disponibile"
  e usa come termine di paragone la media del periodo.
- Se il significato di una colonna non è certo, scegli l'interpretazione più ragionevole e scrivila nel campo "metodo".
- Se i dati sono troppo pochi o confusi per conclusioni affidabili, dillo nel riepilogo e nel giudizio.
- I consigli devono essere concreti e legati ai numeri trovati.`;

// Studi in corso, per progetto (in memoria, come per l'analisi)
const lavori = new Map();

export function statoRendimento(progettoId) {
  return lavori.get(progettoId) || { in_corso: false, errore: null };
}

export function avviaRendimento(progettoId) {
  if (statoRendimento(progettoId).in_corso) return false;
  lavori.set(progettoId, { in_corso: true, errore: null, avviata_il: new Date().toISOString() });

  eseguiStudio(progettoId)
    .then(() => lavori.set(progettoId, { in_corso: false, errore: null }))
    .catch((err) => {
      console.error(`Studio rendimento progetto ${progettoId} fallito:`, err);
      lavori.set(progettoId, { in_corso: false, errore: err.message || String(err) });
    });
  return true;
}

async function eseguiStudio(progettoId) {
  const { cartella, elenco, nProduzione } = await preparaCartella(progettoId, { prefisso: "rendimento-" });
  try {
    if (nProduzione === 0) throw new Error("Carica almeno un file Excel con i dati di produzione.");

    const progetto = db.prepare("select nome, descrizione from progetti where id = ?").get(progettoId);
    const istruzioni =
      `MACCHINARIO / PROGETTO: ${progetto.nome}${progetto.descrizione ? " — " + progetto.descrizione : ""}\n\n` +
      `FILE nella cartella corrente:\n${elenco}\n\n` +
      "Studia i dati di produzione e produci il rapporto sul rendimento del macchinario secondo lo schema richiesto. " +
      "Nei riferimenti usa i nomi file originali, non i nomi dei CSV. Ricorda: il lettore non è un tecnico.";

    const esito = await eseguiClaude({
      istruzioni,
      cartella,
      sistema: PROMPT_RENDIMENTO,
      schema: SCHEMA_RENDIMENTO,
      strumenti: STRUMENTI_PYTHON,
      maxTurni: 80,
      timeoutMs: TIMEOUT_MS,
      cosa: "Lo studio del rendimento",
    });

    const studio = esito.structured_output;
    if (!studio || typeof studio !== "object") throw new Error("Claude ha risposto in un formato inatteso. Riprova.");

    db.prepare("insert into studi_rendimento (id, progetto_id, risultato, creata_il) values (?, ?, ?, ?)")
      .run(crypto.randomUUID(), progettoId, JSON.stringify(studio), new Date().toISOString());
  } finally {
    await rimuoviCartella(cartella);
  }
}
