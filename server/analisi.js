// ═══════════════════════════════════════════════════════════════
//  Analisi AI — Portale Zoffoli
//
//  Fa leggere a Claude tutti i PDF del progetto (vedi claude.js) e
//  salva il rapporto JSON nella tabella "analisi".
// ═══════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { db } from "./db.js";
import { eseguiClaude, preparaCartella, rimuoviCartella } from "./claude.js";

const TIMEOUT_MS = Number(process.env.ANALISI_TIMEOUT_MIN || 15) * 60 * 1000;

// Schema JSON del risultato: garantisce una risposta sempre uguale
// e ben strutturata, che il frontend sa visualizzare.
const SCHEMA_ANALISI = {
  type: "object",
  additionalProperties: false,
  required: ["riepilogo", "verdetto", "offerte", "comparativa", "manutenzione", "punti_attenzione", "glossario"],
  properties: {
    riepilogo: { type: "string", description: "2-4 frasi semplici che riassumono la situazione per chi non ha tempo di leggere tutto" },
    verdetto: {
      type: "object",
      additionalProperties: false,
      required: ["fornitore_consigliato", "motivazione_semplice", "livello_fiducia", "cosa_verificare_prima_di_firmare"],
      properties: {
        fornitore_consigliato: { type: "string" },
        motivazione_semplice: { type: "string", description: "Perché conviene questa offerta, spiegato come a un amico" },
        livello_fiducia: { type: "string", enum: ["alta", "media", "bassa"] },
        cosa_verificare_prima_di_firmare: { type: "array", items: { type: "string" } },
      },
    },
    offerte: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fornitore", "prezzo_totale", "valutazione", "punti_forti", "punti_deboli", "riferimenti"],
        properties: {
          fornitore: { type: "string" },
          prezzo_totale: { type: "string", description: "Prezzo con valuta, es. '45.000 € + IVA'" },
          valutazione: { type: "string", enum: ["verde", "giallo", "rosso"] },
          punti_forti: { type: "array", items: { type: "string" } },
          punti_deboli: { type: "array", items: { type: "string" } },
          riferimenti: { type: "array", items: { type: "string" }, description: "Da dove vengono le informazioni, es. 'Preventivo Rossi, pag. 2'" },
        },
      },
    },
    comparativa: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterio", "spiegazione_criterio", "valori"],
        properties: {
          criterio: { type: "string", description: "Es. Prezzo, Garanzia, Tempi di consegna, Assistenza, Ricambi inclusi" },
          spiegazione_criterio: { type: "string", description: "Cosa significa questo criterio, in parole semplici" },
          valori: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fornitore", "valore", "giudizio"],
              properties: {
                fornitore: { type: "string" },
                valore: { type: "string" },
                giudizio: { type: "string", enum: ["verde", "giallo", "rosso"] },
              },
            },
          },
        },
      },
    },
    manutenzione: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["componente", "cosa_e", "intervallo", "tipo_intervento", "costo_indicativo", "fonte"],
        properties: {
          componente: { type: "string" },
          cosa_e: { type: "string", description: "Spiegazione semplice di cosa è questo pezzo e a cosa serve" },
          intervallo: { type: "string", description: "Ogni quanto va fatto, es. 'ogni 500 ore' o 'ogni 6 mesi'" },
          tipo_intervento: { type: "string", description: "Cosa bisogna fare: sostituire, lubrificare, controllare..." },
          costo_indicativo: { type: "string", description: "Se il documento lo dice; altrimenti 'non indicato'" },
          fonte: { type: "string", description: "Es. 'Scheda tecnica, pag. 12'" },
        },
      },
    },
    punti_attenzione: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titolo", "spiegazione", "gravita"],
        properties: {
          titolo: { type: "string" },
          spiegazione: { type: "string" },
          gravita: { type: "string", enum: ["alta", "media", "bassa"] },
        },
      },
    },
    glossario: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["termine", "spiegazione"],
        properties: {
          termine: { type: "string" },
          spiegazione: { type: "string" },
        },
      },
    },
  },
};

