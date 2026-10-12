// ═══════════════════════════════════════════════════════════════
//  Chiamate a Claude — Portale Zoffoli
//
//  Usa la CLI di Claude Code in modalità non interattiva (`claude -p`)
//  dentro una cartella temporanea con le copie dei PDF del progetto.
//  Usato sia dall'analisi (analisi.js) sia dalle domande (domande.js).
//
//  Autenticazione (nel file .env, mai nel codice):
//    - fase di test:  CLAUDE_CODE_OAUTH_TOKEN=...   (da `claude setup-token`)
//    - con licenza:   ANTHROPIC_API_KEY=sk-ant-...  (sostituisce il token)
//  Il codice non cambia: la CLI usa ciò che trova nell'ambiente.
// ═══════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, DOCUMENTI_DIR } from "./db.js";
import { excelInCsv } from "./excel.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "opus";

const ETICHETTE = {
  scheda_tecnica: "SCHEDA TECNICA",
  preventivo: "PREVENTIVO",
  altro: "DOCUMENTO",
};

// Copia i documenti del progetto in una cartella temporanea con nomi semplici:
//   PDF            → documento-01.pdf, documento-02.pdf, ...
//   Excel/CSV      → produzione-01-<foglio>.csv (un CSV per foglio)
// "soloPdf" esclude i dati di produzione (usato dall'analisi delle offerte).
// Restituisce la cartella, l'elenco descrittivo da mettere nel prompt e
// quanti file di ogni genere ci sono. Va rimossa con rimuoviCartella().
export async function preparaCartella(progettoId, { prefisso = "lavoro-", soloPdf = false } = {}) {
  const documenti = db
    .prepare("select * from documenti where progetto_id = ? order by tipo desc, caricato_il")
    .all(progettoId)
    .filter((d) => !soloPdf || d.tipo !== "produzione");
  if (documenti.length === 0) {
    throw new Error(soloPdf ? "Nessun documento PDF trovato per questo progetto." : "Nessun documento trovato per questo progetto.");
  }

  const cartella = await fs.mkdtemp(path.join(os.tmpdir(), prefisso));
  try {
    const righe = [];
    let nPdf = 0;
    let nProduzione = 0;
    for (const doc of documenti) {
      let contenuto;
      try {
        contenuto = await fs.readFile(path.join(DOCUMENTI_DIR, doc.storage_path));
      } catch {
        throw new Error(`Impossibile leggere il file "${doc.nome_file}".`);
      }
      const fornitore = doc.fornitore ? ` — Fornitore/macchina: ${doc.fornitore}` : "";

      if (doc.tipo === "produzione") {
        nProduzione++;
        let fogli;
        try {
          fogli = excelInCsv(contenuto);
        } catch {
          throw new Error(`Il file di produzione "${doc.nome_file}" non è leggibile.`);
        }
        for (const f of fogli) {
          const nome = `produzione-${String(nProduzione).padStart(2, "0")}-${nomeSicuro(f.foglio)}.csv`;
          await fs.writeFile(path.join(cartella, nome), f.csv);
          righe.push(`- ${nome}: DATI DI PRODUZIONE${fornitore} — foglio "${f.foglio}" del file "${doc.nome_file}" — ` +
            `${f.righe} righe di dati — intestazione: ${f.intestazione.slice(0, 500)}`);
        }
      } else {
        nPdf++;
        const nome = `documento-${String(nPdf).padStart(2, "0")}.pdf`;
        await fs.writeFile(path.join(cartella, nome), contenuto);
        righe.push(`- ${nome}: ${ETICHETTE[doc.tipo] ?? "DOCUMENTO"}${fornitore} — Nome file originale: ${doc.nome_file}`);
      }
    }
    return { cartella, documenti, elenco: righe.join("\n"), nPdf, nProduzione };
  } catch (err) {
    await rimuoviCartella(cartella);
    throw err;
  }
}

const nomeSicuro = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "foglio";

// Strumenti concessi a Claude: solo lettura dei file, oppure lettura + Python
// (per i calcoli sui dati di produzione: unico comando shell consentito)
export const STRUMENTI_LETTURA = { tools: "Read", consentiti: ["Read"] };
export const STRUMENTI_PYTHON = { tools: "Read,Bash", consentiti: ["Read", "Bash(python3:*)"] };

export function rimuoviCartella(cartella) {
  return fs.rm(cartella, { recursive: true, force: true });
}

// Lancia `claude -p` e restituisce l'esito JSON della CLI
// (campi utili: result, structured_output, total_cost_usd, duration_ms).
export function eseguiClaude({
  istruzioni, cartella, sistema, schema, maxTurni = 60, timeoutMs, cosa = "L'operazione",
  strumenti = STRUMENTI_LETTURA,
}) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", CLAUDE_MODEL,
    "--append-system-prompt", sistema,
    "--tools", strumenti.tools,
    "--allowedTools", ...strumenti.consentiti,
    "--max-turns", String(maxTurni),
  ];
  if (schema) args.push("--json-schema", JSON.stringify(schema));

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
      reject(new Error(`${cosa} ha superato ${Math.round(timeoutMs / 60000)} minuti ed è stata interrotta.`));
    }, timeoutMs);

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
          return reject(new Error(`${cosa} è troppo lunga per essere completata. Prova con meno documenti alla volta.`));
        }
        return reject(new Error("Claude non ha completato la richiesta: " + (esito.result || esito.subtype || "errore sconosciuto")));
      }

      if (esito.total_cost_usd !== undefined) {
        console.log(`${cosa} completata in ${Math.round((esito.duration_ms || 0) / 1000)} s (costo equivalente API: $${esito.total_cost_usd.toFixed(2)})`);
      }
      resolve(esito);
    });

    figlio.stdin.end(istruzioni);
  });
}
