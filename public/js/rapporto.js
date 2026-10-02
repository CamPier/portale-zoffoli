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
const TIPO_DOC = { preventivo: "Preventivo", scheda_tecnica: "Scheda tecnica", altro: "Altro" };

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

function componi({ progetto, documenti, analisi }) {
  const a = analisi.risultato;
  let h = "";

  // Copertina
  h += `<section class="copertina">
    <img src="img/logo.png" alt="Zoffoli Metalli">
    <div class="eyebrow">VALUTAZIONE ACQUISTO</div>
    <h1>${e(progetto.nome)}</h1>
    ${progetto.descrizione ? `<div class="descr">${e(progetto.descrizione)}</div>` : ""}
    <div class="date">Documento preparato il ${dataIt(new Date().toISOString())}<br>
      Analisi del ${dataIt(analisi.creata_il)} su ${documenti.length} documenti</div>
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

$("btn-stampa").addEventListener("click", () => window.print());
avvia();
