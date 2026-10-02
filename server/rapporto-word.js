// ═══════════════════════════════════════════════════════════════
//  Rapporto Word (.docx) di un progetto — Portale Zoffoli
//
//  Costruisce un documento da presentare alla direzione a partire
//  dall'ultima analisi salvata. Modificabile in Word prima dell'invio.
// ═══════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, Packer,
  PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const LOGO = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "img", "logo.png"));

const BLU = "1D4E89";
const MUTO = "64748B";
const LARGHEZZA = 9638; // A4 con margini di 2 cm, in twip

const SEMAFORO = {
  verde: { fill: "ECFDF3", colore: "16A34A", etichetta: "Buona" },
  giallo: { fill: "FFFBEB", colore: "D97706", etichetta: "Con riserve" },
  rosso: { fill: "FEF2F2", colore: "DC2626", etichetta: "Sconsigliata" },
};
const FIDUCIA = {
  alta: "Alta — i documenti erano chiari e completi",
  media: "Media — alcune informazioni erano incomplete",
  bassa: "Bassa — mancano informazioni importanti, verificare bene",
};
const GRAVITA = { alta: "ALTA", media: "MEDIA", bassa: "BASSA" };
const TIPO_DOC = { preventivo: "Preventivo", scheda_tecnica: "Scheda tecnica", altro: "Altro" };

const dataIt = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

// ── Mattoncini ──
const titolo = (testo) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun(testo)] });
const sottotitolo = (testo) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun(testo)] });
const testo = (t, opz = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t || "", ...opz })] });
const etichetta = (t) => new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 18, color: MUTO })] });
const elenco = (voci) => (voci || []).map((v) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun(v)] }));

// Cella di tabella. "contenuto" è un testo, oppure un elenco di righe
// (testi o { t, grassetto, piccolo, colore } per formattarle una a una).
function cella(contenuto, { larghezza, fill, grassetto = false, colore } = {}) {
  const righe = (Array.isArray(contenuto) ? contenuto : [contenuto])
    .map((r) => (typeof r === "object" && r !== null ? r : { t: r }))
    .filter((r, i) => i === 0 || r.t);
  return new TableCell({
    width: { size: larghezza, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: righe.map((r) => new Paragraph({
      children: [new TextRun({
        text: r.t ?? "",
        bold: r.grassetto ?? grassetto,
        color: r.colore ?? colore,
        size: r.piccolo ? 16 : 20,
      })],
    })),
  });
}

const dueRighe = (principale, nota) => [{ t: principale, grassetto: true }, { t: nota, piccolo: true, colore: MUTO }];

function tabella(intestazioni, righe, larghezze) {
  return new Table({
    width: { size: LARGHEZZA, type: WidthType.DXA },
    columnWidths: larghezze,
    rows: [
      new TableRow({
        tableHeader: true,
        children: intestazioni.map((h, i) => cella(h, { larghezza: larghezze[i], fill: BLU, grassetto: true, colore: "FFFFFF" })),
      }),
      ...righe.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => c(larghezze[i])) })),
    ],
  });
}

// Divide la larghezza: prima colonna fissa, le altre in parti uguali
function colonne(n, primaColonna) {
  const resto = Math.floor((LARGHEZZA - primaColonna) / (n - 1));
  return [primaColonna, ...Array(n - 1).fill(resto)];
}

