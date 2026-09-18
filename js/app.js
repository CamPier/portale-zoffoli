// ═══════════════════════════════════════════════════════════════
//  Portale Zoffoli — logica applicazione
// ═══════════════════════════════════════════════════════════════

const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Stato corrente
let progettoCorrente = null;

// Scorciatoia
const $ = (id) => document.getElementById(id);

// ─────────────────────────────────────────────
//  Navigazione tra viste
// ─────────────────────────────────────────────
function mostraVista(nome) {
  ["view-login", "view-progetti", "view-progetto"].forEach((v) => {
    $(v).hidden = v !== nome;
  });
  $("topbar").hidden = nome === "view-login";
  window.scrollTo(0, 0);
}

// ─────────────────────────────────────────────
//  Avvio
// ─────────────────────────────────────────────
async function init() {
  if (CONFIG.SUPABASE_URL.includes("TUO-PROGETTO")) {
    document.body.innerHTML =
      '<div style="max-width:560px;margin:80px auto;font-family:sans-serif;background:#fffbeb;border:1px solid #d97706;border-radius:12px;padding:28px">' +
      "<h2>⚙️ Configurazione mancante</h2>" +
      "<p>Apri il file <code>js/config.js</code> e inserisci l'URL e la anon key del tuo progetto Supabase. Le istruzioni sono nel file README.md.</p></div>";
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await caricaProgetti();
    mostraVista("view-progetti");
  } else {
    mostraVista("view-login");
  }
}

// ─────────────────────────────────────────────
//  Login / Logout
// ─────────────────────────────────────────────
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-login");
  const err = $("login-error");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Accesso in corso…";

  const { error } = await sb.auth.signInWithPassword({
    email: CONFIG.LOGIN_EMAIL,
    password: $("login-password").value,
  });

  btn.disabled = false;
  btn.textContent = "Entra";

  if (error) {
    err.textContent = "Password errata. Riprova.";
    err.hidden = false;
    return;
  }
  $("login-password").value = "";
  await caricaProgetti();
  mostraVista("view-progetti");
});

$("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  mostraVista("view-login");
});

// ─────────────────────────────────────────────
//  Progetti
// ─────────────────────────────────────────────
async function caricaProgetti() {
  const { data, error } = await sb
    .from("progetti")
    .select("*")
    .order("creato_il", { ascending: false });

  if (error) { alert("Errore nel caricare i progetti: " + error.message); return; }

  const lista = $("lista-progetti");
  lista.innerHTML = "";
  $("progetti-vuoto").hidden = data.length > 0;

  for (const p of data) {
    const card = document.createElement("div");
    card.className = "progetto-card";
    card.innerHTML =
      `<h3>${escapeHtml(p.nome)}</h3>` +
      `<p>${escapeHtml(p.descrizione || "")}</p>` +
      `<div class="data">📅 ${formattaData(p.creato_il)}</div>`;
    card.addEventListener("click", () => apriProgetto(p));
    lista.appendChild(card);
  }
}

$("btn-nuovo-progetto").addEventListener("click", () => {
  $("form-nuovo-progetto").hidden = false;
  $("np-nome").focus();
});
$("btn-annulla-progetto").addEventListener("click", () => {
  $("form-nuovo-progetto").hidden = true;
});

$("form-nuovo-progetto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.from("progetti").insert({
    nome: $("np-nome").value.trim(),
    descrizione: $("np-descrizione").value.trim() || null,
  });
  if (error) { alert("Errore nella creazione: " + error.message); return; }
  $("np-nome").value = "";
  $("np-descrizione").value = "";
  $("form-nuovo-progetto").hidden = true;
  await caricaProgetti();
});

$("btn-elimina-progetto").addEventListener("click", async () => {
  if (!progettoCorrente) return;
  const ok = confirm(
    `Eliminare il progetto "${progettoCorrente.nome}"?\n` +
    "Verranno eliminati anche tutti i documenti e le analisi. L'operazione non si può annullare."
  );
  if (!ok) return;

  // Elimina prima i file dallo storage
  const { data: docs } = await sb.from("documenti").select("storage_path")
    .eq("progetto_id", progettoCorrente.id);
  if (docs && docs.length > 0) {
    await sb.storage.from("documenti").remove(docs.map((d) => d.storage_path));
  }
  const { error } = await sb.from("progetti").delete().eq("id", progettoCorrente.id);
  if (error) { alert("Errore nell'eliminazione: " + error.message); return; }

  progettoCorrente = null;
  await caricaProgetti();
  mostraVista("view-progetti");
});

