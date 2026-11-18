-- Ágil Confere · verificação e análise documental (projeto agil-desk, schema public, prefixo confere_)

-- acesso ------------------------------------------------------------------
create table if not exists public.confere_acesso (
  email text primary key,
  nome text,
  papel text not null default 'analista' check (papel in ('analista', 'master')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create or replace function public.confere_email() returns text
language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.confere_usuario() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.confere_acesso a where lower(a.email) = public.confere_email() and a.ativo)
$$;

create or replace function public.confere_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.confere_acesso a where lower(a.email) = public.confere_email() and a.ativo and a.papel = 'master')
$$;

create or replace function public.confere_nome() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select a.nome from public.confere_acesso a where lower(a.email) = public.confere_email()), public.confere_email())
$$;

-- cadastros ---------------------------------------------------------------
create table if not exists public.confere_importadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text not null unique,
  criado_em timestamptz not null default now()
);

create table if not exists public.confere_regras (
  codigo text primary key,
  titulo text not null,
  documento text not null,
  severidade text not null check (severidade in ('bloqueante', 'alerta', 'info')),
  base_legal text,
  fases text[] not null default array['pre_alerta', 'pre_registro'],
  interna boolean not null default false,
  ativa boolean not null default true,
  atualizado_por text,
  atualizado_em timestamptz
);

-- catálogo de produtos (cada carga é uma versão; nada é sobrescrito) --------
create table if not exists public.confere_catalogo_versoes (
  id uuid primary key default gen_random_uuid(),
  importador_id uuid not null references public.confere_importadores (id),
  arquivo_nome text not null,
  arquivo_hash text not null,
  gerado_em timestamptz,
  total int not null default 0,
  ativos int not null default 0,
  desativados int not null default 0,
  resumo jsonb not null default '{}'::jsonb,
  storage_path text,
  carregado_por text not null default public.confere_email(),
  carregado_em timestamptz not null default now(),
  unique (importador_id, arquivo_hash)
);

create table if not exists public.confere_catalogo_produtos (
  versao_id uuid not null references public.confere_catalogo_versoes (id) on delete cascade,
  codigo text not null,
  codigo_interno text not null,
  seq int,
  situacao text,
  ativo boolean not null default false,
  ncm text,
  versao text,
  denominacao text,
  descricao text,
  atributos jsonb,
  inicio_vigencia text,
  fim_vigencia text,
  assinatura text not null,
  primary key (versao_id, codigo, codigo_interno)
);
create index if not exists confere_catprod_ci_idx on public.confere_catalogo_produtos (codigo_interno);

