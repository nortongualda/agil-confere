# Ágil Confere

Verificação e análise documental dos processos de importação da Ágil Aduaneira (primeiro cliente: Eletra).

- **Fase 1 · pré-alerta:** invoice, packing list e draft do HBL. Exigências do Regulamento Aduaneiro (Decreto 6.759/2009, art. 557), conferência entre documentos e situação de cada item no Catálogo de Produtos.
- **Fase 3 · pré-registro:** TXT do TOTVS (layout SIGAEIC despachante), invoice final e relatório de itens do Sigraweb, conciliados item a item contra o catálogo vigente.
- **Sem tolerância:** toda divergência vira ocorrência, com ação (Ajuste Cliente, Ajuste Catálogo, Ajuste Documento, Ciente e OK) e decisão de seguir ou não.
- **Catálogo versionado:** cada JSON exportado do Portal Único vira uma versão; mudanças geram alertas para processos ainda não registrados.
- **Parecer em PDF** no padrão da Ágil, com observações selecionáveis e texto editável.

Estrutura:
- `index.html` e `js/app.js`: tela e fluxo (Supabase).
- `js/nucleo/base.js`: leitura dos arquivos (TXT TOTVS, planilhas, relatório, catálogo) e comparação de descrições.
- `js/nucleo/regras.js`: matriz de regras e motor de conferência.
- `js/pdf.js`: parecer em PDF.
- `supabase/`: migração do banco (tabelas `confere_*`, regras de acesso) e função de gestão de usuários.

Dados no Supabase (projeto agil-desk). A chave em `js/config.js` é publicável; a proteção vem das regras de acesso do banco.
