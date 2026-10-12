// ═══════════════════════════════════════════════════════════════
//  File di produzione (Excel / CSV) — Portale Zoffoli
//
//  Claude non legge i file Excel: ogni foglio viene convertito in un
//  CSV (UTF-8, separatore virgola, date ISO) che Claude analizza con Python.
// ═══════════════════════════════════════════════════════════════

import * as XLSX from "xlsx";

export const ESTENSIONI_PRODUZIONE = ["xlsx", "xls", "csv"];

// Riconosce il formato dai primi byte del file (non ci si fida del nome)
export function formatoProduzione(buffer, nomeFile) {
  const ext = String(nomeFile || "").toLowerCase().split(".").pop();
  const testa = buffer.subarray(0, 4);
  if (testa.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "xlsx";        // archivio ZIP (xlsx)
  if (testa.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return "xls";         // vecchio formato Excel
  if (ext === "csv" && !buffer.subarray(0, 4096).includes(0)) return "csv";       // testo senza byte nulli
  return null;
}

// Converte il file in un CSV per foglio. Restituisce
// [{ foglio, csv, righe, intestazione }] saltando i fogli vuoti.
export function excelInCsv(buffer) {
  const cartella = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: true });
  const fogli = [];
  for (const nome of cartella.SheetNames) {
    // Valori grezzi (numeri come numeri, date come Date), una riga per array
    const righe = XLSX.utils.sheet_to_json(cartella.Sheets[nome], { header: 1, raw: true, defval: "", blankrows: false })
      .filter((r) => r.some((v) => v !== ""));
    if (righe.length === 0) continue;
    const csv = righe.map((r) => r.map(valoreCsv).join(",")).join("\n") + "\n";
    fogli.push({ foglio: nome, csv, righe: righe.length - 1, intestazione: righe[0].map(valoreCsv).join(",") });
  }
  return fogli;
}

// Date in ISO (aaaa-mm-gg o aaaa-mm-gg hh:mm), numeri con il punto decimale,
// testi tra virgolette se contengono virgole, virgolette o a capo
function valoreCsv(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // SheetJS crea le date nell'ora locale: si usano i componenti locali
    // (con toISOString una data "pura" diventerebbe il giorno prima alle 22/23)
    const due = (n) => String(n).padStart(2, "0");
    const data = `${v.getFullYear()}-${due(v.getMonth() + 1)}-${due(v.getDate())}`;
    return v.getHours() || v.getMinutes() ? `${data} ${due(v.getHours())}:${due(v.getMinutes())}` : data;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v ?? "").trim();
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