-- processos, documentos e análises ----------------------------------------
create table if not exists public.confere_processos (
  id uuid primary key default gen_random_uuid(),
  importador_id uuid not null references public.confere_importadores (id),
  ref_agil text,
  ref_cliente text not null,
  invoice text,
  exportador text,
  status text not null default 'aberto' check (status in ('aberto', 'registrado', 'cancelado')),
  duimp text,
  registrado_em timestamptz,
  observacoes text,
  criado_por text not null default public.confere_email(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists confere_proc_ref_idx on public.confere_processos (importador_id, lower(ref_cliente));

create table if not exists public.confere_documentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.confere_processos (id) on delete cascade,
  tipo text not null check (tipo in ('invoice', 'packing', 'invoice_packing', 'bl', 'txt', 'relatorio', 'ce', 'outro')),
  arquivo_nome text not null,
  arquivo_hash text,
  tamanho int,
  storage_path text,
  extraido jsonb,
  enviado_por text not null default public.confere_email(),
  enviado_em timestamptz not null default now()
);
create index if not exists confere_doc_proc_idx on public.confere_documentos (processo_id);

create table if not exists public.confere_analises (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.confere_processos (id) on delete cascade,
  numero int,
  fase text not null check (fase in ('pre_alerta', 'pre_registro')),
  catalogo_versao_id uuid references public.confere_catalogo_versoes (id),
  documentos jsonb not null default '[]'::jsonb,
  resultado jsonb not null default '{}'::jsonb,
  resumo jsonb not null default '{}'::jsonb,
  decisao text check (decisao in ('seguir', 'nao_seguir')),
  decisao_nota text,
  decisao_por text,
  decisao_em timestamptz,
  parecer jsonb,
  pdf_path text,
  pdf_emitido_por text,
  pdf_emitido_em timestamptz,
  analista_email text not null default public.confere_email(),
  analista_nome text not null default public.confere_nome(),
  criado_em timestamptz not null default now()
);
create index if not exists confere_anal_proc_idx on public.confere_analises (processo_id, criado_em desc);

create or replace function public.confere_numerar_analise() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(max(numero), 0) + 1 into new.numero from public.confere_analises where processo_id = new.processo_id;
  update public.confere_processos set atualizado_em = now() where id = new.processo_id;
  return new;
end $$;
drop trigger if exists confere_numerar_analise on public.confere_analises;
create trigger confere_numerar_analise before insert on public.confere_analises for each row execute function public.confere_numerar_analise();

create table if not exists public.confere_analise_itens (
  analise_id uuid not null references public.confere_analises (id) on delete cascade,
  processo_id uuid not null references public.confere_processos (id) on delete cascade,
  codigo_interno text not null,
  ncm_documento text,
  ncm_catalogo text,
  produto_codigo text,
  produto_versao text,
  produto_assinatura text,
  status text,
  primary key (analise_id, codigo_interno)
);
create index if not exists confere_aitem_ci_idx on public.confere_analise_itens (codigo_interno);

create table if not exists public.confere_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  analise_id uuid not null references public.confere_analises (id) on delete cascade,
  processo_id uuid not null references public.confere_processos (id) on delete cascade,
  chave text,
  regra text,
  titulo text,
  severidade text not null check (severidade in ('bloqueante', 'alerta', 'info')),
  documento text,
  campo text,
  item text,
  encontrado text,
  esperado text,
  mensagem text,
  sugestao text,
  texto_pdf text,
  base_legal text,
  interna boolean not null default false,
  incluir_pdf boolean not null default true,
  acao text check (acao in ('ajuste_cliente', 'ajuste_catalogo', 'ajuste_documento', 'ciente_ok')),
  acao_documento text,
  decisao text check (decisao in ('seguir', 'nao_seguir')),
  nota text,
  status text not null default 'aberta' check (status in ('aberta', 'tratada', 'substituida')),
  tratado_por text,
  tratado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists confere_oc_proc_idx on public.confere_ocorrencias (processo_id, status);
create index if not exists confere_oc_anal_idx on public.confere_ocorrencias (analise_id);

-- ao rodar nova análise, as ocorrências abertas da análise anterior do mesmo processo e fase saem da fila
create or replace function public.confere_substituir_ocorrencias() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.confere_ocorrencias o set status = 'substituida'
   where o.processo_id = new.processo_id and o.status = 'aberta'
     and o.analise_id in (select a.id from public.confere_analises a where a.processo_id = new.processo_id and a.fase = new.fase and a.id <> new.id);
  return new;
end $$;
drop trigger if exists confere_substituir_ocorrencias on public.confere_analises;
create trigger confere_substituir_ocorrencias after insert on public.confere_analises for each row execute function public.confere_substituir_ocorrencias();

create table if not exists public.confere_alertas (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.confere_processos (id) on delete cascade,
  analise_id uuid references public.confere_analises (id) on delete set null,
  catalogo_versao_id uuid references public.confere_catalogo_versoes (id) on delete cascade,
  tipo text not null default 'catalogo',
  codigo_interno text,
  antes jsonb,
  depois jsonb,
  mensagem text,
  status text not null default 'aberto' check (status in ('aberto', 'resolvido')),
  nota text,
  resolvido_por text,
  resolvido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists confere_alerta_proc_idx on public.confere_alertas (processo_id, status);

-- processamento de nova versão do catálogo: diferenças e alertas --------------
create or replace function public.confere_processar_catalogo(p_versao uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.confere_catalogo_versoes;
  v_ant uuid;
  v_alt int := 0; v_nov int := 0; v_rem int := 0; v_alertas int := 0;
  v_lista jsonb;
  v_fora boolean := false;
begin
  if not public.confere_usuario() then raise exception 'sem acesso ao Ágil Confere'; end if;
  select * into v from public.confere_catalogo_versoes where id = p_versao;
  if not found then raise exception 'versão de catálogo não encontrada'; end if;
  select x.id into v_ant from public.confere_catalogo_versoes x
   where x.importador_id = v.importador_id and x.id <> v.id
     and coalesce(x.gerado_em, x.carregado_em) <= coalesce(v.gerado_em, v.carregado_em)
   order by coalesce(x.gerado_em, x.carregado_em) desc, x.carregado_em desc limit 1;

  create temp table _novo on commit drop as
    select codigo_interno, string_agg(assinatura, ';' order by assinatura collate "C") filter (where ativo) as sig,
           jsonb_agg(jsonb_build_object('codigo', codigo, 'versao', versao, 'ncm', ncm, 'situacao', situacao) order by codigo) filter (where ativo) as ativos
      from public.confere_catalogo_produtos where versao_id = v.id group by codigo_interno;
  create temp table _ant on commit drop as
    select codigo_interno, string_agg(assinatura, ';' order by assinatura collate "C") filter (where ativo) as sig,
           jsonb_agg(jsonb_build_object('codigo', codigo, 'versao', versao, 'ncm', ncm, 'situacao', situacao) order by codigo) filter (where ativo) as ativos
      from public.confere_catalogo_produtos where versao_id = v_ant group by codigo_interno;

  if v_ant is not null then
    select count(*) into v_alt from _novo n join _ant a using (codigo_interno) where n.sig is distinct from a.sig;
    select count(*) into v_nov from _novo n where not exists (select 1 from _ant a where a.codigo_interno = n.codigo_interno);
    select count(*) into v_rem from _ant a where not exists (select 1 from _novo n where n.codigo_interno = a.codigo_interno);
    select coalesce(jsonb_agg(jsonb_build_object('codigo_interno', n.codigo_interno, 'antes', a.ativos, 'depois', n.ativos) order by n.codigo_interno), '[]'::jsonb)
      into v_lista from _novo n join _ant a using (codigo_interno) where n.sig is distinct from a.sig;
  else
    v_lista := '[]'::jsonb;
  end if;

  -- alertas: processos não registrados cuja última análise usou um produto que mudou
  select exists (select 1 from public.confere_catalogo_versoes x where x.importador_id = v.importador_id and x.id <> v.id and coalesce(x.gerado_em, x.carregado_em) > coalesce(v.gerado_em, v.carregado_em)) into v_fora;

  with ultimas as (
    select distinct on (a.processo_id) a.id, a.processo_id, a.catalogo_versao_id
      from public.confere_analises a join public.confere_processos p on p.id = a.processo_id
     where p.status = 'aberto' and p.importador_id = v.importador_id
     order by a.processo_id, a.criado_em desc
  ), afetados as (
    select u.processo_id, u.id as analise_id, i.codigo_interno, i.ncm_documento, i.ncm_catalogo, i.produto_codigo, i.produto_versao, i.produto_assinatura, n.ativos as depois
      from ultimas u
      join public.confere_analise_itens i on i.analise_id = u.id
      left join _novo n on n.codigo_interno = i.codigo_interno
     where u.catalogo_versao_id is not null and not v_fora
       and coalesce(i.produto_assinatura, '') is distinct from coalesce(n.sig, '')
  ), ins as (
    insert into public.confere_alertas (processo_id, analise_id, catalogo_versao_id, tipo, codigo_interno, antes, depois, mensagem)
    select f.processo_id, f.analise_id, v.id, 'catalogo', f.codigo_interno,
           jsonb_build_object('ncm_catalogo', f.ncm_catalogo, 'ncm_documento', f.ncm_documento, 'produto', f.produto_codigo, 'versao', f.produto_versao),
           coalesce(f.depois, '[]'::jsonb),
           case
             when f.depois is null then 'Item sem produto ativo na nova versão do catálogo.'
             when (f.depois -> 0 ->> 'ncm') is distinct from f.ncm_catalogo then 'NCM do catálogo mudou de ' || coalesce(f.ncm_catalogo, '—') || ' para ' || coalesce(f.depois -> 0 ->> 'ncm', '—') || '.'
             else 'Produto do catálogo mudou (código, versão ou descrição).'
           end
      from afetados f
     where not exists (select 1 from public.confere_alertas x where x.processo_id = f.processo_id and x.codigo_interno = f.codigo_interno and x.catalogo_versao_id = v.id)
    returning 1
  )
  select count(*) into v_alertas from ins;

  update public.confere_catalogo_versoes
     set resumo = jsonb_build_object('anterior', v_ant, 'alterados', v_alt, 'novos', v_nov, 'removidos', v_rem, 'alertas', v_alertas, 'fora_de_ordem', v_fora, 'lista', v_lista)
   where id = v.id;
  return jsonb_build_object('anterior', v_ant, 'alterados', v_alt, 'novos', v_nov, 'removidos', v_rem, 'alertas', v_alertas, 'fora_de_ordem', v_fora);
end $$;

-- segurança (RLS) ---------------------------------------------------------
alter table public.confere_acesso enable row level security;
alter table public.confere_importadores enable row level security;
alter table public.confere_regras enable row level security;
alter table public.confere_catalogo_versoes enable row level security;
alter table public.confere_catalogo_produtos enable row level security;
alter table public.confere_processos enable row level security;
alter table public.confere_documentos enable row level security;
alter table public.confere_analises enable row level security;
alter table public.confere_analise_itens enable row level security;
alter table public.confere_ocorrencias enable row level security;
alter table public.confere_alertas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['confere_importadores', 'confere_catalogo_versoes', 'confere_catalogo_produtos', 'confere_processos', 'confere_documentos', 'confere_analises', 'confere_analise_itens', 'confere_ocorrencias', 'confere_alertas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('drop policy if exists %I on public.%I', t || '_insercao', t);
    execute format('drop policy if exists %I on public.%I', t || '_alteracao', t);
    execute format('drop policy if exists %I on public.%I', t || '_exclusao', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.confere_usuario())', t || '_leitura', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.confere_usuario())', t || '_insercao', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.confere_usuario()) with check (public.confere_usuario())', t || '_alteracao', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.confere_master())', t || '_exclusao', t);
  end loop;
end $$;

drop policy if exists confere_acesso_leitura on public.confere_acesso;
drop policy if exists confere_acesso_gestao on public.confere_acesso;
create policy confere_acesso_leitura on public.confere_acesso for select to authenticated using (public.confere_usuario());
create policy confere_acesso_gestao on public.confere_acesso for all to authenticated using (public.confere_master()) with check (public.confere_master());

drop policy if exists confere_regras_leitura on public.confere_regras;
drop policy if exists confere_regras_gestao on public.confere_regras;
create policy confere_regras_leitura on public.confere_regras for select to authenticated using (public.confere_usuario());
create policy confere_regras_gestao on public.confere_regras for update to authenticated using (public.confere_master()) with check (public.confere_master());

revoke execute on function public.confere_processar_catalogo(uuid) from anon;

-- arquivos (bucket privado) -------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('confere', 'confere', false, 52428800)
on conflict (id) do nothing;

drop policy if exists confere_arquivos_leitura on storage.objects;
drop policy if exists confere_arquivos_envio on storage.objects;
drop policy if exists confere_arquivos_alteracao on storage.objects;
drop policy if exists confere_arquivos_exclusao on storage.objects;
create policy confere_arquivos_leitura on storage.objects for select to authenticated using (bucket_id = 'confere' and public.confere_usuario());
create policy confere_arquivos_envio on storage.objects for insert to authenticated with check (bucket_id = 'confere' and public.confere_usuario());
create policy confere_arquivos_alteracao on storage.objects for update to authenticated using (bucket_id = 'confere' and public.confere_usuario());
create policy confere_arquivos_exclusao on storage.objects for delete to authenticated using (bucket_id = 'confere' and public.confere_master());
