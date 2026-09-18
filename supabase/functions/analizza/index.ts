// ═══════════════════════════════════════════════════════════════
//  Edge Function "analizza" — Portale Zoffoli
//
//  Riceve l'id di un progetto, scarica i suoi PDF dallo Storage,
//  li manda a Claude (claude-opus-5) e salva il risultato JSON
//  nella tabella "analisi".
//
//  La chiave API Anthropic resta QUI sul server, mai nel browser:
//    npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ═══════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
- Se i documenti non bastano per un confronto affidabile, imposta livello_fiducia su "media" o "bassa" e spiega cosa manca.`;

// Converte un ArrayBuffer in base64 senza andare in overflow su file grandi
function bufferABase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binario = "";
  const blocco = 0x8000;
  for (let i = 0; i < bytes.length; i += blocco) {
    binario += String.fromCharCode(...bytes.subarray(i, i + blocco));
  }
  return btoa(binario);
}

function rispostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Risposta alle richieste CORS preflight del browser
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { progetto_id } = await req.json();
    if (!progetto_id) return rispostaJson({ errore: "progetto_id mancante" }, 400);

    // Client Supabase con permessi di servizio (la funzione è già protetta
    // dal login: senza un token utente valido Supabase la rifiuta prima)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Recupera l'elenco documenti del progetto
    const { data: documenti, error: errDocs } = await supabase
      .from("documenti")
      .select("*")
      .eq("progetto_id", progetto_id)
      .order("tipo", { ascending: false }); // schede tecniche prima dei preventivi

    if (errDocs) return rispostaJson({ errore: "Errore database: " + errDocs.message }, 500);
    if (!documenti || documenti.length === 0) {
      return rispostaJson({ errore: "Nessun documento trovato per questo progetto." }, 400);
    }

    // 2. Scarica i PDF dallo Storage e prepara il contenuto per Claude
    const ETICHETTE: Record<string, string> = {
      scheda_tecnica: "SCHEDA TECNICA",
      preventivo: "PREVENTIVO",
      altro: "DOCUMENTO",
    };

    const contenuto: Anthropic.ContentBlockParam[] = [];
    let dimensioneTotale = 0;

    for (let i = 0; i < documenti.length; i++) {
      const doc = documenti[i];
      const { data: file, error: errFile } = await supabase.storage
        .from("documenti")
        .download(doc.storage_path);

      if (errFile || !file) {
        return rispostaJson({ errore: `Impossibile scaricare il file "${doc.nome_file}".` }, 500);
      }

      const buffer = await file.arrayBuffer();
      dimensioneTotale += buffer.byteLength;
      if (dimensioneTotale > 25 * 1024 * 1024) {
        return rispostaJson({
          errore: "I documenti superano complessivamente 25 MB. Riduci o comprimi i PDF e riprova.",
        }, 400);
      }

      const etichetta = ETICHETTE[doc.tipo] ?? "DOCUMENTO";
      const fornitore = doc.fornitore ? ` — Fornitore: ${doc.fornitore}` : "";
      contenuto.push({
        type: "text",
        text: `Documento ${i + 1} di ${documenti.length}: ${etichetta}${fornitore} — Nome file: ${doc.nome_file}`,
      });
      contenuto.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: bufferABase64(buffer),
        },
      });
    }

    contenuto.push({
      type: "text",
      text: "Analizza tutti i documenti qui sopra e produci il rapporto completo secondo lo schema richiesto. Ricorda: il lettore non è un tecnico.",
    });

    // 3. Chiama Claude (streaming per evitare timeout; fallback automatico
    //    su un modello alternativo in caso di rifiuto di sicurezza)
    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const stream = anthropic.beta.messages.stream({
      model: "claude-opus-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: SCHEMA_ANALISI },
      },
      system: PROMPT_SISTEMA,
      messages: [{ role: "user", content: contenuto }],
    });

    const risposta = await stream.finalMessage();

    if (risposta.stop_reason === "refusal") {
      return rispostaJson({ errore: "L'assistente AI non ha potuto analizzare questi documenti. Riprova o contatta l'amministratore." }, 502);
    }
    if (risposta.stop_reason === "max_tokens") {
      return rispostaJson({ errore: "L'analisi è troppo lunga per essere completata. Prova con meno documenti alla volta." }, 502);
    }

    const blocoTesto = risposta.content.find((b) => b.type === "text");
    if (!blocoTesto || blocoTesto.type !== "text") {
      return rispostaJson({ errore: "Risposta AI vuota. Riprova." }, 502);
    }
    const analisi = JSON.parse(blocoTesto.text);

    // 4. Salva il risultato nel database
    const { data: salvata, error: errSalva } = await supabase
      .from("analisi")
      .insert({ progetto_id, risultato: analisi })
      .select()
      .single();

    if (errSalva) {
      // L'analisi è riuscita: restituiscila comunque anche se il salvataggio fallisce
      console.error("Salvataggio analisi fallito:", errSalva.message);
      return rispostaJson({ analisi, creata_il: new Date().toISOString() });
    }

    return rispostaJson({ analisi, creata_il: salvata.creata_il });
  } catch (err) {
    console.error("Errore analisi:", err);
    const messaggio = err instanceof Error ? err.message : String(err);
    return rispostaJson({ errore: "Errore interno: " + messaggio }, 500);
  }
});
