// ═══════════════════════════════════════════════════════════════
//  Analisi AI — Portale Zoffoli
//
//  Copia i PDF del progetto in una cartella temporanea e li fa
//  leggere a Claude tramite la CLI di Claude Code in modalità
//  non interattiva (`claude -p`). Il risultato JSON viene salvato
//  nella tabella "analisi".
//
//  Autenticazione (nel file .env, mai nel codice):
//    - fase di test:  CLAUDE_CODE_OAUTH_TOKEN=...   (da `claude setup-token`)
//    - con licenza:   ANTHROPIC_API_KEY=sk-ant-...  (sostituisce il token)
//  Il codice non cambia: la CLI usa ciò che trova nell'ambiente.
// ═══════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, DOCUMENTI_DIR } from "./db.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "opus";
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

const ETICHETTE = {
  scheda_tecnica: "SCHEDA TECNICA",
  preventivo: "PREVENTIVO",
  altro: "DOCUMENTO",
};

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
  // 1. Elenco documenti (schede tecniche prima dei preventivi)
  const documenti = db
    .prepare("select * from documenti where progetto_id = ? order by tipo desc, caricato_il")
    .all(progettoId);
  if (documenti.length === 0) throw new Error("Nessun documento trovato per questo progetto.");

  // 2. Copia i PDF in una cartella di lavoro temporanea con nomi semplici
  const cartella = await fs.mkdtemp(path.join(os.tmpdir(), "analisi-"));
  try {
    const righe = [];
    for (let i = 0; i < documenti.length; i++) {
      const doc = documenti[i];
      const nome = `documento-${String(i + 1).padStart(2, "0")}.pdf`;
      try {
        await fs.copyFile(path.join(DOCUMENTI_DIR, doc.storage_path), path.join(cartella, nome));
      } catch {
        throw new Error(`Impossibile leggere il file "${doc.nome_file}".`);
      }
      const etichetta = ETICHETTE[doc.tipo] ?? "DOCUMENTO";
      const fornitore = doc.fornitore ? ` — Fornitore: ${doc.fornitore}` : "";
      righe.push(`- ${nome}: ${etichetta}${fornitore} — Nome file originale: ${doc.nome_file}`);
    }

    const istruzioni =
      `Nella cartella corrente ci sono ${documenti.length} documenti PDF:\n${righe.join("\n")}\n\n` +
      "Leggi tutti i documenti qui sopra e produci il rapporto completo secondo lo schema richiesto. " +
      "Nei riferimenti usa il nome del fornitore o il nome file originale, non 'documento-01'. " +
      "Ricorda: il lettore non è un tecnico.";

    // 3. Chiama Claude
    const analisi = await chiamaClaude(istruzioni, cartella);

    // 4. Salva il risultato
    db.prepare("insert into analisi (id, progetto_id, risultato, creata_il) values (?, ?, ?, ?)")
      .run(crypto.randomUUID(), progettoId, JSON.stringify(analisi), new Date().toISOString());
  } finally {
    await fs.rm(cartella, { recursive: true, force: true });
  }
}

function chiamaClaude(istruzioni, cartella) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", CLAUDE_MODEL,
    "--json-schema", JSON.stringify(SCHEMA_ANALISI),
    "--append-system-prompt", PROMPT_SISTEMA,
    // Unico strumento disponibile: la lettura dei file della cartella di lavoro
    "--tools", "Read",
    "--allowedTools", "Read",
    "--max-turns", "60",
  ];

  // Le righe vuote del .env (es. ANTHROPIC_API_KEY=) non vanno passate alla CLI
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) if (!env[k]) delete env[k];

  return new Promise((resolve, reject) => {
    const figlio = spawn(CLAUDE_BIN, args, {
      cwd: cartella,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    figlio.stdout.on("data", (d) => (stdout += d));
    figlio.stderr.on("data", (d) => (stderr += d));

    const timer = setTimeout(() => {
      figlio.kill("SIGTERM");
      reject(new Error(`L'analisi ha superato ${TIMEOUT_MS / 60000} minuti ed è stata interrotta. Prova con meno documenti alla volta.`));
    }, TIMEOUT_MS);

    figlio.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(
        err.code === "ENOENT"
          ? "Claude Code non è installato sul server (comando 'claude' non trovato)."
          : "Impossibile avviare Claude Code: " + err.message,
      ));
    });

    figlio.on("close", (codice) => {
      clearTimeout(timer);

      let esito;
      try {
        esito = JSON.parse(stdout);
      } catch {
        console.error("Output Claude non valido. stderr:", stderr, "stdout:", stdout.slice(0, 2000));
        return reject(new Error(
          "Risposta non valida da Claude Code" + (stderr ? ": " + stderr.trim().slice(0, 300) : ` (codice ${codice}).`),
        ));
      }

      if (esito.is_error || esito.subtype !== "success") {
        console.error("Claude ha restituito un errore:", esito);
        if (esito.subtype === "error_max_turns") {
          return reject(new Error("L'analisi è troppo lunga per essere completata. Prova con meno documenti alla volta."));
        }
        return reject(new Error("Claude non ha completato l'analisi: " + (esito.result || esito.subtype || "errore sconosciuto")));
      }

      if (esito.total_cost_usd !== undefined) {
        console.log(`Analisi completata in ${Math.round((esito.duration_ms || 0) / 1000)} s (costo equivalente API: $${esito.total_cost_usd.toFixed(2)})`);
      }

      // Con --json-schema il risultato validato arriva in "structured_output";
      // in mancanza, prova a interpretare il testo della risposta.
      if (esito.structured_output && typeof esito.structured_output === "object") {
        return resolve(esito.structured_output);
      }
      try {
        const testo = String(esito.result || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        resolve(JSON.parse(testo));
      } catch {
        reject(new Error("Claude ha risposto in un formato inatteso. Riprova."));
      }
    });

    figlio.stdin.end(istruzioni);
  });
}