const PROMPT_SISTEMA = `Sei un consulente acquisti esperto di macchinari industriali che lavora per un'azienda italiana.

Il tuo pubblico: OPERATORI NON TECNICI, persone senza laurea in ingegneria. Regole di scrittura, sempre:
- Scrivi in italiano semplice e diretto, come spiegheresti a un collega davanti al caffè.
- Niente sigle o termini tecnici senza spiegarli subito; le parole difficili inevitabili vanno nel glossario.
- Frasi corte. Numeri concreti. Zero giri di parole.

Il tuo compito: leggere le schede tecniche e i preventivi allegati e aiutare l'azienda a decidere quale offerta accettare.

Regole di analisi:
- Basati SOLO su ciò che è scritto nei documenti. Se un'informazione manca, dillo chiaramente ("il preventivo non indica...") invece di inventare.
- Per ogni affermazione importante indica il documento e la pagina da cui l'hai presa (campi "riferimenti" e "fonte").
- Confronta le offerte anche su ciò che NON c'è scritto: voci presenti in un preventivo ma assenti nell'altro sono spesso costi nascosti.
- Considera il costo totale nel tempo (prezzo + manutenzioni + ricambi + assistenza), non solo il prezzo di listino.
- Per le manutenzioni: estrai dalla scheda tecnica ogni pezzo da sostituire o controllare, con che frequenza, e spiega cosa è quel pezzo.
- Se i documenti non bastano per un confronto affidabile, imposta livello_fiducia su "media" o "bassa" e spiega cosa manca.

Leggi i PDF con lo strumento Read, TUTTE le pagine di ogni documento. Non usare altri strumenti.`;

// Analisi in corso, per progetto: { in_corso, errore, avviata_il }
// (in memoria: un riavvio del servizio interrompe le analisi in corso)
const lavori = new Map();

export function statoAnalisi(progettoId) {
  return lavori.get(progettoId) || { in_corso: false, errore: null };
}

export function avviaAnalisi(progettoId) {
  if (statoAnalisi(progettoId).in_corso) return false;
  lavori.set(progettoId, { in_corso: true, errore: null, avviata_il: new Date().toISOString() });

  eseguiAnalisi(progettoId)
    .then(() => lavori.set(progettoId, { in_corso: false, errore: null }))
    .catch((err) => {
      console.error(`Analisi progetto ${progettoId} fallita:`, err);
      lavori.set(progettoId, { in_corso: false, errore: err.message || String(err) });
    });
  return true;
}

async function eseguiAnalisi(progettoId) {
  const { cartella, documenti, elenco } = await preparaCartella(progettoId, { prefisso: "analisi-", soloPdf: true });
  try {
    const istruzioni =
      `Nella cartella corrente ci sono ${documenti.length} documenti PDF:\n${elenco}\n\n` +
      "Leggi tutti i documenti qui sopra e produci il rapporto completo secondo lo schema richiesto. " +
      "Nei riferimenti usa il nome del fornitore o il nome file originale, non 'documento-01'. " +
      "Ricorda: il lettore non è un tecnico.";

    const esito = await eseguiClaude({
      istruzioni,
      cartella,
      sistema: PROMPT_SISTEMA,
      schema: SCHEMA_ANALISI,
      maxTurni: 60,
      timeoutMs: TIMEOUT_MS,
      cosa: "L'analisi",
    });

    // Con --json-schema il risultato validato arriva in "structured_output";
    // in mancanza, prova a interpretare il testo della risposta.
    let analisi = esito.structured_output;
    if (!analisi || typeof analisi !== "object") {
      try {
        analisi = JSON.parse(String(esito.result || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      } catch {
        throw new Error("Claude ha risposto in un formato inatteso. Riprova.");
      }
    }

    db.prepare("insert into analisi (id, progetto_id, risultato, creata_il) values (?, ?, ?, ?)")
      .run(crypto.randomUUID(), progettoId, JSON.stringify(analisi), new Date().toISOString());
  } finally {
    await rimuoviCartella(cartella);
  }
}
