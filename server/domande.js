// ═══════════════════════════════════════════════════════════════
//  Domande sui documenti e sull'analisi — Portale Zoffoli
//
//  Ogni domanda viene salvata subito (stato "in_corso"); la risposta
//  di Claude arriva in background e aggiorna la riga. Il browser
//  ricarica la conversazione finché ci sono domande in corso.
// ═══════════════════════════════════════════════════════════════

import crypto from "node:crypto";
import { db } from "./db.js";
import { eseguiClaude, preparaCartella, rimuoviCartella } from "./claude.js";

const TIMEOUT_MS = Number(process.env.DOMANDE_TIMEOUT_MIN || 8) * 60 * 1000;
const STORICO = 8; // quante domande/risposte precedenti passare come contesto

const PROMPT_DOMANDE = `Sei un consulente acquisti esperto di macchinari industriali che lavora per un'azienda italiana.
Rispondi alle domande dei colleghi su un progetto di acquisto: i documenti PDF del progetto (schede tecniche e preventivi) e l'analisi comparativa già preparata.

Il tuo pubblico: OPERATORI NON TECNICI. Regole di scrittura, sempre:
- Italiano semplice e diretto, frasi corte, numeri concreti.
- Rispondi prima alla domanda in una o due frasi, poi aggiungi i dettagli utili. Niente premesse.
- Spiega subito ogni termine tecnico che usi.
- Formattazione ammessa: paragrafi, elenchi puntati con "- ", elenchi numerati, **grassetto**. Niente tabelle, niente titoli.

Regole sul contenuto:
- Basati SOLO su documenti e analisi. Se l'informazione non c'è, dillo chiaramente invece di inventare.
- Indica sempre da dove prendi i dati: fornitore o nome file originale e pagina, es. (Preventivo Rossi, pag. 2). Non citare mai i nomi "documento-01.pdf".
- Se l'analisi basta per rispondere, non rileggere i PDF. Se serve un dettaglio che l'analisi non riporta, o se la domanda chiede di verificare un dato, leggi i PDF pertinenti con lo strumento Read.
- Se la domanda non riguarda questo acquisto, rispondi brevemente che puoi aiutare solo su documenti e analisi del progetto.`;

// Una sola domanda in corso per progetto
export function domandaInCorso(progettoId) {
  return !!db.prepare("select 1 from domande where progetto_id = ? and stato = 'in_corso'").get(progettoId);
}

export function elencoDomande(progettoId) {
  return db.prepare("select * from domande where progetto_id = ? order by creata_il").all(progettoId);
}

export function cancellaConversazione(progettoId) {
  db.prepare("delete from domande where progetto_id = ? and stato != 'in_corso'").run(progettoId);
}

export function faiDomanda(progettoId, domanda) {
  const riga = {
    id: crypto.randomUUID(),
    progetto_id: progettoId,
    domanda,
    stato: "in_corso",
    creata_il: new Date().toISOString(),
  };
  db.prepare("insert into domande (id, progetto_id, domanda, stato, creata_il) values (@id, @progetto_id, @domanda, @stato, @creata_il)")
    .run(riga);

  rispondi(riga)
    .then((risposta) => {
      db.prepare("update domande set stato = 'completata', risposta = ?, risposta_il = ? where id = ?")
        .run(risposta, new Date().toISOString(), riga.id);
    })
    .catch((err) => {
      console.error(`Domanda ${riga.id} fallita:`, err);
      db.prepare("update domande set stato = 'errore', errore = ?, risposta_il = ? where id = ?")
        .run(err.message || String(err), new Date().toISOString(), riga.id);
    });

  return riga;
}

async function rispondi({ id, progetto_id: progettoId, domanda }) {
  const progetto = db.prepare("select nome, descrizione from progetti where id = ?").get(progettoId);
  const analisi = db.prepare("select risultato, creata_il from analisi where progetto_id = ? order by creata_il desc limit 1")
    .get(progettoId);
  const precedenti = db.prepare(
    `select domanda, risposta from domande
     where progetto_id = ? and stato = 'completata' and id != ?
     order by creata_il desc limit ?`,
  ).all(progettoId, id, STORICO).reverse();

  const { cartella, documenti, elenco } = await preparaCartella(progettoId, "domanda-");
  try {
    let istruzioni = `PROGETTO: ${progetto.nome}${progetto.descrizione ? " — " + progetto.descrizione : ""}\n\n`;
    istruzioni += `DOCUMENTI PDF nella cartella corrente (${documenti.length}):\n${elenco}\n\n`;
    istruzioni += analisi
      ? `ANALISI GIÀ PREPARATA (JSON, del ${analisi.creata_il.slice(0, 10)}):\n${analisi.risultato}\n\n`
      : "ANALISI: non ancora fatta. Per rispondere leggi i PDF.\n\n";
    if (precedenti.length) {
      istruzioni += "CONVERSAZIONE PRECEDENTE:\n" +
        precedenti.map((p) => `Domanda: ${p.domanda}\nRisposta: ${p.risposta}`).join("\n\n") + "\n\n";
    }
    istruzioni += `NUOVA DOMANDA:\n${domanda}`;

    const esito = await eseguiClaude({
      istruzioni,
      cartella,
      sistema: PROMPT_DOMANDE,
      maxTurni: 30,
      timeoutMs: TIMEOUT_MS,
      cosa: "La risposta",
    });
    const risposta = String(esito.result || "").trim();
    if (!risposta) throw new Error("Claude non ha dato una risposta. Riprova.");
    return risposta;
  } finally {
    await rimuoviCartella(cartella);
  }
}