$("btn-indietro").addEventListener("click", async () => {
  progettoCorrente = null;
  await caricaProgetti();
  mostraVista("view-progetti");
});

// ─────────────────────────────────────────────
//  Dettaglio progetto
// ─────────────────────────────────────────────
async function apriProgetto(p) {
  progettoCorrente = p;
  $("progetto-nome").textContent = p.nome;
  $("progetto-descrizione").textContent = p.descrizione || "";
  $("analisi-error").hidden = true;
  $("analisi-risultato").hidden = true;
  $("analisi-risultato").innerHTML = "";
  mostraVista("view-progetto");
  await caricaDocumenti();
  await caricaUltimaAnalisi();
}

// ─────────────────────────────────────────────
//  Documenti
// ─────────────────────────────────────────────
const ETICHETTE_TIPO = {
  preventivo: "Preventivo",
  scheda_tecnica: "Scheda tecnica",
  altro: "Altro",
};

async function caricaDocumenti() {
  const { data, error } = await sb
    .from("documenti")
    .select("*")
    .eq("progetto_id", progettoCorrente.id)
    .order("caricato_il", { ascending: true });

  if (error) { alert("Errore nel caricare i documenti: " + error.message); return; }

  const ul = $("lista-documenti");
  ul.innerHTML = "";
  $("documenti-vuoto").hidden = data.length > 0;

  for (const d of data) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="doc-icona">📄</span>` +
      `<div class="doc-info">` +
      `<div class="doc-nome">${escapeHtml(d.nome_file)}</div>` +
      `<div class="doc-meta"><span class="badge badge-${d.tipo}">${ETICHETTE_TIPO[d.tipo] || d.tipo}</span>` +
      (d.fornitore ? ` · ${escapeHtml(d.fornitore)}` : "") +
      ` · ${formattaData(d.caricato_il)}</div></div>`;

    const btnApri = document.createElement("button");
    btnApri.className = "btn-mini";
    btnApri.textContent = "Apri";
    btnApri.addEventListener("click", () => apriDocumento(d));

    const btnElimina = document.createElement("button");
    btnElimina.className = "btn-mini rosso";
    btnElimina.textContent = "Elimina";
    btnElimina.addEventListener("click", () => eliminaDocumento(d));

    li.appendChild(btnApri);
    li.appendChild(btnElimina);
    ul.appendChild(li);
  }
}

$("form-upload").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("upload-error");
  err.hidden = true;

  const file = $("up-file").files[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    err.textContent = "Puoi caricare solo file PDF.";
    err.hidden = false;
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    err.textContent = "Il file supera i 20 MB. Riduci il PDF e riprova.";
    err.hidden = false;
    return;
  }

  const btn = $("btn-upload");
  btn.disabled = true;
  btn.textContent = "Caricamento…";

  try {
    // Percorso univoco nello storage: progettoId/timestamp-nomefile
    const nomePulito = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${progettoCorrente.id}/${Date.now()}-${nomePulito}`;

    const { error: errUp } = await sb.storage.from("documenti").upload(path, file, {
      contentType: "application/pdf",
    });
    if (errUp) throw errUp;

    const { error: errDb } = await sb.from("documenti").insert({
      progetto_id: progettoCorrente.id,
      nome_file: file.name,
      tipo: $("up-tipo").value,
      fornitore: $("up-fornitore").value.trim() || null,
      storage_path: path,
    });
    if (errDb) throw errDb;

    $("form-upload").reset();
    await caricaDocumenti();
  } catch (ex) {
    err.textContent = "Errore nel caricamento: " + (ex.message || ex);
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Carica documento";
  }
});

async function apriDocumento(doc) {
  const { data, error } = await sb.storage.from("documenti")
    .createSignedUrl(doc.storage_path, 60 * 10); // link valido 10 minuti
  if (error) { alert("Errore nell'aprire il documento: " + error.message); return; }
  window.open(data.signedUrl, "_blank");
}

async function eliminaDocumento(doc) {
  if (!confirm(`Eliminare "${doc.nome_file}"?`)) return;
  await sb.storage.from("documenti").remove([doc.storage_path]);
  const { error } = await sb.from("documenti").delete().eq("id", doc.id);
  if (error) { alert("Errore nell'eliminazione: " + error.message); return; }
  await caricaDocumenti();
}

