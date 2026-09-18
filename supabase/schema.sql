-- ═══════════════════════════════════════════════════════════════
--  Portale Zoffoli — schema database Supabase
--
--  COME USARLO: nel dashboard Supabase apri "SQL Editor",
--  incolla tutto questo file e premi "Run".
-- ═══════════════════════════════════════════════════════════════

-- ── Tabella progetti ──
create table if not exists progetti (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descrizione text,
  stato text not null default 'aperto',
  creato_il timestamptz not null default now()
);

-- ── Tabella documenti (metadati; i PDF stanno nello Storage) ──
create table if not exists documenti (
  id uuid primary key default gen_random_uuid(),
  progetto_id uuid not null references progetti(id) on delete cascade,
  nome_file text not null,
  tipo text not null check (tipo in ('scheda_tecnica', 'preventivo', 'altro')),
  fornitore text,
  storage_path text not null,
  caricato_il timestamptz not null default now()
);

-- ── Tabella analisi (risultati AI in formato JSON) ──
create table if not exists analisi (
  id uuid primary key default gen_random_uuid(),
  progetto_id uuid not null references progetti(id) on delete cascade,
  risultato jsonb not null,
  creata_il timestamptz not null default now()
);

-- ── Sicurezza: solo gli utenti autenticati possono leggere/scrivere ──
alter table progetti enable row level security;
alter table documenti enable row level security;
alter table analisi enable row level security;

create policy "progetti_solo_autenticati" on progetti
  for all to authenticated using (true) with check (true);

create policy "documenti_solo_autenticati" on documenti
  for all to authenticated using (true) with check (true);

create policy "analisi_solo_autenticati" on analisi
  for all to authenticated using (true) with check (true);

-- ── Storage: bucket privato per i PDF ──
insert into storage.buckets (id, name, public)
values ('documenti', 'documenti', false)
on conflict (id) do nothing;

create policy "storage_lettura_autenticati" on storage.objects
  for select to authenticated using (bucket_id = 'documenti');

create policy "storage_caricamento_autenticati" on storage.objects
  for insert to authenticated with check (bucket_id = 'documenti');

create policy "storage_eliminazione_autenticati" on storage.objects
  for delete to authenticated using (bucket_id = 'documenti');
