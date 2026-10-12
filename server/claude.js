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

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "opus";

const ETICHETTE = {
  scheda_tecnica: "SCHEDA TECNICA",
  preventivo: "PREVENTIVO",
  altro: "DOCUMENTO",
};

// Copia i PDF del progetto in una cartella temporanea con nomi semplici
// (documento-01.pdf, ...). Restituisce la cartella e l'elenco descrittivo
// da mettere nel prompt. La cartella va rimossa con rimuoviCartella().
export async function preparaCartella(progettoId, prefisso = "lavoro-") {
  const documenti = db
    .prepare("select * from documenti where progetto_id = ? order by tipo desc, caricato_il")
    .all(progettoId);
  if (documenti.length === 0) throw new Error("Nessun documento trovato per questo progetto.");

  const cartella = await fs.mkdtemp(path.join(os.tmpdir(), prefisso));
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
    return { cartella, documenti, elenco: righe.join("\n") };
  } catch (err) {
    await rimuoviCartella(cartella);
    throw err;
  }
}

export function rimuoviCartella(cartella) {
  return fs.rm(cartella, { recursive: true, force: true });
}

// Lancia `claude -p` e restituisce l'esito JSON della CLI
// (campi utili: result, structured_output, total_cost_usd, duration_ms).
export function eseguiClaude({ istruzioni, cartella, sistema, schema, maxTurni = 60, timeoutMs, cosa = "L'operazione" }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", CLAUDE_MODEL,
    "--append-system-prompt", sistema,
    // Unico strumento disponibile: la lettura dei file della cartella di lavoro
    "--tools", "Read",
    "--allowedTools", "Read",
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
