// ═══════════════════════════════════════════════════════════════
//  Portale Zoffoli — rapporto stampabile per la direzione
//  Aperto da index.html con  rapporto.html?id=<progetto>
// ═══════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

const SEMAFORO = { verde: "Buona", giallo: "Con riserve", rosso: "Sconsigliata" };
const FIDUCIA = {
  alta: "Alta — i documenti erano chiari e completi",
  media: "Media — alcune informazioni erano incomplete",
  bassa: "Bassa — mancano informazioni importanti, verificare bene",
};
const GIUDIZIO_RENDIMENTO = { verde: "Rende bene", giallo: "Migliorabile", rosso: "Problemi seri" };
const TIPO_DOC = { preventivo: "Preventivo", scheda_tecnica: "Scheda tecnica", altro: "Altro", produzione: "Dati di produzione" };

function escapeHtml(testo) {
  if (testo === null || testo === undefined) return "";
  return String(testo)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
const e = escapeHtml;
const dataIt = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
const lista = (voci) => (voci && voci.length ? `<ul>${voci.map((v) => `<li>${e(v)}</li>`).join("")}</ul>` : "");

async function avvia() {
  const id = new URLSearchParams(location.search).get("id");
  let dati;
  try {
    const r = await fetch(`/api/progetti/${encodeURIComponent(id || "")}/rapporto`);
    const corpo = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("Sessione scaduta: accedi di nuovo al portale e riapri il rapporto.");
    if (!r.ok) throw new Error(corpo.errore || `Errore del server (${r.status})`);
    dati = corpo;
  } catch (ex) {
    $("barra-msg").textContent = "Impossibile creare il rapporto";
    $("rapporto").innerHTML = `<p class="errore">${e(ex.message)}</p>`;
    return;
  }

  $("rapporto").innerHTML = componi(dati);
  // Il titolo della pagina diventa il nome proposto per il file PDF
  document.title = `Valutazione - ${dati.progetto.nome}`;
  $("barra-msg").textContent = dati.progetto.nome;
  $("btn-stampa").disabled = false;
  $("suggerimento").hidden = false;
}

function componi({ progetto, documenti, analisi, rendimento }) {
  // Il rapporto può avere l'analisi delle offerte, lo studio del rendimento o entrambi
  const a = analisi?.risultato || {};
  const r = rendimento?.risultato;
  let h = "";

  // Copertina
  const eyebrow = analisi && rendimento ? "VALUTAZIONE MACCHINARIO" : analisi ? "VALUTAZIONE ACQUISTO" : "RENDIMENTO MACCHINARIO";
  h += `<section class="copertina">
    <img src="img/logo.png" alt="Zoffoli Metalli">
    <div class="eyebrow">${eyebrow}</div>
    <h1>${e(progetto.nome)}</h1>
    ${progetto.descrizione ? `<div class="descr">${e(progetto.descrizione)}</div>` : ""}
    <div class="date">Documento preparato il ${dataIt(new Date().toISOString())}<br>
      ${analisi ? `Analisi delle offerte del ${dataIt(analisi.creata_il)}<br>` : ""}
      ${rendimento ? `Studio del rendimento del ${dataIt(rendimento.creata_il)}<br>` : ""}
      ${documenti.length} documenti nel progetto</div>
  </section>`;

  if (a.riepilogo) h += `<h2>In breve</h2><p>${e(a.riepilogo)}</p>`;

  if (a.verdetto) {
    const v = a.verdetto;
    h += `<h2>Offerta consigliata</h2><div class="consigliato">
      <div class="nome">${e(v.fornitore_consigliato || "—")}</div>
      <p>${e(v.motivazione_semplice)}</p>
      <p><strong>Affidabilità del consiglio:</strong> ${e(FIDUCIA[v.livello_fiducia] || v.livello_fiducia)}</p>
      ${v.cosa_verificare_prima_di_firmare?.length ? `<div class="etichetta">Prima di firmare, verificare</div>${lista(v.cosa_verificare_prima_di_firmare)}` : ""}
    </div>`;
  }

  if (a.offerte?.length) {
    h += `<h2>Le offerte</h2>`;
    for (const o of a.offerte) {
      h += `<div class="offerta">
        <h3>${e(o.fornitore)}${o.prezzo_totale ? ` <span class="prezzo">— ${e(o.prezzo_totale)}</span>` : ""}</h3>
        ${SEMAFORO[o.valutazione] ? `<div class="pallino ${o.valutazione}">● Valutazione: ${SEMAFORO[o.valutazione]}</div>` : ""}
        ${o.punti_forti?.length ? `<div class="etichetta">Punti a favore</div>${lista(o.punti_forti)}` : ""}
        ${o.punti_deboli?.length ? `<div class="etichetta">Punti contro</div>${lista(o.punti_deboli)}` : ""}
        ${o.riferimenti?.length ? `<p class="nota">Fonti: ${o.riferimenti.map(e).join(" · ")}</p>` : ""}
      </div>`;
    }
  }

  if (a.comparativa?.length) {
    const fornitori = [];
    for (const c of a.comparativa) for (const v of c.valori || []) if (!fornitori.includes(v.fornitore)) fornitori.push(v.fornitore);
    h += `<h2>Confronto punto per punto</h2><table><thead><tr><th>Criterio</th>${fornitori.map((f) => `<th>${e(f)}</th>`).join("")}</tr></thead><tbody>`;
    for (const c of a.comparativa) {
      h += `<tr><td><strong>${e(c.criterio)}</strong>${c.spiegazione_criterio ? `<small>${e(c.spiegazione_criterio)}</small>` : ""}</td>`;
      for (const f of fornitori) {
        const v = (c.valori || []).find((x) => x.fornitore === f);
        h += v ? `<td class="${e(v.giudizio)}">${e(v.valore)}</td>` : `<td>—</td>`;
      }
      h += `</tr>`;
    }
    h += `</tbody></table><p class="nota">Verde = favorevole · Giallo = accettabile con riserve · Rosso = sfavorevole</p>`;
  }

  if (a.manutenzione?.length) {
    h += `<h2>Piano manutenzioni e ricambi</h2><table><thead><tr>
      <th>Componente</th><th>Che cos'è</th><th>Ogni quanto</th><th>Cosa fare</th><th>Costo</th></tr></thead><tbody>`;
    for (const m of a.manutenzione) {
      h += `<tr><td><strong>${e(m.componente)}</strong>${m.fonte ? `<small>${e(m.fonte)}</small>` : ""}</td>
        <td>${e(m.cosa_e)}</td><td>${e(m.intervallo)}</td><td>${e(m.tipo_intervento)}</td><td>${e(m.costo_indicativo)}</td></tr>`;
    }
    h += `</tbody></table>`;
  }

  if (a.punti_attenzione?.length) {
    h += `<h2>Punti di attenzione</h2>`;
    for (const p of a.punti_attenzione) {
      h += `<div class="attenzione"><span class="gravita ${p.gravita === "alta" ? "alta" : ""}">${e((p.gravita || "").toUpperCase())}</span>
        <strong>${e(p.titolo)}</strong><p>${e(p.spiegazione)}</p></div>`;
    }
  }

  if (r) h += componiRendimento(r);

  h += `<h2>Documenti analizzati</h2><table><thead><tr><th>Documento</th><th>Tipo</th><th>Fornitore</th></tr></thead><tbody>`;
  for (const d of documenti) {
    h += `<tr><td>${e(d.nome_file)}</td><td>${e(TIPO_DOC[d.tipo] || d.tipo)}</td><td>${e(d.fornitore || "—")}</td></tr>`;
  }
  h += `</tbody></table>`;

  if (a.glossario?.length) {
    h += `<h2>Glossario</h2>`;
    for (const g of a.glossario) h += `<p><strong>${e(g.termine)}:</strong> ${e(g.spiegazione)}</p>`;
  }

  h += `<p class="nota" style="margin-top:8mm">Analisi preparata con l'assistente AI del Portale Zoffoli.
    I dati importanti vanno verificati sui documenti originali.</p>`;
  return h;
}

// Sezione "Rendimento del macchinario" (dai dati di produzione Excel)
function componiRendimento(r) {
  const g = GIUDIZIO_RENDIMENTO[r.giudizio?.valutazione];
  let h = `<h2>Rendimento del macchinario</h2>`;
  if (r.periodo_analizzato) h += `<p class="nota">Periodo analizzato: ${e(r.periodo_analizzato)}</p>`;
  if (r.riepilogo) h += `<p>${e(r.riepilogo)}</p>`;
  if (r.giudizio) {
    h += `<div class="consigliato"><div class="pallino ${e(r.giudizio.valutazione)}">● ${g || "Giudizio"}</div>
      <p>${e(r.giudizio.spiegazione)}</p></div>`;
  }

  if (r.indicatori?.length) {
    h += `<h3>Indicatori principali</h3><table><thead><tr><th>Indicatore</th><th>Valore</th><th>Confronto</th></tr></thead><tbody>`;
    for (const i of r.indicatori) {
      h += `<tr><td><strong>${e(i.nome)}</strong><small>${e(i.cosa_significa)}</small></td>
        <td class="${e(i.giudizio)}"><strong>${e(i.valore)}</strong></td><td>${e(i.riferimento)}</td></tr>`;
    }
    h += `</tbody></table>`;
  }
  if (r.andamento?.length) {
    h += `<h3>Andamento nel tempo</h3><table><thead><tr><th>Periodo</th><th>Numeri principali</th><th>Commento</th></tr></thead><tbody>`;
    for (const p of r.andamento) {
      h += `<tr><td><strong>${e(p.periodo)}</strong></td><td class="${e(p.giudizio)}">${e(p.valori)}</td><td>${e(p.commento)}</td></tr>`;
    }
    h += `</tbody></table>`;
  }
  if (r.fermi_e_problemi?.length) {
    h += `<h3>Fermi e problemi principali</h3><table><thead><tr><th>Problema</th><th>Quanto pesa</th><th>Spiegazione</th></tr></thead><tbody>`;
    for (const f of r.fermi_e_problemi) {
      h += `<tr><td><strong>${e(f.problema)}</strong></td><td>${e(f.quanto_pesa)}</td><td>${e(f.spiegazione)}</td></tr>`;
    }
    h += `</tbody></table>`;
  }
  if (r.cosa_va_bene?.length) h += `<h3>Cosa funziona bene</h3>${lista(r.cosa_va_bene)}`;
  if (r.consigli?.length) {
    h += `<h3>Consigli</h3>`;
    for (const c of r.consigli) {
      h += `<div class="attenzione"><span class="gravita ${c.priorita === "alta" ? "alta" : ""}">PRIORITÀ ${e((c.priorita || "").toUpperCase())}</span>
        <strong>${e(c.azione)}</strong><p>${e(c.perche)}<br><em>Beneficio atteso: ${e(c.beneficio_atteso)}</em></p></div>`;
    }
  }
  if (r.dati_mancanti?.length) h += `<h3>Per uno studio più preciso servirebbero</h3>${lista(r.dati_mancanti)}`;
  if (r.metodo) h += `<div class="etichetta">Come sono stati calcolati i numeri</div><p class="nota">${e(r.metodo)}</p>`;
  return h;
}

$("btn-stampa").addEventListener("click", () => window.print());
avvia();
