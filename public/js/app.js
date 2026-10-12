// ═══════════════════════════════════════════════════════════════
//  Portale Zoffoli — logica applicazione
// ═══════════════════════════════════════════════════════════════

// Stato corrente
let progettoCorrente = null;
let timerAnalisi = null;
let timerDomande = null;
let timerRendimento = null;

// Scorciatoia
const $ = (id) => document.getElementById(id);

// Chiamata alle API del server. Restituisce il JSON della risposta;
// in caso di errore lancia un Error con il messaggio del server.
async function api(metodo, url, corpo) {
  const opzioni = { method: metodo, headers: {} };
  if (corpo instanceof FormData) {
    opzioni.body = corpo;
  } else if (corpo !== undefined) {
    opzioni.headers["Content-Type"] = "application/json";
    opzioni.body = JSON.stringify(corpo);
  }
  const risposta = await fetch(url, opzioni);
  let dati = null;
  try { dati = await risposta.json(); } catch (_) { /* risposta senza JSON */ }

  if (risposta.status === 401 && url !== "/api/login") {
    fermaControlli();
    mostraVista("view-login");
  }
  if (!risposta.ok) {
    throw new Error((dati && dati.errore) || `Errore del server (${risposta.status})`);
  }
  return dati;
}

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
  let sessione = { autenticato: false };
  try { sessione = await api("GET", "/api/sessione"); } catch (_) { /* server non raggiungibile: mostra il login */ }
  if (sessione.autenticato) {
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

  try {
    await api("POST", "/api/login", { password: $("login-password").value });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = "Entra";
  }
  $("login-password").value = "";
  await caricaProgetti();
  mostraVista("view-progetti");
});

$("btn-logout").addEventListener("click", async () => {
  fermaControlli();
  try { await api("POST", "/api/logout"); } catch (_) { /* esce comunque */ }
  mostraVista("view-login");
});

// ─────────────────────────────────────────────
//  Progetti
// ─────────────────────────────────────────────
async function caricaProgetti() {
  let data;
  try { data = await api("GET", "/api/progetti"); } catch (ex) {
    alert("Errore nel caricare i progetti: " + ex.message); return;
  }

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
  try {
    await api("POST", "/api/progetti", {
      nome: $("np-nome").value.trim(),
      descrizione: $("np-descrizione").value.trim() || null,
    });
  } catch (ex) { alert("Errore nella creazione: " + ex.message); return; }
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

  // Il server elimina anche i PDF e le analisi del progetto
  try { await api("DELETE", `/api/progetti/${progettoCorrente.id}`); } catch (ex) {
    alert("Errore nell'eliminazione: " + ex.message); return;
  }

  fermaControlli();
  progettoCorrente = null;
  await caricaProgetti();
  mostraVista("view-progetti");
});

