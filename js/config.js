// ═══════════════════════════════════════════════════════════════
//  CONFIGURAZIONE — da compilare dopo aver creato il progetto Supabase
//
//  Dove trovare i valori:
//  1. Vai su https://supabase.com/dashboard → il tuo progetto
//  2. Menu "Project Settings" → "API"
//     - "Project URL"        → SUPABASE_URL
//     - "anon / public key"  → SUPABASE_ANON_KEY
//
//  NOTA SICUREZZA: la anon key è pensata per essere pubblica
//  (i permessi veri sono gestiti dal database con le Row Level
//  Security policies). NON mettere mai qui la "service_role" key.
//
//  MIGRAZIONE FUTURA: quando l'azienda vorrà ospitare Supabase sul
//  proprio server, basterà cambiare SUPABASE_URL e SUPABASE_ANON_KEY
//  qui sotto. Tutto il resto dell'app resta identico.
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  SUPABASE_URL: "https://susgtmcfsnjhexxfdvin.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_rr_r_xi0OOyHukwIbDbgEQ_relwrQQG",

  // L'email dell'utente aziendale unico creato su Supabase
  // (Authentication → Users → Add user). Tutti gli operatori
  // entrano con la stessa password: l'email resta nascosta qui.
  LOGIN_EMAIL: "it@zoffolimetalli.it",
};
