-- Ágil Confere · leitura de documentos escaneados por IA (Claude API)
-- Registro de consumo por página lida e limite mensal de gasto (definido pelo master).

create table if not exists public.confere_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);
alter table public.confere_config enable row level security;
drop policy if exists confere_config_leitura on public.confere_config;
drop policy if exists confere_config_gestao on public.confere_config;
create policy confere_config_leitura on public.confere_config for select to authenticated using (public.confere_usuario());
create policy confere_config_gestao on public.confere_config for all to authenticated using (public.confere_master()) with check (public.confere_master());

insert into public.confere_config (chave, valor)
values ('leitura_ia', '{"ativa": true, "limite_mensal_usd": 15, "modelo": "claude-sonnet-5-5"}'::jsonb)
on conflict (chave) do nothing;

create table if not exists public.confere_ia_uso (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  usuario text not null,
  arquivo text,
  pagina int,
  etapa text not null default 'leitura',          -- leitura | releitura
  modelo text not null,
  tokens_entrada int not null default 0,
  tokens_saida int not null default 0,
  custo_usd numeric(10,5) not null default 0,
  ok boolean not null default true,
  erro text
);
create index if not exists confere_ia_uso_mes on public.confere_ia_uso (criado_em);
alter table public.confere_ia_uso enable row level security;
drop policy if exists confere_ia_uso_leitura on public.confere_ia_uso;
create policy confere_ia_uso_leitura on public.confere_ia_uso for select to authenticated using (public.confere_usuario());
-- gravação só pela função do servidor (service role); ninguém altera ou apaga pelo app

create or replace function public.confere_ia_gasto_mes() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(custo_usd), 0) from public.confere_ia_uso
  where criado_em >= date_trunc('month', now() at time zone 'America/Fortaleza') at time zone 'America/Fortaleza';
$$;
revoke all on function public.confere_ia_gasto_mes() from public, anon;
grant execute on function public.confere_ia_gasto_mes() to authenticated;
