-- Planilha de validação do diferimento de ICMS como documento conferido
alter table public.confere_documentos drop constraint if exists confere_documentos_tipo_check;
alter table public.confere_documentos add constraint confere_documentos_tipo_check check (tipo in ('invoice', 'packing', 'invoice_packing', 'bl', 'txt', 'relatorio', 'diferimento', 'ce', 'outro'));
insert into public.confere_regras (codigo, titulo, documento, severidade, base_legal, fases, interna, ativa) values
 ('DIF-01', 'Item validado na planilha de diferimento de ICMS', 'diferimento', 'alerta', 'Controle interno (diferimento de ICMS)', array['pre_alerta','pre_registro'], true, true),
 ('DIF-02', 'Diferimento e finalidade do item', 'diferimento', 'info', 'Controle interno (diferimento de ICMS)', array['pre_alerta','pre_registro'], true, true)
on conflict (codigo) do nothing;