// ─────────────────────────────────────────────
//  Analisi AI
// ─────────────────────────────────────────────
$("btn-analizza").addEventListener("click", async () => {
  const err = $("analisi-error");
  err.hidden = true;

  // Controllo rapido: servono documenti
  const { data: docs } = await sb.from("documenti").select("id, tipo")
    .eq("progetto_id", progettoCorrente.id);
  if (!docs || docs.length === 0) {
    err.textContent = "Carica almeno un documento prima di avviare l'analisi.";
    err.hidden = false;
    return;
  }
  const nPreventivi = docs.filter((d) => d.tipo === "preventivo").length;
  if (nPreventivi === 0) {
    const continua = confirm(
      "Non hai caricato nessun preventivo: l'analisi potrà descrivere il macchinario " +
      "e le manutenzioni, ma non confrontare le offerte.\n\nVuoi continuare comunque?"
    );
    if (!continua) return;
  }

  $("btn-analizza").disabled = true;
  $("analisi-loading").hidden = false;
  $("analisi-risultato").hidden = true;

  try {
    const { data, error } = await sb.functions.invoke("analizza", {
      body: { progetto_id: progettoCorrente.id },
    });
    if (error) throw new Error(await estraiErroreFunzione(error));
    if (data.errore) throw new Error(data.errore);

    mostraAnalisi(data.analisi, data.creata_il || new Date().toISOString());
  } catch (ex) {
    err.textContent = "Errore durante l'analisi: " + (ex.message || ex);
    err.hidden = false;
  } finally {
    $("btn-analizza").disabled = false;
    $("analisi-loading").hidden = true;
  }
});

async function estraiErroreFunzione(error) {
  // supabase-js incapsula la risposta HTTP della funzione nell'oggetto context
  try {
    if (error.context && typeof error.context.json === "function") {
      const corpo = await error.context.json();
      if (corpo.errore) return corpo.errore;
    }
  } catch (_) { /* ignora */ }
  return error.message || "Errore sconosciuto";
}