$("btn-indietro").addEventListener("click", async () => {
  fermaControlli();
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
  $("export-azioni").hidden = true;
  $("domande-lista").innerHTML = "";
  $("domanda-error").hidden = true;
  $("domanda-testo").value = "";
  ultimaAnalisiMostrata = null;
  analisiInAttesa = false;
  firmaConversazione = "";
  $("rendimento-risultato").hidden = true;
  $("rendimento-risultato").innerHTML = "";
  $("rendimento-error").hidden = true;
  ultimoRendimentoMostrato = null;
  rendimentoInAttesa = false;
  haAnalisi = false;
  haRendimento = false;
  mostraVista("view-progetto");
  await caricaDocumenti();
  await Promise.all([controllaAnalisi(), controllaRendimento(), caricaDomande()]);
}

// ─────────────────────────────────────────────
//  Documenti
// ─────────────────────────────────────────────
const ETICHETTE_TIPO = {
  preventivo: "Preventivo",
  scheda_tecnica: "Scheda tecnica",
  altro: "Altro",
  produzione: "Dati di produzione",
};

async function caricaDocumenti() {
  let data;
  try { data = await api("GET", `/api/progetti/${progettoCorrente.id}/documenti`); } catch (ex) {
    alert("Errore nel caricare i documenti: " + ex.message); return;
  }

  const ul = $("lista-documenti");
  ul.innerHTML = "";
  $("documenti-vuoto").hidden = data.length > 0;

  for (const d of data) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="doc-icona">${d.tipo === "produzione" ? "📊" : "📄"}</span>` +
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

  const tipo = $("up-tipo").value;
  const excel = ESTENSIONI_EXCEL.includes(estensione(file.name));
  if (tipo === "produzione" && !excel) {
    err.textContent = "Per i dati di produzione carica un file Excel (.xlsx, .xls) o .csv.";
    err.hidden = false;
    return;
  }
  if (tipo !== "produzione" && estensione(file.name) !== "pdf") {
    err.textContent = excel
      ? "Per un file Excel scegli il tipo documento \"Dati di produzione\"."
      : "Per schede tecniche e preventivi puoi caricare solo file PDF.";
    err.hidden = false;
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    err.textContent = "Il file supera i 20 MB. Riduci il file e riprova.";
    err.hidden = false;
    return;
  }

  const btn = $("btn-upload");
  btn.disabled = true;
  btn.textContent = "Caricamento…";

  try {
    const fd = new FormData();
    fd.append("nome_file", file.name);
    fd.append("tipo", $("up-tipo").value);
    fd.append("fornitore", $("up-fornitore").value.trim());
    fd.append("file", file);
    await api("POST", `/api/progetti/${progettoCorrente.id}/documenti`, fd);

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

const ESTENSIONI_EXCEL = ["xlsx", "xls", "csv"];
const estensione = (nome) => String(nome).toLowerCase().split(".").pop();

// Scegliendo un Excel il tipo passa da solo a "Dati di produzione" (e viceversa per i PDF)
$("up-file").addEventListener("change", () => {
  const file = $("up-file").files[0];
  if (!file) return;
  if (ESTENSIONI_EXCEL.includes(estensione(file.name))) {
    $("up-tipo").value = "produzione";
  } else if ($("up-tipo").value === "produzione") {
    $("up-tipo").value = "preventivo";
  }
});

function apriDocumento(doc) {
  // Il cookie di sessione protegge anche il download del file
  // (i PDF si aprono nel browser, gli Excel si scaricano)
  window.open(`/api/documenti/${doc.id}/file`, "_blank");
}

async function eliminaDocumento(doc) {
  if (!confirm(`Eliminare "${doc.nome_file}"?`)) return;
  try { await api("DELETE", `/api/documenti/${doc.id}`); } catch (ex) {
    alert("Errore nell'eliminazione: " + ex.message); return;
  }
  await caricaDocumenti();
}

// ─────────────────────────────────────────────
//  Analisi AI
// ─────────────────────────────────────────────
$("btn-analizza").addEventListener("click", async () => {
  const err = $("analisi-error");
  err.hidden = true;

  // Controllo rapido: servono documenti
  let docs = [];
  try { docs = await api("GET", `/api/progetti/${progettoCorrente.id}/documenti`); } catch (_) { /* lo segnala il server */ }
  docs = docs.filter((d) => d.tipo !== "produzione"); // l'analisi delle offerte usa solo i PDF
  if (docs.length === 0) {
    err.textContent = "Carica almeno un preventivo o una scheda tecnica (PDF) prima di avviare l'analisi.";
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

  try {
    await api("POST", `/api/progetti/${progettoCorrente.id}/analisi`);
  } catch (ex) {
    err.textContent = "Errore durante l'analisi: " + ex.message;
    err.hidden = false;
    return;
  }
  $("analisi-risultato").hidden = true;
  await controllaAnalisi(true);
});

// L'analisi gira sul server in background: qui se ne controlla lo stato
// ogni 5 secondi e, quando finisce, si mostra il risultato.
let analisiInAttesa = false;
let ultimaAnalisiMostrata = null;

async function controllaAnalisi(appenaAvviata = false) {
  clearTimeout(timerAnalisi);
  if (!progettoCorrente) return;
  const progettoId = progettoCorrente.id;
  if (appenaAvviata) analisiInAttesa = true;

  let stato;
  try {
    stato = await api("GET", `/api/progetti/${progettoId}/analisi`);
  } catch (ex) {
    // Errore di rete temporaneo durante l'attesa: riprova
    if (analisiInAttesa) timerAnalisi = setTimeout(controllaAnalisi, 10000);
    return;
  }
  if (!progettoCorrente || progettoCorrente.id !== progettoId) return; // l'utente ha cambiato pagina

  $("btn-analizza").disabled = stato.in_corso;
  $("analisi-loading").hidden = !stato.in_corso;
  haAnalisi = !!stato.ultima && !stato.in_corso;
  aggiornaExport();

  if (stato.in_corso) {
    analisiInAttesa = true;
    timerAnalisi = setTimeout(controllaAnalisi, 5000);
    return;
  }

  if (analisiInAttesa && stato.errore) {
    $("analisi-error").textContent = "Errore durante l'analisi: " + stato.errore;
    $("analisi-error").hidden = false;
  }
  analisiInAttesa = false;

  if (stato.ultima && stato.ultima.creata_il !== ultimaAnalisiMostrata) {
    mostraAnalisi(stato.ultima.risultato, stato.ultima.creata_il);
    ultimaAnalisiMostrata = stato.ultima.creata_il;
  } else if (stato.ultima) {
    $("analisi-risultato").hidden = false;
  }
}

// Ferma i controlli periodici (analisi e domande) quando si lascia il progetto
function fermaControlli() {
  clearTimeout(timerAnalisi);
  clearTimeout(timerDomande);
  clearTimeout(timerRendimento);
  timerAnalisi = null;
  timerDomande = null;
  timerRendimento = null;
}

// Il rapporto per la direzione si può esportare se c'è almeno
// un'analisi delle offerte o uno studio del rendimento
let haAnalisi = false;
let haRendimento = false;
function aggiornaExport() {
  $("export-azioni").hidden = !(haAnalisi || haRendimento);
}

// ─────────────────────────────────────────────
//  Studio del rendimento (dati di produzione Excel)
// ─────────────────────────────────────────────
let rendimentoInAttesa = false;
let ultimoRendimentoMostrato = null;

$("btn-rendimento").addEventListener("click", async () => {
  const err = $("rendimento-error");
  err.hidden = true;
  try {
    await api("POST", `/api/progetti/${progettoCorrente.id}/rendimento`);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    return;
  }
  $("rendimento-risultato").hidden = true;
  await controllaRendimento(true);
});

async function controllaRendimento(appenaAvviato = false) {
  clearTimeout(timerRendimento);
  if (!progettoCorrente) return;
  const progettoId = progettoCorrente.id;
  if (appenaAvviato) rendimentoInAttesa = true;

  let stato;
  try {
    stato = await api("GET", `/api/progetti/${progettoId}/rendimento`);
  } catch (_) {
    if (rendimentoInAttesa) timerRendimento = setTimeout(controllaRendimento, 10000);
    return;
  }
  if (!progettoCorrente || progettoCorrente.id !== progettoId) return;

  $("btn-rendimento").disabled = stato.in_corso;
  $("rendimento-loading").hidden = !stato.in_corso;
  haRendimento = !!stato.ultimo && !stato.in_corso;
  aggiornaExport();

  if (stato.in_corso) {
    rendimentoInAttesa = true;
    timerRendimento = setTimeout(controllaRendimento, 5000);
    return;
  }
  if (rendimentoInAttesa && stato.errore) {
    $("rendimento-error").textContent = "Errore durante lo studio: " + stato.errore;
    $("rendimento-error").hidden = false;
  }
  rendimentoInAttesa = false;

  if (stato.ultimo && stato.ultimo.creata_il !== ultimoRendimentoMostrato) {
    mostraRendimento(stato.ultimo.risultato, stato.ultimo.creata_il);
    ultimoRendimentoMostrato = stato.ultimo.creata_il;
  } else if (stato.ultimo) {
    $("rendimento-risultato").hidden = false;
  }
}

const GIUDIZIO_RENDIMENTO = {
  verde: "🟢 Rende bene",
  giallo: "🟡 Migliorabile",
  rosso: "🔴 Problemi seri",
};

function mostraRendimento(r, dataCreazione) {
  let html = "";

  if (r.giudizio) {
    html += sezione("📋 Com'è andata", `
      <div class="verdetto-card">
        <div class="verdetto-eyebrow">${escapeHtml(r.periodo_analizzato || "Periodo analizzato")}</div>
        <div class="verdetto-fornitore">${GIUDIZIO_RENDIMENTO[r.giudizio.valutazione] || ""}</div>
        <p class="verdetto-motivazione">${escapeHtml(r.riepilogo || "")}</p>
        <p class="fiducia">${escapeHtml(r.giudizio.spiegazione || "")}</p>
      </div>`);
  }

  if (r.indicatori && r.indicatori.length) {
    let tab = `<div class="tabella-wrap"><table class="comparativa"><thead><tr>
      <th>Indicatore</th><th>Valore</th><th>Confronto</th></tr></thead><tbody>`;
    for (const i of r.indicatori) {
      tab += `<tr><td><strong>${escapeHtml(i.nome)}</strong><br><small class="muted">${escapeHtml(i.cosa_significa)}</small></td>
        <td class="giudizio-${escapeHtml(i.giudizio)}"><strong>${escapeHtml(i.valore)}</strong></td>
        <td>${escapeHtml(i.riferimento)}</td></tr>`;
    }
    html += sezione("🔢 I numeri principali", tab + `</tbody></table></div>`);
  }

  if (r.andamento && r.andamento.length) {
    let tab = `<div class="tabella-wrap"><table class="comparativa"><thead><tr>
      <th>Periodo</th><th>Numeri</th><th>Commento</th></tr></thead><tbody>`;
    for (const p of r.andamento) {
      tab += `<tr><td><strong>${escapeHtml(p.periodo)}</strong></td>
        <td class="giudizio-${escapeHtml(p.giudizio)}">${escapeHtml(p.valori)}</td><td>${escapeHtml(p.commento)}</td></tr>`;
    }
    html += sezione("📈 Andamento nel tempo", tab + `</tbody></table></div>`);
  }

  if (r.fermi_e_problemi && r.fermi_e_problemi.length) {
    let corpo = "";
    for (const f of r.fermi_e_problemi) {
      corpo += `<div class="attenzione-item grave"><strong>⛔ ${escapeHtml(f.problema)} — ${escapeHtml(f.quanto_pesa)}</strong>
        ${escapeHtml(f.spiegazione)}</div>`;
    }
    html += sezione("⛔ Fermi e problemi principali", corpo);
  }

  if (r.cosa_va_bene && r.cosa_va_bene.length) {
    html += sezione("✅ Cosa funziona bene", `<div class="card">${listaPF("", r.cosa_va_bene)}</div>`);
  }

  if (r.consigli && r.consigli.length) {
    let corpo = "";
    for (const c of r.consigli) {
      corpo += `<div class="attenzione-item ${c.priorita === "alta" ? "grave" : ""}">
        <strong>${c.priorita === "alta" ? "🔥" : "💡"} ${escapeHtml(c.azione)}</strong>
        ${escapeHtml(c.perche)}<br><em>Beneficio atteso: ${escapeHtml(c.beneficio_atteso)}</em></div>`;
    }
    html += sezione("💡 Cosa fare per migliorare", corpo);
  }

  if (r.dati_mancanti && r.dati_mancanti.length) {
    html += sezione("📝 Per uno studio più preciso servirebbero", `<div class="card">${listaPF("", r.dati_mancanti)}</div>`);
  }

  if (r.metodo) {
    html += `<details class="metodo"><summary>Come sono stati calcolati i numeri</summary><p>${escapeHtml(r.metodo)}</p></details>`;
  }

  html += `<p class="analisi-data">Studio generato il ${formattaDataOra(dataCreazione)} · ricontrolla sempre i dati importanti sull'Excel originale</p>`;

  $("rendimento-risultato").innerHTML = html;
  $("rendimento-risultato").hidden = false;
}

// ─────────────────────────────────────────────
//  Domande sui documenti e sull'analisi
// ─────────────────────────────────────────────
// Le risposte arrivano dal server in background: finché c'è una
// domanda in corso la conversazione viene ricaricata ogni 3 secondi.
let firmaConversazione = "";

async function caricaDomande() {
  clearTimeout(timerDomande);
  if (!progettoCorrente) return;
  const progettoId = progettoCorrente.id;

  let domande;
  try {
    domande = await api("GET", `/api/progetti/${progettoId}/domande`);
  } catch (_) {
    timerDomande = setTimeout(caricaDomande, 10000);
    return;
  }
  if (!progettoCorrente || progettoCorrente.id !== progettoId) return;

  const inCorso = domande.some((d) => d.stato === "in_corso");
  $("btn-domanda").disabled = inCorso;
  $("btn-cancella-domande").hidden = domande.length === 0 || inCorso;
  $("domande-esempi").hidden = domande.length > 0;

  // Ridisegna solo se qualcosa è cambiato (evita di perdere la posizione di lettura)
  const firma = domande.map((d) => d.id + d.stato).join("|");
  if (firma !== firmaConversazione) {
    firmaConversazione = firma;
    mostraDomande(domande);
  }
  if (inCorso) timerDomande = setTimeout(caricaDomande, 3000);
}

function mostraDomande(domande) {
  const lista = $("domande-lista");
  let html = "";
  for (const d of domande) {
    html += `<div class="msg msg-domanda">${escapeHtml(d.domanda)}<span class="msg-ora">${formattaOra(d.creata_il)}</span></div>`;
    if (d.stato === "in_corso") {
      html += `<div class="msg msg-attesa"><div class="spinner"></div>Sto cercando la risposta nei documenti…</div>`;
    } else if (d.stato === "errore") {
      html += `<div class="msg msg-errore">⚠️ ${escapeHtml(d.errore || "Errore sconosciuto")}</div>`;
    } else {
      html += `<div class="msg msg-risposta">${testoFormattato(d.risposta)}</div>`;
    }
  }
  lista.innerHTML = html;
  const ultimo = lista.lastElementChild;
  if (ultimo) ultimo.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function inviaDomanda(testo) {
  const err = $("domanda-error");
  err.hidden = true;
  testo = testo.trim();
  if (!testo || !progettoCorrente) return;

  $("btn-domanda").disabled = true;
  try {
    await api("POST", `/api/progetti/${progettoCorrente.id}/domande`, { domanda: testo });
    $("domanda-testo").value = "";
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    $("btn-domanda").disabled = false;
    return;
  }
  await caricaDomande();
}

$("form-domanda").addEventListener("submit", (e) => {
  e.preventDefault();
  inviaDomanda($("domanda-testo").value);
});

// Invio = invia, Maiusc+Invio = a capo
$("domanda-testo").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!$("btn-domanda").disabled) inviaDomanda($("domanda-testo").value);
  }
});