export async function creaRapportoWord({ progetto, documenti, analisi }) {
  const a = analisi.risultato;
  const corpo = [];

  // ── Copertina ──
  corpo.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1800, after: 600 },
      children: [new ImageRun({ type: "png", data: LOGO, transformation: { width: 280, height: Math.round(280 * 411 / 800) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: "VALUTAZIONE ACQUISTO", bold: true, size: 22, color: MUTO })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: progetto.nome, bold: true, size: 48, color: BLU })] }),
  );
  if (progetto.descrizione) {
    corpo.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: progetto.descrizione, size: 26 })] }));
  }
  corpo.push(
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200 },
      children: [new TextRun({ text: `Documento preparato il ${dataIt(new Date().toISOString())}`, color: MUTO })] }),
    new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Analisi del ${dataIt(analisi.creata_il)} su ${documenti.length} documenti`, color: MUTO })] }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ── Sintesi e consiglio ──
  if (a.riepilogo) {
    corpo.push(titolo("In breve"), testo(a.riepilogo));
  }
  if (a.verdetto) {
    const v = a.verdetto;
    corpo.push(
      titolo("Offerta consigliata"),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: v.fornitore_consigliato || "—", bold: true, size: 32, color: BLU })] }),
      testo(v.motivazione_semplice),
      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun({ text: "Affidabilità del consiglio: ", bold: true }),
        new TextRun(FIDUCIA[v.livello_fiducia] || v.livello_fiducia || ""),
      ] }),
    );
    if (v.cosa_verificare_prima_di_firmare?.length) {
      corpo.push(etichetta("Prima di firmare, verificare"), ...elenco(v.cosa_verificare_prima_di_firmare));
    }
  }

  // ── Offerte ──
  if (a.offerte?.length) {
    corpo.push(titolo("Le offerte"));
    for (const o of a.offerte) {
      const s = SEMAFORO[o.valutazione];
      corpo.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [
        new TextRun(o.fornitore),
        new TextRun({ text: o.prezzo_totale ? `  —  ${o.prezzo_totale}` : "" }),
      ] }));
      if (s) corpo.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `● Valutazione: ${s.etichetta}`, bold: true, color: s.colore })] }));
      if (o.punti_forti?.length) corpo.push(etichetta("Punti a favore"), ...elenco(o.punti_forti));
      if (o.punti_deboli?.length) corpo.push(etichetta("Punti contro"), ...elenco(o.punti_deboli));
      if (o.riferimenti?.length) corpo.push(testo("Fonti: " + o.riferimenti.join(" · "), { italics: true, size: 16, color: MUTO }));
    }
  }

  // ── Tabella comparativa ──
  if (a.comparativa?.length) {
    const fornitori = [];
    for (const c of a.comparativa) for (const v of c.valori || []) if (!fornitori.includes(v.fornitore)) fornitori.push(v.fornitore);
    const larghezze = colonne(fornitori.length + 1, fornitori.length > 3 ? 2200 : 2800);
    corpo.push(
      titolo("Confronto punto per punto"),
      tabella(["Criterio", ...fornitori], a.comparativa.map((c) => [
        (w) => cella(dueRighe(c.criterio, c.spiegazione_criterio), { larghezza: w }),
        ...fornitori.map((f) => (w) => {
          const v = (c.valori || []).find((x) => x.fornitore === f);
          return cella(v ? v.valore : "—", { larghezza: w, fill: v ? SEMAFORO[v.giudizio]?.fill : undefined });
        }),
      ]), larghezze),
      testo("Verde = favorevole · Giallo = accettabile con riserve · Rosso = sfavorevole", { size: 16, color: MUTO }),
    );
  }

  // ── Manutenzioni ──
  if (a.manutenzione?.length) {
    corpo.push(
      titolo("Piano manutenzioni e ricambi"),
      tabella(["Componente", "Che cos'è", "Ogni quanto", "Cosa fare", "Costo"], a.manutenzione.map((m) => [
        (w) => cella(dueRighe(m.componente, m.fonte), { larghezza: w }),
        (w) => cella(m.cosa_e, { larghezza: w }),
        (w) => cella(m.intervallo, { larghezza: w }),
        (w) => cella(m.tipo_intervento, { larghezza: w }),
        (w) => cella(m.costo_indicativo, { larghezza: w }),
      ]), [1900, 2538, 1600, 2000, 1600]),
    );
  }

  // ── Punti di attenzione ──
  if (a.punti_attenzione?.length) {
    corpo.push(titolo("Punti di attenzione"));
    for (const p of a.punti_attenzione) {
      corpo.push(
        new Paragraph({ spacing: { before: 160, after: 40 }, children: [
          new TextRun({ text: `[${GRAVITA[p.gravita] || ""}] `, bold: true, color: p.gravita === "alta" ? "DC2626" : MUTO }),
          new TextRun({ text: p.titolo, bold: true }),
        ] }),
        testo(p.spiegazione),
      );
    }
  }

  // ── Documenti analizzati ──
  corpo.push(
    titolo("Documenti analizzati"),
    tabella(["Documento", "Tipo", "Fornitore"], documenti.map((d) => [
      (w) => cella(d.nome_file, { larghezza: w }),
      (w) => cella(TIPO_DOC[d.tipo] || d.tipo, { larghezza: w }),
      (w) => cella(d.fornitore || "—", { larghezza: w }),
    ]), [5038, 2000, 2600]),
  );

  // ── Glossario ──
  if (a.glossario?.length) {
    corpo.push(sottotitolo("Glossario"));
    for (const g of a.glossario) {
      corpo.push(new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: g.termine + ": ", bold: true }), new TextRun(g.spiegazione),
      ] }));
    }
  }

  corpo.push(testo(
    "Analisi preparata con l'assistente AI del Portale Zoffoli. I dati importanti vanno verificati sui documenti originali.",
    { italics: true, size: 16, color: MUTO },
  ));

  const doc = new Document({
    creator: "Portale Zoffoli",
    title: `Valutazione acquisto — ${progetto.nome}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 21 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 30, bold: true, color: BLU }, paragraph: { keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0", space: 4 } } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, color: "1E2733" }, paragraph: { keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } }, titlePage: true },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          new TextRun({ text: `${progetto.nome} · pag. `, size: 16, color: MUTO }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTO }),
        ] })] }),
      },
      children: corpo,
    }],
  });

  return Packer.toBuffer(doc);
}