async function caricaUltimaAnalisi() {
  const { data } = await sb
    .from("analisi")
    .select("*")
    .eq("progetto_id", progettoCorrente.id)
    .order("creata_il", { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    mostraAnalisi(data[0].risultato, data[0].creata_il);
  }
}

// ─────────────────────────────────────────────
//  Visualizzazione risultato analisi
// ─────────────────────────────────────────────
const ICONE_SEMAFORO = { verde: "🟢", giallo: "🟡", rosso: "🔴" };
const ETICHETTE_FIDUCIA = {
  alta: "🟢 Alta — i documenti erano chiari e completi",
  media: "🟡 Media — alcune informazioni erano incomplete",
  bassa: "🔴 Bassa — mancano informazioni importanti, verifica bene",
};

function mostraAnalisi(a, dataCreazione) {
  const box = $("analisi-risultato");
  let html = "";

  // Riepilogo
  if (a.riepilogo) {
    html += sezione("📋 In breve", `<div class="card"><p>${escapeHtml(a.riepilogo)}</p></div>`);
  }

  // Verdetto
  if (a.verdetto) {
    const v = a.verdetto;
    let verifiche = "";
    if (v.cosa_verificare_prima_di_firmare && v.cosa_verificare_prima_di_firmare.length) {
      verifiche =
        `<p class="pf-titolo">Prima di firmare, verifica:</p><ul class="pf-lista">` +
        v.cosa_verificare_prima_di_firmare.map((x) => `<li>${escapeHtml(x)}</li>`).join("") +
        `</ul>`;
    }
    html += sezione("🏆 Consiglio", `
      <div class="verdetto-card">
        <div class="verdetto-eyebrow">Offerta consigliata</div>
        <div class="verdetto-fornitore">${escapeHtml(v.fornitore_consigliato || "—")}</div>
        <p class="verdetto-motivazione">${escapeHtml(v.motivazione_semplice || "")}</p>
        <p class="fiducia"><strong>Affidabilità del consiglio:</strong> ${ETICHETTE_FIDUCIA[v.livello_fiducia] || escapeHtml(v.livello_fiducia || "")}</p>
        ${verifiche}
      </div>`);
  }

  // Offerte
  if (a.offerte && a.offerte.length) {
    let corpo = "";
    for (const o of a.offerte) {
      corpo += `
        <div class="offerta-card">
          <div class="offerta-head">
            <span class="semaforo">${ICONE_SEMAFORO[o.valutazione] || ""}</span>
            <h4>${escapeHtml(o.fornitore)}</h4>
            <span class="offerta-prezzo">${escapeHtml(o.prezzo_totale || "")}</span>
          </div>
          ${listaPF("✔ Punti a favore", o.punti_forti)}
          ${listaPF("✖ Punti contro", o.punti_deboli)}
          ${o.riferimenti && o.riferimenti.length ? `<p class="riferimenti">Fonti: ${o.riferimenti.map(escapeHtml).join(" · ")}</p>` : ""}
        </div>`;
    }
    html += sezione("💶 Le offerte a confronto", corpo);
  }

  // Tabella comparativa
  if (a.comparativa && a.comparativa.length) {
    const fornitori = [];
    for (const c of a.comparativa) {
      for (const val of c.valori || []) {
        if (!fornitori.includes(val.fornitore)) fornitori.push(val.fornitore);
      }
    }
    let tab = `<div class="tabella-wrap"><table class="comparativa"><thead><tr><th>Criterio</th>`;
    tab += fornitori.map((f) => `<th>${escapeHtml(f)}</th>`).join("");
    tab += `</tr></thead><tbody>`;
    for (const c of a.comparativa) {
      tab += `<tr><td><strong>${escapeHtml(c.criterio)}</strong>` +
        (c.spiegazione_criterio ? `<br><small class="muted">${escapeHtml(c.spiegazione_criterio)}</small>` : "") +
        `</td>`;
      for (const f of fornitori) {
        const val = (c.valori || []).find((v) => v.fornitore === f);
        if (val) {
          tab += `<td class="giudizio-${val.giudizio || ""}">${escapeHtml(val.valore)}</td>`;
        } else {
          tab += `<td>—</td>`;
        }
      }
      tab += `</tr>`;
    }
    tab += `</tbody></table></div>`;
    html += sezione("📊 Tabella comparativa", tab);
  }

  // Manutenzione
  if (a.manutenzione && a.manutenzione.length) {
    let tab = `<div class="tabella-wrap"><table class="manutenzione"><thead><tr>
      <th>Componente</th><th>Che cos'è</th><th>Ogni quanto</th><th>Cosa fare</th><th>Costo indicativo</th></tr></thead><tbody>`;
    for (const m of a.manutenzione) {
      tab += `<tr>
        <td><strong>${escapeHtml(m.componente)}</strong>${m.fonte ? `<br><small class="muted">${escapeHtml(m.fonte)}</small>` : ""}</td>
        <td>${escapeHtml(m.cosa_e || "")}</td>
        <td>${escapeHtml(m.intervallo || "")}</td>
        <td>${escapeHtml(m.tipo_intervento || "")}</td>
        <td>${escapeHtml(m.costo_indicativo || "")}</td></tr>`;
    }
    tab += `</tbody></table></div>`;
    html += sezione("🔧 Piano manutenzioni e ricambi", tab);
  }

  // Punti di attenzione
  if (a.punti_attenzione && a.punti_attenzione.length) {
    let corpo = "";
    for (const p of a.punti_attenzione) {
      corpo += `<div class="attenzione-item ${p.gravita === "alta" ? "grave" : ""}">
        <strong>${p.gravita === "alta" ? "⚠️" : "ℹ️"} ${escapeHtml(p.titolo)}</strong>
        ${escapeHtml(p.spiegazione)}</div>`;
    }
    html += sezione("⚠️ Punti di attenzione", corpo);
  }

  // Glossario
  if (a.glossario && a.glossario.length) {
    let corpo = `<div class="glossario">`;
    for (const g of a.glossario) {
      corpo += `<details><summary>${escapeHtml(g.termine)}</summary><p>${escapeHtml(g.spiegazione)}</p></details>`;
    }
    corpo += `</div>`;
    html += sezione("📖 Parole difficili spiegate", corpo);
  }

  html += `<p class="analisi-data">Analisi generata il ${formattaDataOra(dataCreazione)} · ricontrolla sempre i dati importanti sui documenti originali</p>`;

  box.innerHTML = html;
  box.hidden = false;
}

function sezione(titolo, corpo) {
  return `<div class="analisi-sezione"><h3>${titolo}</h3>${corpo}</div>`;
}

function listaPF(titolo, voci) {
  if (!voci || !voci.length) return "";
  return `<p class="pf-titolo">${titolo}</p><ul class="pf-lista">` +
    voci.map((x) => `<li>${escapeHtml(x)}</li>`).join("") + `</ul>`;
}

// ─────────────────────────────────────────────
//  Utilità
// ─────────────────────────────────────────────
function escapeHtml(testo) {
  if (testo === null || testo === undefined) return "";
  return String(testo)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formattaData(iso) {
  return new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
}

function formattaDataOra(iso) {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Avvio
init();