$("domande-esempi").addEventListener("click", (e) => {
  if (e.target.classList.contains("chip")) {
    $("domanda-testo").value = e.target.textContent;
    $("domanda-testo").focus();
  }
});

$("btn-cancella-domande").addEventListener("click", async () => {
  if (!confirm("Cancellare tutta la conversazione di questo progetto?")) return;
  try { await api("DELETE", `/api/progetti/${progettoCorrente.id}/domande`); } catch (ex) {
    alert("Errore: " + ex.message); return;
  }
  await caricaDomande();
});

// Converte il testo della risposta (paragrafi, elenchi "- " / "1. ",
// **grassetto**) in HTML. Il testo viene prima "escapato": niente HTML dall'esterno.
function testoFormattato(testo) {
  const righe = escapeHtml(testo || "").split(/\r?\n/);
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/^#{1,6}\s+(.*)$/, "<strong>$1</strong>");
  let html = "";
  let elenco = null; // "ul" | "ol"
  let paragrafo = [];

  const chiudiParagrafo = () => {
    if (paragrafo.length) html += `<p>${paragrafo.map(inline).join("<br>")}</p>`;
    paragrafo = [];
  };
  const chiudiElenco = () => {
    if (elenco) html += `</${elenco}>`;
    elenco = null;
  };

  for (const riga of righe) {
    const puntato = riga.match(/^\s*[-*•]\s+(.*)$/);
    const numerato = riga.match(/^\s*\d+[.)]\s+(.*)$/);
    if (puntato || numerato) {
      chiudiParagrafo();
      const tipo = puntato ? "ul" : "ol";
      if (elenco !== tipo) { chiudiElenco(); html += `<${tipo}>`; elenco = tipo; }
      html += `<li>${inline((puntato || numerato)[1])}</li>`;
    } else if (riga.trim() === "") {
      chiudiParagrafo();
      chiudiElenco();
    } else {
      chiudiElenco();
      paragrafo.push(riga);
    }
  }
  chiudiParagrafo();
  chiudiElenco();
  return html;
}

// ─────────────────────────────────────────────
//  Rapporto per la direzione
// ─────────────────────────────────────────────
$("btn-export-pdf").addEventListener("click", () => {
  window.open(`rapporto.html?id=${progettoCorrente.id}`, "_blank");
});

$("btn-export-word").addEventListener("click", async () => {
  const btn = $("btn-export-word");
  btn.disabled = true;
  btn.textContent = "Preparazione…";
  try {
    const r = await fetch(`/api/progetti/${progettoCorrente.id}/rapporto-word`);
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}));
      throw new Error(corpo.errore || `Errore del server (${r.status})`);
    }
    const blob = await r.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Valutazione - ${progettoCorrente.nome}.docx`.replace(/[\\/:*?"<>|]/g, "_");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  } catch (ex) {
    alert("Impossibile creare il documento Word: " + ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📝 Esporta Word";
  }
});

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

function formattaOra(iso) {
  const d = new Date(iso);
  const oggi = d.toDateString() === new Date().toDateString();
  return d.toLocaleString("it-IT", oggi
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formattaDataOra(iso) {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Avvio
init();
