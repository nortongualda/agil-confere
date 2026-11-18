/* Ágil Confere · motor de conferência.
   "A leitura extrai, a regra decide": cada achado cita documento, campo, valor
   encontrado, valor esperado e a base da regra. Sem tolerância numérica além da
   precisão que os próprios documentos usam (2 casas para pesos e valores). */
(function (raiz) {
  'use strict';
  const C = (typeof module === 'object' && module.exports) ? Object.assign(module.exports, require('./base.js')) : raiz.Confere;
  const U = C.util, D = C.descricao, K = C.catalogo;
  const { norm, normCod, alnum, num, arred, iguais, fmt, fmtAuto, fmtNcm, ncmLimpa, moedaISO, paisCodigo, paisNome, unidadeBase, INCOTERMS, INCOTERM_COM_FRETE, INCOTERM_COM_SEGURO } = U;
  const VERSAO_MOTOR = '1.0 (18/11/2026)';

  const COM_ARTIGO = { invoice: 'a invoice', packing: 'o packing list', bl: 'o BL', ce: 'o CE Mercante', txt: 'o TXT', relatorio: 'o relatório de itens', catalogo: 'o Catálogo de Produtos', processo: 'o processo' };
  const listaPt = l => l.length <= 1 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
  const INTERNAS = new Set(['CAT-03', 'CAT-05', 'CAT-06', 'REL-01', 'REL-05', 'ITM-09', 'TXT-13', 'TXT-08', 'BL-16']);
  const incluirPorPadrao = a => a.severidade !== 'info' && !INTERNAS.has(a.regra) && a.documento !== 'relatorio';
  const DOCS = { invoice: 'Invoice', packing: 'Packing List', bl: 'HBL', ce: 'CE Mercante', txt: 'TXT (ERP)', relatorio: 'Relatório de itens', catalogo: 'Catálogo de Produtos', processo: 'Processo' };
  const SECOES = [['invoice', 'INVOICE'], ['packing', 'PACKING LIST'], ['bl', 'HBL'], ['ce', 'CE MERCANTE'], ['txt', 'TXT'], ['relatorio', 'RELATÓRIO DE ITENS'], ['catalogo', 'CATÁLOGO DE PRODUTOS'], ['processo', 'OBSERVAÇÕES GERAIS']];
  const PESO_SEV = { bloqueante: 3, alerta: 2, info: 1 };
  const ACOES = { ajuste_cliente: 'Ajuste Cliente', ajuste_catalogo: 'Ajuste Catálogo', ajuste_documento: 'Ajuste Documento', ciente_ok: 'Ciente e OK' };
  const F1 = 'pre_alerta', F3 = 'pre_registro', AMBAS = [F1, F3];

  const REGRAS = [
    ['PRO-01', 'Referência do cliente igual nos documentos', 'processo', 'alerta', 'Controle interno', AMBAS],
    ['INV-01', 'Número e data da fatura', 'invoice', 'bloqueante', 'Identificação do documento', AMBAS],
    ['INV-02', 'Exportador: nome e endereço completos', 'invoice', 'bloqueante', 'RA (Dec. 6.759/2009), art. 557, I', AMBAS],
    ['INV-03', 'Importador: nome, endereço e CNPJ', 'invoice', 'bloqueante', 'RA, art. 557, II', AMBAS],
    ['INV-04', 'Especificação completa das mercadorias', 'invoice', 'bloqueante', 'RA, art. 557, III', AMBAS],
    ['INV-05', 'Marcas e numeração dos volumes', 'invoice', 'info', 'RA, art. 557, IV', AMBAS],
    ['INV-06', 'Quantidade e espécie dos volumes', 'invoice', 'info', 'RA, art. 557, V', AMBAS],
    ['INV-07', 'Pesos bruto e líquido', 'invoice', 'alerta', 'RA, art. 557, VI e VII', AMBAS],
    ['INV-08', 'Países de origem, aquisição e procedência', 'invoice', 'bloqueante', 'RA, art. 557, VIII, IX e X', AMBAS],
    ['INV-09', 'Preço unitário e total por item', 'invoice', 'bloqueante', 'RA, art. 557, XI', AMBAS],
    ['INV-10', 'Frete e demais despesas destacados', 'invoice', 'bloqueante', 'RA, art. 557, XII', AMBAS],
    ['INV-11', 'Condições e moeda de pagamento', 'invoice', 'bloqueante', 'RA, art. 557, XIII', AMBAS],
    ['INV-12', 'Incoterm coerente em toda a fatura', 'invoice', 'alerta', 'RA, art. 557, XIV', AMBAS],
    ['INV-13', 'Fatura assinada pelo exportador', 'invoice', 'info', 'RA, art. 553, II', AMBAS],
    ['INV-14', 'Totais da fatura iguais à soma dos itens', 'invoice', 'alerta', 'RA, art. 557, XI', AMBAS],
    ['PKL-01', 'Packing list com as mesmas referências da invoice', 'packing', 'alerta', 'Conferência entre documentos', AMBAS],
    ['PKL-02', 'Itens do packing list iguais aos da invoice', 'packing', 'alerta', 'Conferência entre documentos', AMBAS],
    ['PKL-03', 'Totais do packing list iguais aos da invoice', 'packing', 'alerta', 'Conferência entre documentos', AMBAS],
    ['PKL-04', 'Volumes e cubagem informados', 'packing', 'alerta', 'RA, art. 557, V', AMBAS],
    ['PKL-05', 'Container e lacre informados', 'packing', 'info', 'Conferência entre documentos', AMBAS],
    ['PKL-06', 'Declaração de embalagem de madeira', 'packing', 'alerta', 'IN MAPA nº 32/2015 (embalagens de madeira)', AMBAS],
    ['BL-01', 'Embarcador igual ao exportador', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-02', 'Consignatário igual ao importador (nome e CNPJ)', 'bl', 'bloqueante', 'Conferência entre documentos', AMBAS],
    ['BL-03', 'Notify party informado', 'bl', 'info', 'Conferência entre documentos', AMBAS],
    ['BL-04', 'Portos de embarque e descarga iguais à invoice', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-05', 'Volumes iguais ao packing list', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-06', 'Peso bruto igual à invoice e ao packing list', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-07', 'Cubagem igual ao packing list', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-08', 'Marcas iguais ao packing list', 'bl', 'info', 'Conferência entre documentos', AMBAS],
    ['BL-09', 'NCM do BL cobre todas as posições dos itens', 'bl', 'alerta', 'Conferência entre documentos (reflete no CE Mercante)', AMBAS],
    ['BL-10', 'Frete: valor, moeda e modalidade', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-11', 'Incoterm igual à invoice', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-12', 'Número do container', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-13', 'Sem campos provisórios ou texto em outro idioma', 'bl', 'bloqueante', 'Conferência documental', AMBAS],
    ['BL-14', 'Referências (IP e PO) iguais à invoice', 'bl', 'alerta', 'Conferência entre documentos', AMBAS],
    ['BL-15', 'Declaração de embalagem de madeira', 'bl', 'alerta', 'IN MAPA nº 32/2015 (embalagens de madeira)', AMBAS],
    ['BL-16', 'Número do BL', 'bl', 'info', 'Conferência documental', AMBAS],
    ['TXT-01', 'Estrutura do arquivo no layout TOTVS', 'txt', 'bloqueante', 'Layout SIGAEIC (TDN TOTVS)', [F3]],
    ['TXT-02', 'CNPJ do importador', 'txt', 'bloqueante', 'Conferência entre documentos', [F3]],
    ['TXT-03', 'Referência do processo e número da invoice', 'txt', 'bloqueante', 'Conferência entre documentos', [F3]],
    ['TXT-04', 'Incoterm e moeda iguais à invoice', 'txt', 'bloqueante', 'Conferência entre documentos', [F3]],
    ['TXT-05', 'Países de origem, aquisição e procedência', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['TXT-06', 'Pesos bruto e líquido', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['TXT-07', 'Frete igual à invoice', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['TXT-08', 'Seguro', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['TXT-12', 'Fabricante e exportador', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['TXT-13', 'Valor de câmbio (CAP3)', 'txt', 'info', 'Conferência entre documentos', [F3]],
    ['REL-01', 'Cabeçalho do relatório (referências, incoterm, moeda, pesos)', 'relatorio', 'alerta', 'Controle interno', [F3]],
    ['REL-05', 'Totais, frete e seguro do relatório', 'relatorio', 'alerta', 'Controle interno', [F3]],
    ['ITM-01', 'Item presente em todos os documentos', 'processo', 'bloqueante', 'Conferência entre documentos', AMBAS],
    ['ITM-02', 'NCM igual nos documentos e no catálogo', 'processo', 'bloqueante', 'Classificação fiscal (NCM)', AMBAS],
    ['ITM-03', 'Quantidade igual nos documentos', 'processo', 'bloqueante', 'Conferência entre documentos', AMBAS],
    ['ITM-04', 'Preço unitário e valor iguais nos documentos', 'processo', 'bloqueante', 'Conferência entre documentos', AMBAS],
    ['ITM-05', 'Peso líquido igual nos documentos', 'processo', 'alerta', 'Conferência entre documentos', AMBAS],
    ['ITM-06', 'Pedido de compra (PO) igual nos documentos', 'processo', 'alerta', 'Conferência entre documentos', [F3]],
    ['ITM-07', 'Unidade de medida igual nos documentos', 'processo', 'alerta', 'Conferência entre documentos', [F3]],
    ['ITM-08', 'Descrição do TXT x invoice e catálogo', 'txt', 'alerta', 'Descrição da mercadoria', [F3]],
    ['ITM-09', 'Descrição do relatório de itens x catálogo vigente', 'relatorio', 'alerta', 'Controle interno', [F3]],
    ['ITM-10', 'País de origem do item', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['ITM-11', 'Fabricante do item', 'txt', 'alerta', 'Conferência entre documentos', [F3]],
    ['CAT-01', 'Produto cadastrado no catálogo', 'catalogo', 'bloqueante', 'Catálogo de Produtos (Portal Único)', AMBAS],
    ['CAT-02', 'Produto ativo no catálogo', 'catalogo', 'bloqueante', 'Catálogo de Produtos (Portal Único)', AMBAS],
    ['CAT-03', 'Um único produto ativo por código interno', 'catalogo', 'alerta', 'Catálogo de Produtos (Portal Único)', AMBAS],
    ['CAT-05', 'Descrição do catálogo sem campos genéricos', 'catalogo', 'alerta', 'Catálogo de Produtos (Portal Único)', AMBAS],
    ['CAT-06', 'Informações da fatura presentes no catálogo', 'catalogo', 'alerta', 'Descrição da mercadoria', AMBAS],
    ['CAT-07', 'Fatura e catálogo descrevem o mesmo produto', 'invoice', 'bloqueante', 'Descrição da mercadoria', AMBAS],
    ['CAT-08', 'Informações do catálogo presentes na fatura', 'invoice', 'alerta', 'RA, art. 557, III', AMBAS]
  ].map(([codigo, titulo, documento, severidade, base, fases]) => ({ codigo, titulo, documento, severidade, base, fases }));
  const MAPA = Object.fromEntries(REGRAS.map(r => [r.codigo, r]));

  /* ---------------- auxiliares ---------------- */
  const soma = (l, k) => l.reduce((s, x) => s + (x[k] == null ? 0 : x[k]), 0);
  const digitos = s => String(s == null ? '' : s).replace(/\D/g, '');
  const fmtCnpj = s => { const d = digitos(s); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (s || '—'); };
  const refContem = (a, b) => { const x = alnum(a), y = alnum(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
  function mesmoNome(a, b) {
    if (!a || !b) return false;
    const s = D.similaridade(a, b);
    return s.contencao >= 0.75;
  }
  const porto = s => norm(s).replace(/BRASIL/g, 'BRAZIL').replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  const mesmoPorto = (a, b) => { const x = porto(a), y = porto(b); return !!x.length && !!y.length && x[0] === y[0]; };
  const pos = s => new Set((String(s || '').match(/\d{5,7}/g) || []).map(x => x.replace(/^0+/, '')));
  const fmtSet = s => [...s].join(', ') || '—';
  const kg = v => `${fmt(v, 2)} kg`;
  const dinheiro = (moeda, v) => `${moeda || ''} ${fmt(v, 2)}`.trim();
  function coletor(fase, desligadas, severidades) {
    const lista = [], off = new Set(desligadas || []), sevs = severidades || {};
    let n = 0;
    return {
      lista,
      add(regra, o) {
        const def = MAPA[regra] || {};
        if (off.has(regra) || (def.fases && !def.fases.includes(fase))) return null;
        const a = Object.assign({ regra, titulo: def.titulo, base: def.base, severidade: sevs[regra] || def.severidade || 'alerta', documento: def.documento, campo: null, item: null, encontrado: null, esperado: null, mensagem: '', sugestao: '', acao: 'ajuste_documento', acaoDocumento: null }, o);
        if (!a.sugestao) a.sugestao = a.mensagem;
        if (!a.acaoDocumento && a.acao === 'ajuste_documento') a.acaoDocumento = DOCS[a.documento] || null;
        if (a.incluirPdf == null) a.incluirPdf = incluirPorPadrao(a);
        a.interna = INTERNAS.has(a.regra) || a.documento === 'relatorio';
        a.chave = [a.regra, a.documento, a.item || '', a.campo || '', String(a.encontrado || '')].join('|');
        if (lista.some(x => x.chave === a.chave)) return null;
        a.id = 'a' + (++n);
        lista.push(a);
        return a;
      }
    };
  }
  const refItem = i => i.codigo || (i.seq != null ? `nº ${i.seq}` : `linha ${i.linha}`);

  /* ---------------- processo ---------------- */
  function regrasProcesso(x) {
    const { proc, inv, pkl, bl, A } = x;
    if (!proc.refCliente) return;
    const cands = [['invoice', inv && inv.cab.ipRef], ['packing', pkl && pkl.cab.ipRef], ['bl', bl && bl.cab.ipRef]];
    cands.forEach(([doc, v]) => {
      if (v && !refContem(v, proc.refCliente)) A.add('PRO-01', { documento: doc, campo: 'Referência do cliente', encontrado: v, esperado: proc.refCliente, mensagem: `${DOCS[doc]} traz a referência "${v}", diferente do processo (${proc.refCliente}).`, sugestao: `Conferir a referência do pedido no ${DOCS[doc]}: consta "${v}", o processo é ${proc.refCliente}.` });
    });
  }

  /* ---------------- invoice ---------------- */
  function regrasFatura(x) {
    const { inv, pkl, A, proc } = x;
    if (!inv) return;
    const c = inv.cab, cnpjProc = digitos(proc.cnpj);
    if (!c.numero) A.add('INV-01', { campo: 'Número da fatura', mensagem: 'Número da fatura não localizado.', sugestao: 'Informar o número da invoice.' });
    if (!c.data) A.add('INV-01', { severidade: 'alerta', campo: 'Data da fatura', mensagem: 'Data de emissão da fatura não localizada.', sugestao: 'Informar a data de emissão da invoice.' });
    if (!c.exportador || !c.exportador.nome) A.add('INV-02', { campo: 'Exportador', mensagem: 'Exportador não identificado na fatura.', sugestao: 'Informar nome e endereço completos do exportador.' });
    else if (!c.exportador.endereco) A.add('INV-02', { campo: 'Endereço do exportador', encontrado: c.exportador.nome, mensagem: 'Endereço do exportador ausente.', sugestao: 'Informar o endereço completo do exportador.' });
    if (!c.importador || !c.importador.nome) A.add('INV-03', { campo: 'Importador', mensagem: 'Importador não identificado na fatura.', sugestao: 'Informar nome, endereço e CNPJ do importador.' });
    else {
      if (!c.importador.endereco) A.add('INV-03', { campo: 'Endereço do importador', mensagem: 'Endereço do importador ausente.', sugestao: 'Informar o endereço completo do importador.' });
      if (cnpjProc) {
        if (!c.importador.cnpj) A.add('INV-03', { severidade: 'alerta', campo: 'CNPJ do importador', encontrado: 'não informado', esperado: fmtCnpj(cnpjProc), mensagem: 'CNPJ do importador não consta na fatura.', sugestao: `Incluir o CNPJ do importador (${fmtCnpj(cnpjProc)}) na invoice.` });
        else if (c.importador.cnpj !== cnpjProc) A.add('INV-03', { campo: 'CNPJ do importador', encontrado: fmtCnpj(c.importador.cnpj), esperado: fmtCnpj(cnpjProc), mensagem: `CNPJ do importador na fatura (${fmtCnpj(c.importador.cnpj)}) difere do processo (${fmtCnpj(cnpjProc)}).`, sugestao: `Corrigir o CNPJ do importador na invoice para ${fmtCnpj(cnpjProc)}.` });
      }
    }
    if (inv.itens.length && inv.itens.every(i => !i.codigo)) A.add('INV-04', { severidade: 'alerta', campo: 'Código interno', encontrado: 'coluna ausente', esperado: 'material code por item', mensagem: 'A invoice não traz o código interno (material code) dos itens: a conferência com o catálogo e com o TXT fica limitada.', sugestao: 'Incluir na invoice o código interno (material code) de cada item.' });
    inv.itens.forEach(i => {
      const r = refItem(i);
      if (!i.descricao) A.add('INV-04', { item: r, campo: 'Descrição', mensagem: `Item ${r} sem descrição.`, sugestao: `Informar a descrição completa do item ${r}.` });
      const ph = D.placeholders(i.descricao);
      if (ph.length) A.add('INV-04', { item: r, campo: 'Descrição', encontrado: ph.join(', '), esperado: 'valores reais', mensagem: `Descrição do item ${r} na invoice tem campos sem preenchimento: ${ph.join(', ')}.`, sugestao: `Gentileza complementar a descrição do item ${r} na invoice: os campos ${ph.join(', ')} estão sem preenchimento (ex.: marca, modelo, número de série e ano de fabricação).` });
      if (!/^\d{8}$/.test(i.ncm || '')) A.add('INV-04', { severidade: 'alerta', item: r, campo: 'NCM', encontrado: i.ncm || 'não informada', esperado: '8 dígitos', mensagem: `NCM do item ${r} ausente ou fora do padrão.`, sugestao: `Informar a NCM (8 dígitos) do item ${r}.` });
    });
    const conferirVolumes = !!(pkl || c.volumes || c.marcas != null || !x.f3);
    const vol = c.volumes || (pkl && pkl.cab.volumes);
    if (!conferirVolumes) { /* fase de registro sem packing list: volumes já conferidos no pré-alerta */ }
    else if (!vol || vol.qtd == null) A.add('INV-06', { severidade: 'alerta', campo: 'Quantidade de volumes', encontrado: 'não informada', mensagem: 'Quantidade de volumes não consta na fatura nem no packing list.', sugestao: 'Informar a quantidade e a espécie dos volumes.' });
    else {
      if (!c.volumes) A.add('INV-06', { campo: 'Volumes', encontrado: 'só no packing list', mensagem: `Quantidade e espécie dos volumes constam apenas no packing list (${vol.qtd} ${vol.especie || ''}).`, sugestao: 'Incluir na invoice a quantidade e a espécie dos volumes (hoje constam apenas no packing list).', acao: 'ciente_ok' });
      if (!vol.especie || /^(PACKAGES?|PKGS?|VOLUMES?|PACKS?|UNITS?)$/.test(norm(vol.especie))) A.add('INV-06', { campo: 'Espécie dos volumes', encontrado: vol.especie || 'não informada', esperado: 'pallets, caixas, engradados...', mensagem: `Espécie dos volumes genérica ("${vol.especie || 'não informada'}").`, sugestao: 'Especificar a espécie dos volumes (ex.: pallets, caixas de madeira, caixas de papelão).' });
    }
    const marcas = c.marcas != null ? c.marcas : (pkl ? pkl.cab.marcas : null);
    if (!conferirVolumes) { /* idem */ }
    else if (marcas == null || marcas === '') A.add('INV-05', { severidade: 'alerta', campo: 'Marcas dos volumes', encontrado: 'não informadas', mensagem: 'Marcas e numeração dos volumes não informadas.', sugestao: 'Informar marcas e numeração dos volumes ou declarar "N/M" (sem marcas).' });
    else if (/^N\/?M$|NO\s*MARKS?|SEM\s*MARCA/.test(norm(marcas))) A.add('INV-05', { campo: 'Marcas dos volumes', encontrado: marcas, mensagem: 'Volumes declarados sem marcas (N/M).', sugestao: 'Volumes declarados sem marcas (N/M): confirmar com o exportador; havendo marcação física, ela deve constar nos documentos.', acao: 'ciente_ok' });
    const somaLiq = soma(inv.itens, 'pesoLiq'), somaBru = soma(inv.itens, 'pesoBruto');
    if (inv.itens.some(i => i.pesoLiq == null)) A.add('INV-07', { severidade: 'bloqueante', campo: 'Peso líquido por item', mensagem: 'Há itens sem peso líquido na fatura.', sugestao: 'Informar o peso líquido de cada item.' });
    if (inv.itens.some(i => i.pesoLiq != null && i.pesoBruto != null && i.pesoLiq > i.pesoBruto)) inv.itens.filter(i => i.pesoLiq > i.pesoBruto).forEach(i => A.add('INV-07', { item: refItem(i), campo: 'Pesos do item', encontrado: `líquido ${kg(i.pesoLiq)} > bruto ${kg(i.pesoBruto)}`, mensagem: `Item ${refItem(i)} com peso líquido maior que o bruto.`, sugestao: `Conferir os pesos do item ${refItem(i)}: líquido maior que o bruto.` }));
    const T = inv.totais || {};
    if (T.pesoLiq == null) A.add('INV-07', { campo: 'Peso líquido total', encontrado: 'não informado', mensagem: 'Peso líquido total não localizado na fatura.', sugestao: 'Informar o peso líquido total na invoice.' });
    else if (!iguais(T.pesoLiq, somaLiq, 2)) A.add('INV-07', { campo: 'Peso líquido total', encontrado: kg(T.pesoLiq), esperado: `${kg(somaLiq)} (soma dos itens)`, mensagem: `Peso líquido total (${kg(T.pesoLiq)}) difere da soma dos itens (${kg(somaLiq)}).`, sugestao: `Conferir o peso líquido total da invoice: ${kg(T.pesoLiq)}, soma dos itens ${kg(somaLiq)}.` });
    if (T.pesoBruto == null) A.add('INV-07', { campo: 'Peso bruto total', encontrado: 'não informado', mensagem: 'Peso bruto total não localizado na fatura.', sugestao: 'Informar o peso bruto total na invoice.' });
    else if (inv.itens.every(i => i.pesoBruto != null) && !iguais(T.pesoBruto, somaBru, 2)) A.add('INV-07', { campo: 'Peso bruto total', encontrado: kg(T.pesoBruto), esperado: `${kg(somaBru)} (soma dos itens)`, mensagem: `Peso bruto total (${kg(T.pesoBruto)}) difere da soma dos itens (${kg(somaBru)}).`, sugestao: `Conferir o peso bruto total da invoice: ${kg(T.pesoBruto)}, soma dos itens ${kg(somaBru)}.` });
    [['paisOrigem', 'origem', 'VIII'], ['paisAquisicao', 'aquisição', 'IX'], ['paisProcedencia', 'procedência', 'X']].forEach(([k, n]) => {
      if (!c[k]) A.add('INV-08', { campo: `País de ${n}`, encontrado: 'não informado', mensagem: `País de ${n} não informado na fatura.`, sugestao: `Informar o país de ${n} na invoice.` });
      else if (!paisCodigo(c[k])) A.add('INV-08', { severidade: 'info', campo: `País de ${n}`, encontrado: c[k], mensagem: `País de ${n} "${c[k]}" sem correspondência na tabela do sistema; conferir manualmente.`, acao: 'ciente_ok' });
    });
    inv.itens.forEach(i => {
      const r = refItem(i);
      if (i.preco == null || i.total == null) A.add('INV-09', { item: r, campo: 'Preço / total', encontrado: 'não informado', mensagem: `Item ${r} sem preço unitário ou valor total.`, sugestao: `Informar preço unitário e valor total do item ${r}.` });
      else if (!iguais(i.qtd * i.preco, i.total, 2)) A.add('INV-09', { item: r, campo: 'Valor total do item', encontrado: fmt(i.total), esperado: `${fmt(i.qtd * i.preco)} (quantidade × preço)`, mensagem: `Item ${r}: ${fmtAuto(i.qtd, 5)} × ${fmtAuto(i.preco)} = ${fmt(i.qtd * i.preco)}, fatura informa ${fmt(i.total)}.`, sugestao: `Conferir o valor total do item ${r}: quantidade × preço unitário resulta em ${fmt(i.qtd * i.preco)}; a invoice informa ${fmt(i.total)}.` });
    });
    if (T.total != null && !iguais(T.total, soma(inv.itens, 'total'), 2)) A.add('INV-14', { campo: 'Valor total', encontrado: fmt(T.total), esperado: `${fmt(soma(inv.itens, 'total'))} (soma dos itens)`, mensagem: 'Valor total da fatura difere da soma dos itens.', sugestao: `Conferir o valor total da invoice: ${fmt(T.total)}, soma dos itens ${fmt(soma(inv.itens, 'total'))}.` });
    if (T.qtd != null && !iguais(T.qtd, soma(inv.itens, 'qtd'), 5)) A.add('INV-14', { campo: 'Quantidade total', encontrado: fmtAuto(T.qtd), esperado: `${fmtAuto(soma(inv.itens, 'qtd'))} (soma dos itens)`, mensagem: 'Quantidade total difere da soma dos itens.', sugestao: 'Conferir a quantidade total da invoice.' });
    if (!c.moeda) A.add('INV-11', { campo: 'Moeda', encontrado: 'não identificada', mensagem: 'Moeda da fatura não identificada.', sugestao: 'Indicar a moeda da negociação na invoice.' });
    if (!c.pagamento) A.add('INV-11', { campo: 'Condições de pagamento', encontrado: 'não informadas', mensagem: 'Condição de pagamento não localizada na fatura.', sugestao: 'Informar as condições de pagamento na invoice.' });
    if (!c.incoterm) A.add('INV-12', { severidade: 'bloqueante', campo: 'Incoterm', encontrado: 'não informado', mensagem: 'Incoterm não informado na fatura.', sugestao: 'Informar o incoterm (condição de venda) na invoice.' });
    else {
      if (!INCOTERMS.includes(c.incoterm)) A.add('INV-12', { severidade: 'bloqueante', campo: 'Incoterm', encontrado: c.incoterm, mensagem: `Incoterm "${c.incoterm}" não reconhecido.`, sugestao: 'Informar um incoterm válido (Incoterms 2020).' });
      const rotulos = [T.rotulo, ...Object.values(c.colunas || {})].filter(Boolean);
      rotulos.forEach(rot => (norm(rot).match(/\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/g) || []).filter(t => t !== c.incoterm).forEach(t => A.add('INV-12', { campo: 'Rótulo de valores', encontrado: rot, esperado: c.incoterm, mensagem: `A fatura usa o rótulo "${rot}", mas o incoterm da operação é ${c.incoterm}.`, sugestao: `Aconselhamos retirar a menção a ${t} do texto "${rot}", visto que a operação é ${c.incoterm}.` })));
    }
    if (c.incoterm && INCOTERM_COM_FRETE.includes(c.incoterm) && !(c.frete && c.frete.valor)) {
      const tf = x.tp && x.tp.cap2 && ((x.tp.cap2.fretePrepaid || 0) + (x.tp.cap2.freteCollect || 0));
      const mf = x.tp && x.tp.cap2 && moedaISO(x.tp.cap2.moedaFrete);
      A.add('INV-10', { campo: 'Frete internacional', encontrado: 'não destacado', esperado: tf ? `${dinheiro(mf, tf)} (valor do TXT)` : 'valor do frete', mensagem: `Incoterm ${c.incoterm} inclui o frete no preço, mas a fatura não destaca o valor do frete${tf ? ` (TXT informa ${dinheiro(mf, tf)})` : ''}.`, sugestao: `Visto que a operação é ${c.incoterm}, destacar na invoice o valor do frete internacional${tf ? ` (${dinheiro(mf, tf)}, conforme TXT)` : ''}.` });
    }
    if (c.incoterm && INCOTERM_COM_SEGURO.includes(c.incoterm) && !(c.seguro && c.seguro.valor)) A.add('INV-10', { campo: 'Seguro', encontrado: 'não destacado', mensagem: `Incoterm ${c.incoterm} inclui o seguro, mas a fatura não destaca o valor do seguro.`, sugestao: `Visto que a operação é ${c.incoterm}, destacar na invoice o valor do seguro.` });
    A.add('INV-13', { campo: 'Assinatura', encontrado: 'não verificável em planilha', mensagem: 'A planilha não permite verificar a assinatura do exportador.', sugestao: 'Enviar a via final da invoice assinada pelo exportador.', acao: 'ciente_ok' });
  }

  /* ---------------- packing list ---------------- */
  function regrasRomaneio(x) {
    const { inv, pkl, A, f3 } = x;
    if (!pkl) return;
    const p = pkl.cab;
    if (inv) {
      const c = inv.cab;
      [['numero', 'Número da fatura'], ['ipRef', 'Referência IP'], ['incoterm', 'Incoterm']].forEach(([k, n]) => {
        if (p[k] && c[k] && alnum(p[k]) !== alnum(c[k])) A.add('PKL-01', { campo: n, encontrado: p[k], esperado: c[k], mensagem: `${n} no packing list (${p[k]}) difere da invoice (${c[k]}).`, sugestao: `Ajustar ${n.toLowerCase()} no packing list: consta ${p[k]}, invoice ${c[k]}.` });
      });
      if (p.poRef && c.poRef) { const a = pos(p.poRef), b = pos(c.poRef); if (fmtSet(a) !== fmtSet(b)) A.add('PKL-01', { campo: 'Pedidos (PO)', encontrado: fmtSet(a), esperado: fmtSet(b), mensagem: 'Pedidos (PO) do packing list diferem da invoice.', sugestao: 'Ajustar a relação de pedidos (PO) no packing list conforme a invoice.' }); }
      [['portoOrigem', 'Porto de origem'], ['portoDestino', 'Porto de destino']].forEach(([k, n]) => {
        if (p[k] && c[k] && !mesmoPorto(p[k], c[k])) A.add('PKL-01', { campo: n, encontrado: p[k], esperado: c[k], mensagem: `${n} no packing list (${p[k]}) difere da invoice (${c[k]}).` });
      });
      if (p.data && c.data && p.data !== c.data) A.add('PKL-01', { severidade: 'info', campo: 'Data', encontrado: U.fmtData(p.data), esperado: U.fmtData(c.data), mensagem: 'Data do packing list difere da invoice.', acao: 'ciente_ok' });
      const porSeq = new Map(inv.itens.map((i, k) => [i.seq != null ? i.seq : k + 1, i]));
      const vistos = new Set();
      pkl.itens.forEach((pi, k) => {
        const sq = pi.seq != null ? pi.seq : k + 1;
        const i = porSeq.get(sq);
        if (!i) { A.add('PKL-02', { severidade: 'bloqueante', item: `nº ${sq}`, campo: 'Item', encontrado: 'só no packing list', mensagem: `Item nº ${sq} do packing list não existe na invoice.`, sugestao: `Item nº ${sq} consta no packing list e não na invoice.` }); return; }
        vistos.add(sq);
        const r = refItem(i);
        if (pi.ncm && i.ncm && pi.ncm !== i.ncm) A.add('PKL-02', { item: r, campo: 'NCM', encontrado: fmtNcm(pi.ncm), esperado: fmtNcm(i.ncm), mensagem: `NCM do item ${r} no packing list (${fmtNcm(pi.ncm)}) difere da invoice (${fmtNcm(i.ncm)}).`, sugestao: `Ajustar a NCM do item ${r} no packing list para ${fmtNcm(i.ncm)}, conforme invoice.` });
        if (!iguais(pi.qtd, i.qtd, 5)) A.add('PKL-02', { severidade: 'bloqueante', item: r, campo: 'Quantidade', encontrado: fmtAuto(pi.qtd), esperado: fmtAuto(i.qtd), mensagem: `Quantidade do item ${r} no packing list (${fmtAuto(pi.qtd)}) difere da invoice (${fmtAuto(i.qtd)}).`, sugestao: `Ajustar a quantidade do item ${r} no packing list (${fmtAuto(pi.qtd)}) conforme invoice (${fmtAuto(i.qtd)}).` });
        if (pi.pesoLiq != null && i.pesoLiq != null && !iguais(pi.pesoLiq, i.pesoLiq, 2)) A.add('PKL-02', { item: r, campo: 'Peso líquido', encontrado: kg(pi.pesoLiq), esperado: kg(i.pesoLiq), mensagem: `Peso líquido do item ${r}: packing ${kg(pi.pesoLiq)} × invoice ${kg(i.pesoLiq)}.`, sugestao: `Ajustar o peso líquido do item ${r} no packing list (${kg(pi.pesoLiq)}) conforme invoice (${kg(i.pesoLiq)}).` });
        if (pi.pesoBruto != null && i.pesoBruto != null && !iguais(pi.pesoBruto, i.pesoBruto, 2)) A.add('PKL-02', { item: r, campo: 'Peso bruto', encontrado: kg(pi.pesoBruto), esperado: kg(i.pesoBruto), mensagem: `Peso bruto do item ${r}: packing ${kg(pi.pesoBruto)} × invoice ${kg(i.pesoBruto)}.`, sugestao: `Ajustar o peso bruto do item ${r} no packing list (${kg(pi.pesoBruto)}) conforme invoice (${kg(i.pesoBruto)}).` });
        if (pi.descricao && i.descricao && alnum(pi.descricao) !== alnum(i.descricao)) {
          const cmp = D.comparar(i.descricao, pi.descricao);
          A.add('PKL-02', { severidade: cmp.similaridade < 0.6 ? 'alerta' : 'info', item: r, campo: 'Descrição', encontrado: `semelhança ${Math.round(cmp.similaridade * 100)}%`, esperado: 'mesma descrição da invoice', mensagem: `Descrição do item ${r} no packing list difere da invoice.`, sugestao: `Ajustar a descrição do item ${r} no packing list conforme a invoice.` });
        }
      });
      inv.itens.forEach((i, k) => { const sq = i.seq != null ? i.seq : k + 1; if (!vistos.has(sq)) A.add('PKL-02', { severidade: 'bloqueante', item: refItem(i), campo: 'Item', encontrado: 'ausente no packing list', mensagem: `Item ${refItem(i)} da invoice não consta no packing list.`, sugestao: `Incluir o item ${refItem(i)} no packing list.` }); });
      const a = pkl.totais || {}, b = inv.totais || {};
      [['qtd', 'Quantidade total', 5, v => fmtAuto(v)], ['pesoLiq', 'Peso líquido total', 2, kg], ['pesoBruto', 'Peso bruto total', 2, kg]].forEach(([k, n, cs, f]) => {
        if (a[k] != null && b[k] != null && !iguais(a[k], b[k], cs)) A.add('PKL-03', { campo: n, encontrado: f(a[k]), esperado: f(b[k]), mensagem: `${n} do packing list (${f(a[k])}) difere da invoice (${f(b[k])}).`, sugestao: `Ajustar ${n.toLowerCase()} no packing list conforme invoice (${f(b[k])}).` });
      });
    }
    if (!p.volumes || p.volumes.qtd == null) A.add('PKL-04', { campo: 'Volumes', encontrado: 'não informado', mensagem: 'Quantidade de volumes não localizada no packing list.', sugestao: 'Informar a quantidade e a espécie dos volumes no packing list.' });
    if (p.cubagem == null) A.add('PKL-04', { severidade: 'info', campo: 'Cubagem', encontrado: 'não informada', mensagem: 'Cubagem (m³) não informada no packing list.', sugestao: 'Informar a cubagem total (m³) no packing list.' });
    if (p.container === '' || p.lacre === '') A.add('PKL-05', { severidade: f3 ? 'alerta' : 'info', campo: 'Container e lacre', encontrado: 'em branco', mensagem: 'Campos de container e lacre em branco no packing list.', sugestao: 'Informar número do container e do lacre no packing list.' });
    if (p.madeira == null || p.madeira === '') A.add('PKL-06', { campo: 'Embalagem de madeira', encontrado: 'não declarada', mensagem: 'Packing list não declara a condição da embalagem de madeira.', sugestao: 'Declarar a condição da embalagem de madeira (tratada e marcada conforme NIMF 15, madeira processada ou ausência de madeira).' });
  }

  /* ---------------- BL ---------------- */
  function posicoes(x) {
    const s = new Set();
    const add = n => { const d = ncmLimpa(n); if (d.length >= 4) s.add(d.slice(0, 4)); };
    if (x.itens) x.itens.forEach(o => { if (o.ncmReferencia) add(o.ncmReferencia); });
    if (!s.size && x.inv) x.inv.itens.forEach(i => add(i.ncm));
    return s;
  }
  function regrasBL(x) {
    const { bl, inv, pkl, A, proc } = x;
    if (!bl) return;
    const c = bl.cab, r0 = inv ? inv.cab : (pkl ? pkl.cab : null), cnpjProc = digitos(proc.cnpj);
    const phs = new Set();
    [c.freteTexto, c.descricaoCompleta, c.numero].forEach(t => D.placeholders(t).forEach(p => phs.add(p)));
    phs.forEach(p => A.add('BL-13', { campo: 'Texto provisório', encontrado: p, mensagem: `BL com campo provisório ou não preenchido: ${p}.`, sugestao: `Substituir o campo provisório ${p} pela informação definitiva.` }));
    if (!c.shipper || !c.shipper.nome) A.add('BL-01', { campo: 'Shipper', encontrado: 'não identificado', mensagem: 'Embarcador (shipper) não identificado no BL.', sugestao: 'Informar o embarcador (shipper) no BL.' });
    else if (r0 && r0.exportador && !mesmoNome(c.shipper.nome, r0.exportador.nome)) A.add('BL-01', { campo: 'Shipper', encontrado: c.shipper.nome, esperado: r0.exportador.nome, mensagem: `Shipper do BL (${c.shipper.nome}) difere do exportador da invoice (${r0.exportador.nome}).`, sugestao: `Conferir o shipper do BL: ${c.shipper.nome}; exportador na invoice: ${r0.exportador.nome}.` });
    if (!c.consignee || !c.consignee.nome) A.add('BL-02', { campo: 'Consignee', encontrado: 'não identificado', mensagem: 'Consignatário não identificado no BL.', sugestao: 'Informar o consignatário no BL.' });
    else {
      if (cnpjProc && !c.consignee.cnpj) A.add('BL-02', { severidade: 'alerta', campo: 'CNPJ do consignee', encontrado: 'não informado', esperado: fmtCnpj(cnpjProc), mensagem: 'CNPJ do consignatário não consta no BL.', sugestao: `Incluir o CNPJ do consignatário (${fmtCnpj(cnpjProc)}) no BL.` });
      else if (cnpjProc && c.consignee.cnpj !== cnpjProc) A.add('BL-02', { campo: 'CNPJ do consignee', encontrado: fmtCnpj(c.consignee.cnpj), esperado: fmtCnpj(cnpjProc), mensagem: 'CNPJ do consignatário no BL difere do importador.', sugestao: `Corrigir o CNPJ do consignatário no BL para ${fmtCnpj(cnpjProc)}.` });
      if (r0 && r0.importador && !mesmoNome(c.consignee.nome, r0.importador.nome)) A.add('BL-02', { severidade: 'alerta', campo: 'Consignee', encontrado: c.consignee.nome, esperado: r0.importador.nome, mensagem: 'Nome do consignatário no BL difere do importador da invoice.', sugestao: 'Conferir o nome do consignatário no BL.' });
    }
    if (!c.notify || !c.notify.nome) A.add('BL-03', { campo: 'Notify party', encontrado: 'não informado', mensagem: 'Notify party não informado no BL.', sugestao: 'Informar o notify party no BL.', acao: 'ciente_ok' });
    if (r0) {
      if (!c.portoEmbarque) A.add('BL-04', { campo: 'Porto de embarque', encontrado: 'não informado', mensagem: 'Porto de embarque não informado no BL.', sugestao: 'Informar o porto de embarque no BL.' });
      else if (r0.portoOrigem && !mesmoPorto(c.portoEmbarque, r0.portoOrigem)) A.add('BL-04', { campo: 'Porto de embarque', encontrado: c.portoEmbarque, esperado: r0.portoOrigem, mensagem: `Porto de embarque do BL (${c.portoEmbarque}) difere da invoice (${r0.portoOrigem}).`, sugestao: `Conferir o porto de embarque: BL ${c.portoEmbarque}, invoice ${r0.portoOrigem}.` });
      if (!c.portoDescarga) A.add('BL-04', { campo: 'Porto de descarga', encontrado: 'não informado', mensagem: 'Porto de descarga não informado no BL.', sugestao: 'Informar o porto de descarga no BL.' });
      else if (r0.portoDestino && !mesmoPorto(c.portoDescarga, r0.portoDestino)) A.add('BL-04', { campo: 'Porto de descarga', encontrado: c.portoDescarga, esperado: r0.portoDestino, mensagem: `Porto de descarga do BL (${c.portoDescarga}) difere da invoice (${r0.portoDestino}).`, sugestao: `Conferir o porto de descarga: BL ${c.portoDescarga}, invoice ${r0.portoDestino}.` });
    }
    const pv = pkl && pkl.cab.volumes;
    if (!c.volumes || c.volumes.qtd == null) A.add('BL-05', { campo: 'Volumes', encontrado: 'não informado', mensagem: 'Quantidade de volumes não localizada no BL.', sugestao: 'Informar a quantidade de volumes no BL.' });
    else if (pv && pv.qtd != null && !iguais(pv.qtd, c.volumes.qtd, 0)) A.add('BL-05', { campo: 'Volumes', encontrado: `${c.volumes.qtd} ${c.volumes.especie || ''}`.trim(), esperado: `${pv.qtd} ${pv.especie || ''}`.trim(), mensagem: `BL com ${c.volumes.qtd} volume(s); packing list com ${pv.qtd}.`, sugestao: `Ajustar a quantidade de volumes no BL (${c.volumes.qtd}) conforme packing list (${pv.qtd}).` });
    const bruto = inv && inv.totais && inv.totais.pesoBruto != null ? inv.totais.pesoBruto : (pkl && pkl.totais ? pkl.totais.pesoBruto : null);
    if (c.pesoBruto == null) A.add('BL-06', { campo: 'Peso bruto', encontrado: 'não informado', mensagem: 'Peso bruto não localizado no BL.', sugestao: 'Informar o peso bruto no BL.' });
    else if (bruto != null && !iguais(c.pesoBruto, bruto, 2)) A.add('BL-06', { campo: 'Peso bruto', encontrado: kg(c.pesoBruto), esperado: kg(bruto), mensagem: `Peso bruto do BL (${kg(c.pesoBruto)}) difere da invoice/packing list (${kg(bruto)}).`, sugestao: `Ajustar o peso bruto no BL (${kg(c.pesoBruto)}) conforme invoice e packing list (${kg(bruto)}).` });
    if (pkl && pkl.cab.cubagem != null && c.cubagem != null && !iguais(c.cubagem, pkl.cab.cubagem, 2)) A.add('BL-07', { campo: 'Cubagem', encontrado: `${fmt(c.cubagem)} m³`, esperado: `${fmt(pkl.cab.cubagem)} m³`, mensagem: 'Cubagem do BL difere do packing list.', sugestao: `Ajustar a cubagem no BL (${fmt(c.cubagem)} m³) conforme packing list (${fmt(pkl.cab.cubagem)} m³).` });
    if (pkl && pkl.cab.marcas && c.marcas && alnum(pkl.cab.marcas) !== alnum(c.marcas)) A.add('BL-08', { campo: 'Marcas', encontrado: c.marcas, esperado: pkl.cab.marcas, mensagem: 'Marcas do BL diferem do packing list.', sugestao: 'Ajustar as marcas no BL conforme packing list.' });
    const ps = posicoes(x), noBL = new Set((c.ncms || []).map(n => n.slice(0, 4)));
    const faltam = [...ps].filter(p => !noBL.has(p)), sobram = [...noBL].filter(p => !ps.has(p));
    if (!noBL.size) A.add('BL-09', { campo: 'NCM', encontrado: 'não informada', esperado: fmtSet(ps), mensagem: 'BL não informa NCM.', sugestao: `Incluir no BL as NCMs (4 primeiros dígitos): ${fmtSet(ps)}.` });
    else if (faltam.length) A.add('BL-09', { campo: 'NCM', encontrado: fmtSet(noBL), esperado: fmtSet(ps), mensagem: `BL não cobre a(s) posição(ões) ${faltam.join(', ')} presentes nos itens.`, sugestao: `Notar que faltou incluir a(s) NCM(s) ${faltam.join(', ')} no BL.` });
    if (sobram.length && ps.size) A.add('BL-09', { severidade: 'info', campo: 'NCM', encontrado: sobram.join(', '), mensagem: `BL informa posição(ões) ${sobram.join(', ')} que não aparecem nos itens.`, sugestao: `Conferir a(s) NCM(s) ${sobram.join(', ')} informada(s) no BL: não aparecem nos itens.` });
    const inc = r0 && r0.incoterm;
    if (inc && c.freteModalidade) {
      const esp = INCOTERM_COM_FRETE.includes(inc) ? 'PREPAID' : (['EXW', 'FCA', 'FAS', 'FOB'].includes(inc) ? 'COLLECT' : null);
      if (esp && esp !== c.freteModalidade) A.add('BL-10', { campo: 'Modalidade do frete', encontrado: `FREIGHT ${c.freteModalidade}`, esperado: `FREIGHT ${esp}`, mensagem: `Frete ${c.freteModalidade} não combina com o incoterm ${inc}.`, sugestao: `Conferir a modalidade do frete no BL: ${c.freteModalidade} com incoterm ${inc}.` });
    }
    if (c.freteValor == null) A.add('BL-10', { campo: 'Valor do frete', encontrado: c.freteTexto || 'não informado', esperado: 'valor e moeda', mensagem: 'BL não informa o valor e a moeda do frete.', sugestao: 'Informar valor do frete e a moeda do frete.' });
    if (c.incoterm && inc && c.incoterm !== inc) A.add('BL-11', { campo: 'Incoterm', encontrado: c.incoterm, esperado: inc, mensagem: `Incoterm do BL (${c.incoterm}) difere da invoice (${inc}).`, sugestao: `Ajustar o incoterm no BL para ${inc}.` });
    if (!c.container) A.add('BL-12', { campo: 'Container', encontrado: 'não informado', mensagem: 'Número do container não informado no BL.', sugestao: 'Informar número do container.' });
    if (c.ipRef && r0 && r0.ipRef && alnum(c.ipRef) !== alnum(r0.ipRef)) A.add('BL-14', { campo: 'Referência IP', encontrado: c.ipRef, esperado: r0.ipRef, mensagem: 'Referência IP do BL difere da invoice.', sugestao: `Ajustar a referência no BL para ${r0.ipRef}.` });
    if (c.pos && c.pos.length && r0 && r0.poRef) { const a = new Set(c.pos.map(p => p.replace(/^0+/, ''))), b = pos(r0.poRef); if (fmtSet(a) !== fmtSet(b)) A.add('BL-14', { campo: 'Pedidos (PO)', encontrado: fmtSet(a), esperado: fmtSet(b), mensagem: 'Pedidos (PO) do BL diferem da invoice.', sugestao: 'Ajustar a relação de pedidos (PO) no BL conforme invoice.' }); }
    if (!c.madeira) A.add('BL-15', { campo: 'Embalagem de madeira', encontrado: 'não declarada', mensagem: 'BL não declara a condição da embalagem de madeira.', sugestao: 'Declarar no BL a condição da embalagem de madeira (tratada/marcada, processada ou sem madeira).' });
    else if (pkl && pkl.cab.madeira && norm(pkl.cab.madeira) !== norm(c.madeira)) A.add('BL-15', { campo: 'Embalagem de madeira', encontrado: c.madeira, esperado: pkl.cab.madeira, mensagem: 'Declaração de embalagem de madeira diferente entre BL e packing list.', sugestao: 'Uniformizar a declaração de embalagem de madeira entre BL e packing list.' });
    if (!c.numero) A.add('BL-16', { campo: 'Número do BL', encontrado: 'em branco', mensagem: 'Número do BL em branco (comum em draft).', acao: 'ciente_ok' });
  }

  /* ---------------- TXT (cabeçalho) ---------------- */
  function regrasTxt(x) {
    const { txt, tp, inv, A, proc } = x;
    if (!txt) return;
    (txt.avisos || []).forEach(av => A.add('TXT-01', { campo: 'Estrutura', encontrado: av, mensagem: av, sugestao: `Gerar novamente o TXT no TOTVS: ${av}`, acaoDocumento: 'TXT' }));
    if (!tp) return;
    const cnpjProc = digitos(proc.cnpj);
    if (cnpjProc && txt.itdi && txt.itdi.cnpj && txt.itdi.cnpj !== cnpjProc) A.add('TXT-02', { campo: 'CNPJ (ITDI)', encontrado: fmtCnpj(txt.itdi.cnpj), esperado: fmtCnpj(cnpjProc), mensagem: 'CNPJ do TXT difere do importador do processo.', sugestao: `CNPJ informado no TXT (${fmtCnpj(txt.itdi.cnpj)}) difere do importador (${fmtCnpj(cnpjProc)}).` });
    const refs = [tp.capi && tp.capi.refCliente, tp.capi && tp.capi.processo].filter(Boolean);
    if (proc.refCliente && refs.length && !refs.some(r => refContem(r, proc.refCliente))) A.add('TXT-03', { severidade: 'alerta', campo: 'Referência (CAPI)', encontrado: refs[0], esperado: proc.refCliente, mensagem: `Referência no TXT (${refs[0]}) difere do processo (${proc.refCliente}).`, sugestao: `Conferir a referência do processo no TXT: ${refs[0]}.` });
    if (inv && inv.cab.numero) {
      const ns = [...new Set(tp.itens.map(i => i.invoice).filter(Boolean))];
      if (!ns.length) A.add('TXT-03', { severidade: 'alerta', campo: 'Invoice (ITED)', encontrado: 'não informada', esperado: inv.cab.numero, mensagem: 'O TXT não informa o número da invoice nos itens (ITED).', sugestao: 'Informar o número da invoice nos itens do TXT.' });
      else ns.filter(n => alnum(n) !== alnum(inv.cab.numero)).forEach(n => A.add('TXT-03', { campo: 'Invoice (ITED)', encontrado: n, esperado: inv.cab.numero, mensagem: `TXT vinculado à invoice ${n}; a invoice analisada é ${inv.cab.numero}.`, sugestao: `O TXT está vinculado à invoice ${n}, diferente da invoice ${inv.cab.numero}.` }));
    }
    if (inv) {
      const incs = [...new Set(tp.itens.map(i => i.incoterm).filter(Boolean))];
      if (inv.cab.incoterm) {
        if (!incs.length) A.add('TXT-04', { severidade: 'alerta', campo: 'Incoterm (ITEB)', encontrado: 'não informado', esperado: inv.cab.incoterm, mensagem: 'Incoterm não informado no TXT.', sugestao: `Informar o incoterm ${inv.cab.incoterm} no TXT.` });
        else if (incs.some(v => v !== inv.cab.incoterm)) A.add('TXT-04', { campo: 'Incoterm (ITEB)', encontrado: incs.join(', '), esperado: inv.cab.incoterm, mensagem: `Incoterm do TXT (${incs.join(', ')}) difere da invoice (${inv.cab.incoterm}).`, sugestao: `Ajustar o incoterm no TXT para ${inv.cab.incoterm}, conforme invoice.` });
      }
      const ms = [...new Set(tp.itens.map(i => i.moeda).filter(Boolean))];
      if (inv.cab.moeda && ms.length && ms.some(m => moedaISO(m) !== inv.cab.moeda)) A.add('TXT-04', { campo: 'Moeda (ITEB)', encontrado: ms.map(m => `${m} (${moedaISO(m) || '?'})`).join(', '), esperado: `${inv.cab.moeda} (${(U.MOEDAS[inv.cab.moeda] || {}).cod || '?'})`, mensagem: 'Moeda do TXT difere da invoice.', sugestao: `Ajustar a moeda no TXT para ${inv.cab.moeda}, conforme invoice.` });
      const pO = paisCodigo(inv.cab.paisOrigem), pA = paisCodigo(inv.cab.paisAquisicao), pP = paisCodigo(inv.cab.paisProcedencia);
      const os = [...new Set(tp.itens.map(i => i.paisOrigem).filter(Boolean))], as = [...new Set(tp.itens.map(i => i.paisAquisicao).filter(Boolean))];
      if (pO && os.some(o => o !== pO)) A.add('TXT-05', { campo: 'País de origem (ITEA)', encontrado: os.map(o => `${o} ${paisNome(o)}`).join(', '), esperado: `${pO} ${paisNome(pO)}`, mensagem: 'País de origem do TXT difere da invoice.', sugestao: 'Ajustar o país de origem no TXT conforme invoice.' });
      if (pA && as.some(o => o !== pA)) A.add('TXT-05', { campo: 'País de aquisição (ITEA)', encontrado: as.map(o => `${o} ${paisNome(o)}`).join(', '), esperado: `${pA} ${paisNome(pA)}`, mensagem: 'País de aquisição do TXT difere da invoice.', sugestao: 'Ajustar o país de aquisição no TXT conforme invoice.' });
      if (pP && tp.capi && tp.capi.paisProcedencia && tp.capi.paisProcedencia !== pP) A.add('TXT-05', { campo: 'País de procedência (CAPI)', encontrado: `${tp.capi.paisProcedencia} ${paisNome(tp.capi.paisProcedencia)}`, esperado: `${pP} ${paisNome(pP)}`, mensagem: 'País de procedência do TXT difere da invoice.', sugestao: 'Ajustar o país de procedência no TXT conforme invoice.' });
      const somaTxt = soma(tp.itens, 'pesoLiq');
      if (tp.capi && tp.capi.pesoBruto != null && inv.totais && inv.totais.pesoBruto != null && !iguais(tp.capi.pesoBruto, inv.totais.pesoBruto, 2)) A.add('TXT-06', { campo: 'Peso bruto (CAPI)', encontrado: kg(tp.capi.pesoBruto), esperado: kg(inv.totais.pesoBruto), mensagem: `Peso bruto do TXT (${kg(tp.capi.pesoBruto)}) difere da invoice (${kg(inv.totais.pesoBruto)}).`, sugestao: `Ajustar o peso bruto no TXT (${kg(tp.capi.pesoBruto)}) conforme invoice (${kg(inv.totais.pesoBruto)}).` });
      if (inv.totais && inv.totais.pesoLiq != null && tp.itens.length && !iguais(somaTxt, inv.totais.pesoLiq, 2)) A.add('TXT-06', { campo: 'Peso líquido total', encontrado: `${fmt(somaTxt, 4)} kg (soma ITEA)`, esperado: kg(inv.totais.pesoLiq), mensagem: `Peso líquido total do TXT (${fmt(somaTxt, 4)} kg) difere da invoice (${kg(inv.totais.pesoLiq)}); diferença de ${fmt(Math.abs(somaTxt - inv.totais.pesoLiq), 4)} kg.`, sugestao: `Notar que o peso líquido total do TXT (${fmt(somaTxt, 4)} kg) difere da invoice (${kg(inv.totais.pesoLiq)}).` });
      if (tp.capi && tp.capi.pesoLiq != null && !iguais(tp.capi.pesoLiq, somaTxt, 2)) A.add('TXT-06', { campo: 'Peso líquido (CAPI)', encontrado: kg(tp.capi.pesoLiq), esperado: `${fmt(somaTxt, 4)} kg (soma ITEA)`, mensagem: 'Peso líquido da capa do TXT difere da soma dos itens.', sugestao: 'Conferir o peso líquido da capa do TXT.' });
      const c2 = tp.cap2 || {};
      const fTxt = (c2.fretePrepaid || 0) + (c2.freteCollect || 0), mTxt = moedaISO(c2.moedaFrete);
      const fInv = inv.cab.frete && inv.cab.frete.valor;
      if (fInv && fTxt && !iguais(fInv, fTxt, 2)) A.add('TXT-07', { severidade: 'bloqueante', campo: 'Frete (CAP2)', encontrado: dinheiro(mTxt, fTxt), esperado: dinheiro(inv.cab.moeda, fInv), mensagem: 'Frete do TXT difere do frete destacado na invoice.', sugestao: `Ajustar o frete no TXT (${dinheiro(mTxt, fTxt)}) conforme invoice (${dinheiro(inv.cab.moeda, fInv)}).` });
      if (!fTxt && inv.cab.incoterm && INCOTERM_COM_FRETE.includes(inv.cab.incoterm)) A.add('TXT-07', { campo: 'Frete (CAP2)', encontrado: 'não informado', mensagem: `TXT sem valor de frete com incoterm ${inv.cab.incoterm}.`, sugestao: 'Informar o valor do frete no TXT.' });
      if (fTxt && mTxt && inv.cab.moeda && mTxt !== inv.cab.moeda) A.add('TXT-07', { severidade: 'info', campo: 'Moeda do frete', encontrado: mTxt, esperado: inv.cab.moeda, mensagem: `Frete do TXT em ${mTxt}, moeda da fatura ${inv.cab.moeda}.`, acao: 'ciente_ok' });
      if (c2.valorSeguro) {
        const mS = moedaISO(c2.moedaSeguro), sInv = inv.cab.seguro && inv.cab.seguro.valor;
        if (sInv && mS === inv.cab.moeda && !iguais(sInv, c2.valorSeguro, 2)) A.add('TXT-08', { campo: 'Seguro (CAP2)', encontrado: dinheiro(mS, c2.valorSeguro), esperado: dinheiro(inv.cab.moeda, sInv), mensagem: 'Seguro do TXT difere da invoice.', sugestao: 'Ajustar o seguro no TXT conforme invoice.' });
        else if (!sInv) A.add('TXT-08', { severidade: 'info', campo: 'Seguro (CAP2)', encontrado: dinheiro(mS || c2.moedaSeguro, c2.valorSeguro), mensagem: `TXT informa seguro de ${dinheiro(mS || c2.moedaSeguro, c2.valorSeguro)} (não consta na invoice).`, acao: 'ciente_ok' });
      }
      if (tp.cap3 && tp.cap3.valorCambio != null && inv.totais && inv.totais.total != null && !iguais(tp.cap3.valorCambio, inv.totais.total, 2)) A.add('TXT-13', { campo: 'Valor de câmbio (CAP3)', encontrado: fmt(tp.cap3.valorCambio), esperado: `${fmt(inv.totais.total)} (total da invoice)`, mensagem: 'Valor de câmbio informado no TXT (CAP3) difere do total da invoice.', sugestao: 'Confirmar o valor de câmbio informado no TXT (CAP3): difere do total da invoice.', acao: 'ciente_ok' });
      const fabsInv = [...new Set(inv.itens.map(i => i.fabricante).filter(Boolean))];
      const exp = inv.cab.exportador && inv.cab.exportador.nome;
      tp.fabricantes.forEach(f => {
        if (exp && !mesmoNome(f.nome, exp) && !fabsInv.some(n => mesmoNome(f.nome, n))) A.add('TXT-12', { campo: 'Fabricante/exportador (AG4A)', encontrado: f.nome, esperado: [exp, ...fabsInv].join(' / '), mensagem: `Fabricante/exportador do TXT (${f.nome}) não corresponde à invoice.`, sugestao: `Conferir o fabricante/exportador informado no TXT (${f.nome}).` });
      });
      if (exp && fabsInv.length && fabsInv.every(n => mesmoNome(n, exp))) {
        const vinc = [...new Set(tp.itens.map(i => i.vinculacao).filter(Boolean))];
        if (vinc.some(v => v !== '1')) A.add('TXT-12', { campo: 'Fabricante x exportador (ITEA)', encontrado: `indicador ${vinc.join(', ')}`, esperado: 'indicador 1 (fabricante é o exportador)', mensagem: 'Invoice indica fabricante igual ao exportador, mas o TXT informa outra relação.', sugestao: 'Ajustar no TXT a relação fabricante/exportador (fabricante é o próprio exportador).' });
      }
    }
  }

  /* ---------------- relatório de itens (cabeçalho e totais) ---------------- */
  function regrasRelatorio(x) {
    const { rel, inv, tp, A, proc } = x;
    if (!rel) return;
    (rel.avisos || []).forEach(av => A.add('REL-01', { campo: 'Leitura', encontrado: av, mensagem: av }));
    const c = rel.cab || {}, cnpjProc = digitos(proc.cnpj);
    if (proc.refCliente && c.refCliente && !refContem(c.refCliente, proc.refCliente)) A.add('REL-01', { campo: 'Ref. cliente', encontrado: c.refCliente, esperado: proc.refCliente, mensagem: 'Referência do cliente no relatório difere do processo.', sugestao: 'Corrigir a referência do cliente no relatório de itens.' });
    if (proc.refAgil && c.refAgil && alnum(c.refAgil) !== alnum(proc.refAgil)) A.add('REL-01', { campo: 'Ref. Ágil', encontrado: c.refAgil, esperado: proc.refAgil, mensagem: 'Referência Ágil do relatório difere do processo.', sugestao: 'Conferir a referência Ágil do relatório de itens.' });
    if (cnpjProc && c.cnpj && c.cnpj !== cnpjProc) A.add('REL-01', { severidade: 'bloqueante', campo: 'CNPJ', encontrado: fmtCnpj(c.cnpj), esperado: fmtCnpj(cnpjProc), mensagem: 'CNPJ do relatório difere do importador.', sugestao: 'Corrigir o importador do relatório de itens.' });
    if (inv) {
      if (c.incoterm && inv.cab.incoterm && norm(c.incoterm) !== inv.cab.incoterm) A.add('REL-01', { campo: 'Incoterm', encontrado: c.incoterm, esperado: inv.cab.incoterm, mensagem: 'Incoterm do relatório difere da invoice.', sugestao: 'Corrigir o incoterm no relatório de itens.' });
      if (c.moedaISO && inv.cab.moeda && c.moedaISO !== inv.cab.moeda) A.add('REL-01', { campo: 'Moeda negociada', encontrado: c.moeda, esperado: inv.cab.moeda, mensagem: 'Moeda do relatório difere da invoice.', sugestao: 'Corrigir a moeda negociada no relatório de itens.' });
      if (c.pesoBruto != null && inv.totais && inv.totais.pesoBruto != null && !iguais(c.pesoBruto, inv.totais.pesoBruto, 2)) A.add('REL-01', { campo: 'Peso bruto', encontrado: kg(c.pesoBruto), esperado: kg(inv.totais.pesoBruto), mensagem: 'Peso bruto do relatório difere da invoice.', sugestao: 'Corrigir o peso bruto no relatório de itens.' });
      const liqRef = tp ? soma(tp.itens, 'pesoLiq') : (inv.totais ? inv.totais.pesoLiq : null);
      if (c.pesoLiq != null && liqRef != null && !iguais(c.pesoLiq, liqRef, 2)) A.add('REL-01', { campo: 'Peso líquido', encontrado: kg(c.pesoLiq), esperado: `${kg(liqRef)}${tp ? ' (TXT)' : ' (invoice)'}`, mensagem: 'Peso líquido do cabeçalho do relatório difere da referência.', sugestao: 'Corrigir o peso líquido no relatório de itens.' });
    }
    const t = rel.totais;
    if (t && inv && inv.totais) {
      if (t.totalMoeda != null && inv.totais.total != null && !iguais(t.totalMoeda, inv.totais.total, 2)) A.add('REL-05', { campo: 'Valor total', encontrado: fmt(t.totalMoeda), esperado: fmt(inv.totais.total), mensagem: 'Valor total do relatório difere da invoice.', sugestao: 'Corrigir o valor total no relatório de itens.' });
      if (t.qtd != null && inv.totais.qtd != null && !iguais(t.qtd, inv.totais.qtd, 5)) A.add('REL-05', { campo: 'Quantidade total', encontrado: fmtAuto(t.qtd), esperado: fmtAuto(inv.totais.qtd), mensagem: 'Quantidade total do relatório difere da invoice.', sugestao: 'Corrigir a quantidade total no relatório de itens.' });
    }
    if (t && tp && tp.cap2) {
      const c2 = tp.cap2, mF = moedaISO(c2.moedaFrete), fTxt = (c2.fretePrepaid || 0) + (c2.freteCollect || 0);
      if (t.freteMoeda != null && mF && mF === c.moedaISO && !iguais(t.freteMoeda, fTxt, 2)) A.add('REL-05', { campo: 'Frete', encontrado: dinheiro(c.moedaISO, t.freteMoeda), esperado: `${dinheiro(mF, fTxt)} (TXT)`, mensagem: 'Frete do relatório difere do TXT.', sugestao: 'Corrigir o frete no relatório de itens/numerário.' });
      if (c2.valorSeguro && t.seguroMoeda != null && c.taxaMoeda) {
        const mS = moedaISO(c2.moedaSeguro);
        let segConv = null;
        if (mS === c.moedaISO) segConv = c2.valorSeguro;
        else if (mS === 'USD' && c.taxaUsd) segConv = c2.valorSeguro * c.taxaUsd / c.taxaMoeda;
        else if (mS === 'BRL') segConv = c2.valorSeguro / c.taxaMoeda;
        if (segConv != null && !iguais(segConv, t.seguroMoeda, 2)) A.add('REL-05', { campo: 'Seguro', encontrado: `${dinheiro(c.moedaISO, t.seguroMoeda)}${c.taxaUsd && c.taxaMoeda ? ` (≈ USD ${fmt(t.seguroMoeda * c.taxaMoeda / c.taxaUsd)})` : ''}`, esperado: `${dinheiro(mS, c2.valorSeguro)} (TXT)`, mensagem: `Seguro do relatório (${dinheiro(c.moedaISO, t.seguroMoeda)}) difere do TXT (${dinheiro(mS, c2.valorSeguro)}).`, sugestao: 'Conferir o seguro considerado no relatório de itens/numerário.' });
      }
    }
  }

  /* ---------------- conciliação item a item ---------------- */
  function agregar(lista, chaveFn) {
    const m = new Map();
    lista.forEach(i => { const k = chaveFn(i); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
    return m;
  }
  function conciliarItens(x) {
    const { inv, pkl, tp, rel, cat, A, f3 } = x;
    const mapa = new Map();
    const pega = cod => { const k = normCod(cod); if (!mapa.has(k)) mapa.set(k, { codigo: String(cod).trim(), chave: k, inv: null, pkl: null, txt: null, rel: null, cat: null }); return mapa.get(k); };
    if (inv) agregar(inv.itens, i => normCod(i.codigo || ('#' + (i.seq != null ? i.seq : i.linha)))).forEach(l => {
      const o = pega(l[0].codigo || ('#' + (l[0].seq != null ? l[0].seq : l[0].linha)));
      o.inv = { linhas: l, seqs: l.map(i => i.seq), ncms: [...new Set(l.map(i => i.ncm).filter(Boolean))], qtd: soma(l, 'qtd'), precos: [...new Set(l.map(i => arred(i.preco, 6)).filter(v => v != null))], total: soma(l, 'total'), pesoLiq: soma(l, 'pesoLiq'), pesoBruto: soma(l, 'pesoBruto'), unidade: l[0].unidade, po: l.map(i => i.po).join(', '), fabricante: l[0].fabricante, fabPais: l[0].fabPais, descricao: l[0].descricao };
      if (pkl) {
        const pi = pkl.itens.filter(p => l.some(i => i.seq != null && p.seq === i.seq));
        if (pi.length) o.pkl = { qtd: soma(pi, 'qtd'), pesoLiq: soma(pi, 'pesoLiq'), pesoBruto: soma(pi, 'pesoBruto'), ncms: [...new Set(pi.map(p => p.ncm).filter(Boolean))] };
      }
    });
    if (tp) agregar(tp.itens, i => normCod(i.codigo)).forEach(l => {
      const o = pega(l[0].codigo);
      o.txt = { linhas: l, seqs: l.map(i => i.seq), ncms: [...new Set(l.map(i => i.ncm).filter(Boolean))], qtd: soma(l, 'qtd'), precos: [...new Set(l.map(i => arred(i.precoUnit, 6)).filter(v => v != null))], valor: soma(l, 'valor'), pesoLiq: soma(l, 'pesoLiq'), unidades: [...new Set(l.map(i => i.unidade).filter(Boolean))], pos: [...new Set(l.map(i => i.po).filter(Boolean))], descricoes: [...new Set(l.map(i => i.descricao))], descricao: l[0].descricao, origens: [...new Set(l.map(i => i.paisOrigem).filter(Boolean))], fabricantes: [...new Set(l.map(i => i.codFabricante).filter(Boolean))], aliqII: l[0].aliqII };
    });
    if (rel) agregar(rel.itens, i => normCod(i.codigo)).forEach(l => {
      const o = pega(l[0].codigo);
      o.rel = { linhas: l, adicoes: [...new Set(l.map(i => i.adicao))], ncms: [...new Set(l.map(i => i.ncm).filter(Boolean))], qtd: soma(l, 'qtd'), precos: [...new Set(l.map(i => arred(i.unitMoeda, 6)).filter(v => v != null))], total: soma(l, 'totalMoeda'), pesoLiq: soma(l, 'pesoLiq'), unidade: l[0].unidade, descricao: l[0].descricao, fabricante: l[0].fabricante, aliquotas: { II: l[0].aliqII, IPI: l[0].aliqIPI, PIS: l[0].aliqPIS, COFINS: l[0].aliqCOFINS } };
    });
    const itens = [];
    mapa.forEach(o => {
      const cod = o.codigo, ref = cod.startsWith('#') ? `nº ${cod.slice(1)}` : cod;
      const add = (regra, obj) => { const a = A.add(regra, Object.assign({ item: ref }, obj)); return a; };
      // presença
      const fontes = [['invoice', o.inv], ['txt', tp ? o.txt : true], ['relatorio', rel ? o.rel : true]].filter(([, v]) => v !== true);
      const tem = fontes.filter(([, v]) => v).map(([k]) => k), falta = fontes.filter(([, v]) => !v).map(([k]) => k);
      if (falta.length && tem.length) add('ITM-01', { documento: falta[0], campo: 'Item', encontrado: `consta em: ${tem.map(k => DOCS[k]).join(', ')}`, esperado: `também em: ${falta.map(k => DOCS[k]).join(', ')}`, mensagem: `Item ${ref} não consta em ${falta.map(k => DOCS[k]).join(' e ')}.`, sugestao: `Notar que o item ${ref} consta em ${tem.map(k => DOCS[k]).join(', ')}, mas não em ${falta.map(k => DOCS[k]).join(' e ')}.` });
      // catálogo
      if (cat && !cod.startsWith('#')) {
        const q = K.consultarCatalogo(cat, cod);
        const res = p => p ? { codigo: p.codigo, versao: p.versao, ncm: p.ncm, situacao: p.situacao, descricao: p.descricao, denominacao: p.denominacao } : null;
        o.cat = { status: q.status, produto: res(q.produto), ativos: q.ativos.map(res), inativos: q.inativos.map(res) };
        if (q.status === 'nao_encontrado') add('CAT-01', { severidade: f3 ? 'bloqueante' : 'alerta', campo: 'Cadastro', encontrado: 'não cadastrado', esperado: 'produto publicado', mensagem: `Código interno ${ref} não encontrado no catálogo vigente.`, sugestao: `Estamos realizando o cadastro do item ${ref} no Catálogo de Produtos; assim que finalizarmos, notificaremos.`, acao: 'ajuste_catalogo' });
        else if (q.status === 'desativado') add('CAT-02', { severidade: f3 ? 'bloqueante' : 'alerta', campo: 'Situação', encontrado: `desativado (produto ${q.inativos.map(p => p.codigo).join(', ')})`, esperado: 'produto ativo', mensagem: `Código interno ${ref} só tem produto desativado no catálogo.`, sugestao: `Estamos publicando nova versão do item ${ref} no Catálogo de Produtos; assim que finalizarmos, notificaremos.`, acao: 'ajuste_catalogo' });
        else if (q.status === 'multiplos') add('CAT-03', { campo: 'Produtos ativos', encontrado: q.ativos.map(p => `${p.codigo} (NCM ${fmtNcm(p.ncm)})`).join(', '), esperado: 'um produto ativo', mensagem: `Código interno ${ref} tem ${q.ativos.length} produtos ativos no catálogo; a DUIMP pode puxar o produto errado.`, sugestao: `Desativar os produtos duplicados do código ${ref} no catálogo, mantendo um único produto ativo.`, acao: 'ajuste_catalogo' });
        if (q.produto) {
          const dc = K.descricaoSemCodigo(q.produto, cod);
          const ph = D.placeholders(dc);
          if (ph.length) add('CAT-05', { campo: 'Descrição do catálogo', encontrado: ph.join(', '), esperado: 'valores reais na DUIMP', mensagem: `Descrição do produto ${q.produto.codigo} no catálogo tem campos genéricos (${ph.join(', ')}).`, sugestao: `Descrição do item ${ref} no catálogo usa campos genéricos (${ph.join(', ')}): garantir que os valores reais constem na DUIMP.`, acao: 'ajuste_catalogo' });
          if (o.inv && o.inv.descricao) {
            const cmp = D.comparar(o.inv.descricao, dc);
            o.comparacaoFatura = { similaridade: cmp.similaridade, contencao: cmp.contencao, faltamNoCatalogo: cmp.faltamEmB, faltamNaFatura: cmp.faltamEmA, soFatura: cmp.soA, soCatalogo: cmp.soB };
            if (cmp.similaridade < 0.25 && cmp.contencao < 0.5) add('CAT-07', { campo: 'Descrição', encontrado: `semelhança ${Math.round(cmp.similaridade * 100)}%`, esperado: 'mesmo produto do catálogo', mensagem: `Descrição do item ${ref} na invoice não corresponde ao produto ${q.produto.codigo} do catálogo (semelhança ${Math.round(cmp.similaridade * 100)}%).`, sugestao: `A descrição do item ${ref} na invoice não corresponde ao produto cadastrado no Catálogo de Produtos. Gentileza confirmar qual é a mercadoria embarcada e ajustar a descrição.`, acao: 'ajuste_cliente' });
            else {
              const sens = cmp.faltamEmB.filter(t => !/^codigo$/.test(t.tipo) || t.valor.length >= 4);
              if (sens.length) add('CAT-06', { campo: 'Informações da fatura', encontrado: sens.map(t => `${D.NOMES_TIPO[t.tipo]}: ${t.valor}`).join('; '), esperado: 'também no catálogo', mensagem: `Informações da invoice ausentes no catálogo para ${ref}: ${sens.map(t => t.valor).join(', ')}.`, sugestao: `Avaliar a inclusão no catálogo das informações da invoice para o item ${ref}: ${sens.map(t => `${D.NOMES_TIPO[t.tipo]} ${t.valor}`).join('; ')}.`, acao: 'ajuste_catalogo' });
              const inc = cmp.faltamEmA.filter(t => !(t.tipo === 'codigo' && normCod(t.valor) === normCod(cod)));
              if (inc.length) add('CAT-08', { campo: 'Descrição', encontrado: 'incompleta', esperado: inc.map(t => `${D.NOMES_TIPO[t.tipo]}: ${t.valor}`).join('; '), mensagem: `Descrição do item ${ref} na invoice não traz informações do catálogo: ${inc.map(t => t.valor).join(', ')}.`, sugestao: `Gentileza complementar a descrição do item ${ref} na invoice com: ${inc.map(t => `${D.NOMES_TIPO[t.tipo]} ${t.valor}`).join('; ')}.` });
            }
          }
        }
      }
      // NCM: referência por maioria (catálogo desempata)
      const votos = new Map();
      const fontesNcm = [];
      if (o.inv) o.inv.ncms.forEach(n => fontesNcm.push(['invoice', n, 1]));
      if (o.txt) o.txt.ncms.forEach(n => fontesNcm.push(['txt', n, 1]));
      if (o.rel) o.rel.ncms.forEach(n => fontesNcm.push(['relatorio', n, 1]));
      if (o.cat && o.cat.produto) fontesNcm.push(['catalogo', o.cat.produto.ncm, 1.5]);
      fontesNcm.forEach(([, n, w]) => votos.set(n, (votos.get(n) || 0) + w));
      let refN = null, best = -1;
      votos.forEach((v, n) => { if (v > best) { best = v; refN = n; } });
      o.ncmReferencia = refN;
      const docsRef = fontesNcm.filter(f => f[1] === refN).map(f => f[0]);
      const nomesRef = docsRef.map(d => DOCS[d]);
      fontesNcm.filter(f => f[1] !== refN).forEach(([doc, n]) => {
        const txtRef = `${listaPt(docsRef.map(d => COM_ARTIGO[d]))} (${fmtNcm(refN)})`;
        const sug = doc === 'catalogo'
          ? `NCM do item ${ref} no Catálogo de Produtos (${fmtNcm(n)}) diverge dos documentos (${fmtNcm(refN)}). Avaliar atualização do catálogo.`
          : doc === 'relatorio' ? `Relatório de itens/numerário calculado com NCM ${fmtNcm(n)} para o item ${ref}; referência ${txtRef}. Atualizar relatório e numerário.`
            : `Notar que o item ${ref} está com a NCM ${fmtNcm(n)} ${doc === 'txt' ? 'no TXT' : 'na invoice'}, em desconformidade com ${txtRef}. Gentileza verificar.`;
        add('ITM-02', { documento: doc, campo: 'NCM', encontrado: fmtNcm(n), esperado: `${fmtNcm(refN)} (${nomesRef.join(', ')})`, mensagem: `NCM do item ${ref}: ${DOCS[doc]} ${fmtNcm(n)} × ${txtRef}.`, sugestao: sug, acao: doc === 'catalogo' ? 'ajuste_catalogo' : 'ajuste_documento' });
      });
      ['inv', 'txt', 'rel'].forEach(k => { if (o[k] && o[k].ncms.length > 1) add('ITM-02', { documento: k === 'inv' ? 'invoice' : k === 'rel' ? 'relatorio' : 'txt', campo: 'NCM', encontrado: o[k].ncms.map(fmtNcm).join(' / '), esperado: 'uma única NCM por código', mensagem: `Item ${ref} com mais de uma NCM no mesmo documento.`, sugestao: `Item ${ref} aparece com NCMs diferentes (${o[k].ncms.map(fmtNcm).join(' / ')}). Gentileza verificar.` }); });
      // quantidade, preço, valor e peso (cadeia invoice → TXT → relatório)
      if (o.inv && o.txt) {
        if (!iguais(o.inv.qtd, o.txt.qtd, 5)) add('ITM-03', { documento: 'txt', campo: 'Quantidade', encontrado: `${fmtAuto(o.txt.qtd)} (TXT)`, esperado: `${fmtAuto(o.inv.qtd)} (invoice)`, mensagem: `Quantidade do item ${ref}: TXT ${fmtAuto(o.txt.qtd)} × invoice ${fmtAuto(o.inv.qtd)}.`, sugestao: `Notar que a quantidade do item ${ref} no TXT (${fmtAuto(o.txt.qtd)}) difere da invoice (${fmtAuto(o.inv.qtd)}).` });
        const pi = o.inv.precos, pt = o.txt.precos;
        if (pi.length && pt.length && (pt.some(p => !pi.some(q => iguais(p, q, 6))))) add('ITM-04', { documento: 'txt', campo: 'Preço unitário', encontrado: pt.map(p => fmtAuto(p)).join(' / '), esperado: pi.map(p => fmtAuto(p)).join(' / '), mensagem: `Preço unitário do item ${ref}: TXT ${pt.map(p => fmtAuto(p)).join(' / ')} × invoice ${pi.map(p => fmtAuto(p)).join(' / ')}.`, sugestao: `Notar que o preço unitário do item ${ref} no TXT difere da invoice (${pi.map(p => fmtAuto(p)).join(' / ')}).` });
        else if (!iguais(o.inv.total, o.txt.valor, 2)) add('ITM-04', { documento: 'txt', campo: 'Valor do item', encontrado: `${fmt(o.txt.valor)} (TXT)`, esperado: `${fmt(o.inv.total)} (invoice)`, mensagem: `Valor do item ${ref}: TXT ${fmt(o.txt.valor)} × invoice ${fmt(o.inv.total)}.`, sugestao: `Notar que o valor do item ${ref} no TXT (${fmt(o.txt.valor)}) difere da invoice (${fmt(o.inv.total)}).` });
        if (!iguais(o.inv.pesoLiq, o.txt.pesoLiq, 2)) add('ITM-05', { documento: 'txt', campo: 'Peso líquido', encontrado: `${fmt(o.txt.pesoLiq, 4)} kg (TXT)`, esperado: `${kg(o.inv.pesoLiq)} (invoice)`, mensagem: `Peso líquido do item ${ref}: TXT ${fmt(o.txt.pesoLiq, 4)} kg × invoice ${kg(o.inv.pesoLiq)} (dif. ${fmt(Math.abs(o.txt.pesoLiq - o.inv.pesoLiq), 4)} kg).`, sugestao: `Notar que o peso líquido do item ${ref} no TXT (${fmt(o.txt.pesoLiq, 4)} kg) difere da invoice (${kg(o.inv.pesoLiq)}).` });
        const pInv = pos(o.inv.po), pTxt = new Set(o.txt.pos.map(p => p.replace(/^0+/, '')));
        if (pInv.size && pTxt.size && fmtSet(pInv) !== fmtSet(pTxt)) add('ITM-06', { documento: 'txt', campo: 'Pedido (PO)', encontrado: fmtSet(pTxt), esperado: fmtSet(pInv), mensagem: `Pedidos do item ${ref}: TXT ${fmtSet(pTxt)} × invoice ${fmtSet(pInv)}.`, sugestao: `Notar que os pedidos (PO) do item ${ref} no TXT (${fmtSet(pTxt)}) diferem da invoice (${fmtSet(pInv)}).` });
        const ui = unidadeBase(o.inv.unidade), ut = o.txt.unidades.map(unidadeBase);
        if (ui && ut.length && ut.some(u => u !== ui)) add('ITM-07', { documento: 'txt', campo: 'Unidade', encontrado: o.txt.unidades.join(', '), esperado: `${o.inv.unidade} (${ui})`, mensagem: `Unidade do item ${ref}: TXT ${o.txt.unidades.join(', ')} × invoice ${o.inv.unidade}.`, sugestao: `Ajustar a unidade de medida do item ${ref} no TXT conforme invoice (${o.inv.unidade}).` });
        const po = paisCodigo(o.inv.fabPais);
        if (po && o.txt.origens.some(c => c !== po)) add('ITM-10', { campo: 'País de origem', encontrado: o.txt.origens.map(c => `${c} ${paisNome(c)}`).join(', '), esperado: `${po} ${paisNome(po)}`, mensagem: `País de origem do item ${ref} no TXT difere da invoice.`, sugestao: `Ajustar o país de origem do item ${ref} no TXT.` });
        if (o.inv.fabricante && tp && tp.fabricantes.length) {
          const fs = o.txt.fabricantes.map(c => tp.fabricantes.find(f => f.codigo === c)).filter(Boolean);
          if (fs.length && !fs.some(f => mesmoNome(f.nome, o.inv.fabricante))) add('ITM-11', { campo: 'Fabricante', encontrado: fs.map(f => f.nome).join(', '), esperado: o.inv.fabricante, mensagem: `Fabricante do item ${ref} no TXT difere da invoice.`, sugestao: `Ajustar o fabricante do item ${ref} no TXT conforme invoice (${o.inv.fabricante}).` });
        }
      }
      const baseRel = o.txt ? ['TXT', o.txt.qtd, o.txt.valor, o.txt.pesoLiq, o.txt.precos] : o.inv ? ['invoice', o.inv.qtd, o.inv.total, o.inv.pesoLiq, o.inv.precos] : null;
      if (o.rel && baseRel) {
        const [nb, q, v, p, pr] = baseRel;
        if (!iguais(o.rel.qtd, q, 5)) add('ITM-03', { documento: 'relatorio', campo: 'Quantidade', encontrado: fmtAuto(o.rel.qtd), esperado: `${fmtAuto(q)} (${nb})`, mensagem: `Quantidade do item ${ref} no relatório (${fmtAuto(o.rel.qtd)}) difere do ${nb} (${fmtAuto(q)}).`, sugestao: `Corrigir a quantidade do item ${ref} no relatório de itens.` });
        if (pr.length && o.rel.precos.some(a => !pr.some(b => iguais(a, b, 6)))) add('ITM-04', { documento: 'relatorio', campo: 'Preço unitário', encontrado: o.rel.precos.map(a => fmtAuto(a)).join(' / '), esperado: `${pr.map(a => fmtAuto(a)).join(' / ')} (${nb})`, mensagem: `Preço do item ${ref} no relatório difere do ${nb}.`, sugestao: `Corrigir o preço do item ${ref} no relatório de itens.` });
        else if (!iguais(o.rel.total, v, 2)) add('ITM-04', { documento: 'relatorio', campo: 'Valor do item', encontrado: fmt(o.rel.total), esperado: `${fmt(v)} (${nb})`, mensagem: `Valor do item ${ref} no relatório (${fmt(o.rel.total)}) difere do ${nb} (${fmt(v)}).`, sugestao: `Corrigir o valor do item ${ref} no relatório de itens.` });
        if (!iguais(o.rel.pesoLiq, p, o.txt ? 4 : 2)) add('ITM-05', { documento: 'relatorio', campo: 'Peso líquido', encontrado: `${fmt(o.rel.pesoLiq, 4)} kg`, esperado: `${fmt(p, 4)} kg (${nb})`, mensagem: `Peso líquido do item ${ref} no relatório difere do ${nb}.`, sugestao: `Corrigir o peso líquido do item ${ref} no relatório de itens.` });
      }
      if (o.inv && o.pkl && !o.inv.linhas.some(i => i.seq == null)) { /* já conferido em PKL-02 */ }
      // descrições (fase de registro)
      if (o.txt) {
        const ph = D.placeholders(o.txt.descricao);
        if (ph.length) add('ITM-08', { severidade: 'bloqueante', campo: 'Descrição', encontrado: ph.join(', '), esperado: 'valores reais', mensagem: `Descrição do item ${ref} no TXT tem campos sem preenchimento: ${ph.join(', ')}.`, sugestao: `Gentileza complementar a descrição do item ${ref} no TXT: os campos ${ph.join(', ')} estão sem preenchimento.` });
        if (o.txt.descricoes.length > 1) add('ITM-08', { campo: 'Descrição', encontrado: `${o.txt.descricoes.length} descrições diferentes`, esperado: 'uma descrição por código', mensagem: `Item ${ref} com descrições diferentes entre linhas do TXT.`, sugestao: `Uniformizar a descrição do item ${ref} no TXT.` });
        const dc = o.cat && o.cat.produto ? K.descricaoSemCodigo(o.cat.produto, cod) : null;
        const cTI = o.inv ? D.comparar(o.txt.descricao, o.inv.descricao) : null;
        const cTC = dc ? D.comparar(o.txt.descricao, dc) : null;
        const cIC = o.comparacaoFatura;
        o.comparacaoTxt = { comFatura: cTI ? { similaridade: cTI.similaridade, faltamNoTxt: cTI.faltamEmA, faltamNaFatura: cTI.faltamEmB } : null, comCatalogo: cTC ? { similaridade: cTC.similaridade, faltamNoTxt: cTC.faltamEmA, faltamNoCatalogo: cTC.faltamEmB } : null };
        const parecido = c => c && (c.similaridade >= 0.25 || c.contencao >= 0.5);
        if (cTI && !parecido(cTI)) {
          const invForaDoCatalogo = cIC && !(cIC.similaridade >= 0.25 || cIC.contencao >= 0.5);
          if (!(parecido(cTC) && invForaDoCatalogo)) add('ITM-08', { severidade: 'bloqueante', campo: 'Descrição', encontrado: `semelhança com a invoice ${Math.round(cTI.similaridade * 100)}%`, esperado: 'mesma mercadoria da invoice', mensagem: `Descrição do item ${ref} no TXT não corresponde à invoice (semelhança ${Math.round(cTI.similaridade * 100)}%).`, sugestao: `Notar que a descrição do item ${ref} no TXT não corresponde à descrição da invoice. Gentileza verificar.` });
        } else if (cTC && !parecido(cTC)) add('ITM-08', { campo: 'Descrição', encontrado: `semelhança com o catálogo ${Math.round(cTC.similaridade * 100)}%`, esperado: 'produto do catálogo', mensagem: `Descrição do item ${ref} no TXT não corresponde ao catálogo.`, sugestao: `Notar que a descrição do item ${ref} no TXT difere do produto cadastrado no catálogo.` });
        else if (cTI) {
          const sens = cTI.faltamEmA.filter(t => t.tipo !== 'codigo' || t.valor.length >= 4);
          if (sens.length) add('ITM-08', { campo: 'Descrição', encontrado: 'TXT sem: ' + sens.map(t => t.valor).join(', '), esperado: 'informações da invoice', mensagem: `Descrição do item ${ref} no TXT não traz informações da invoice: ${sens.map(t => t.valor).join(', ')}.`, sugestao: `Notar que a descrição do item ${ref} no TXT não traz: ${sens.map(t => `${D.NOMES_TIPO[t.tipo]} ${t.valor}`).join('; ')}.` });
        }
      }
      if (o.rel && o.cat && o.cat.produto) {
        const a = o.rel.descricao, b = o.cat.produto.descricao;
        if (alnum(a) !== alnum(b)) {
          const cmp = D.comparar(a, b);
          add('ITM-09', { severidade: cmp.similaridade >= 0.85 ? 'info' : 'alerta', campo: 'Descrição', encontrado: `semelhança ${Math.round(cmp.similaridade * 100)}%`, esperado: `produto ${o.cat.produto.codigo} v${o.cat.produto.versao}`, mensagem: `Descrição do item ${ref} no relatório difere do catálogo vigente (produto ${o.cat.produto.codigo}).`, sugestao: `Atualizar o relatório de itens: descrição do item ${ref} difere do catálogo vigente.`, acao: cmp.similaridade >= 0.85 ? 'ciente_ok' : 'ajuste_documento' });
        }
        const ph = D.placeholders(a);
        if (ph.length) add('ITM-09', { campo: 'Descrição', encontrado: ph.join(', '), mensagem: `Descrição do item ${ref} no relatório tem campos sem preenchimento (${ph.join(', ')}).`, sugestao: `Garantir os valores reais (${ph.join(', ')}) na descrição do item ${ref} na DUIMP.` });
      }
      itens.push(o);
    });
    return itens;
  }

  /* ---------------- análise ---------------- */
  function analisar(entrada) {
    const fase = entrada.fase === F3 ? F3 : F1;
    const docs = entrada.docs || {};
    const x = {
      fase, f3: fase === F3, proc: entrada.processo || {}, inv: docs.invoice || null, pkl: docs.packing || null, bl: docs.bl || null,
      txt: docs.txt || null, rel: docs.relatorio || null, cat: entrada.catalogo || null, A: coletor(fase, entrada.regrasDesligadas, entrada.severidades)
    };
    x.tp = x.txt && x.txt.processos && x.txt.processos[0] || null;
    regrasProcesso(x);
    regrasFatura(x);
    regrasRomaneio(x);
    regrasTxt(x);
    regrasRelatorio(x);
    x.itens = conciliarItens(x);
    regrasBL(x);
    const ordemDoc = Object.fromEntries(SECOES.map(([k], i) => [k, i]));
    const achados = x.A.lista.sort((a, b) => (ordemDoc[a.documento] - ordemDoc[b.documento]) || (PESO_SEV[b.severidade] - PESO_SEV[a.severidade]) || String(a.item || '').localeCompare(String(b.item || '')));
    const itens = x.itens.map(o => {
      const meus = achados.filter(a => a.item && normCod(a.item) === normCod(o.codigo.startsWith('#') ? `nº ${o.codigo.slice(1)}` : o.codigo));
      const sev = meus.reduce((m, a) => Math.max(m, PESO_SEV[a.severidade]), 0);
      const limpa = v => v && Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'linhas'));
      return { codigo: o.codigo, ncmReferencia: o.ncmReferencia, status: sev === 3 ? 'bloqueante' : sev === 2 ? 'alerta' : sev === 1 ? 'info' : 'ok', invoice: limpa(o.inv), packing: o.pkl, txt: limpa(o.txt), relatorio: limpa(o.rel), catalogo: o.cat, comparacaoFatura: o.comparacaoFatura || null, comparacaoTxt: o.comparacaoTxt || null, achados: meus.map(a => a.id) };
    });
    const cont = s => achados.filter(a => a.severidade === s).length;
    const presentes = Object.entries({ invoice: x.inv, packing: x.pkl, bl: x.bl, txt: x.txt, relatorio: x.rel }).filter(([, v]) => v).map(([k]) => k);
    return {
      versaoMotor: VERSAO_MOTOR, fase, geradoEm: new Date().toISOString(),
      resumo: { bloqueantes: cont('bloqueante'), alertas: cont('alerta'), infos: cont('info'), itens: itens.length, itensComPendencia: itens.filter(i => i.status === 'bloqueante' || i.status === 'alerta').length, documentos: presentes, catalogo: x.cat ? x.cat.meta : null },
      documentos: {
        invoice: x.inv ? { numero: x.inv.cab.numero, data: x.inv.cab.data, incoterm: x.inv.cab.incoterm, moeda: x.inv.cab.moeda, exportador: x.inv.cab.exportador && x.inv.cab.exportador.nome, importador: x.inv.cab.importador && x.inv.cab.importador.nome, ipRef: x.inv.cab.ipRef, totais: x.inv.totais, itens: x.inv.itens.length } : null,
        packing: x.pkl ? { numero: x.pkl.cab.numero, volumes: x.pkl.cab.volumes, cubagem: x.pkl.cab.cubagem, madeira: x.pkl.cab.madeira, totais: x.pkl.totais, itens: x.pkl.itens.length } : null,
        bl: x.bl ? { numero: x.bl.cab.numero, portoEmbarque: x.bl.cab.portoEmbarque, portoDescarga: x.bl.cab.portoDescarga, pesoBruto: x.bl.cab.pesoBruto, volumes: x.bl.cab.volumes, ncms: x.bl.cab.ncms, container: x.bl.cab.container } : null,
        txt: x.tp ? { arquivo: x.txt.arquivo, data: x.txt.itdi && x.txt.itdi.data, usuario: x.txt.itdi && x.txt.itdi.usuario, referencia: x.tp.capi && x.tp.capi.refCliente, house: x.tp.capi && x.tp.capi.house, linhasItem: x.tp.itens.length, codigos: new Set(x.tp.itens.map(i => normCod(i.codigo))).size, frete: x.tp.cap2 ? { moeda: moedaISO(x.tp.cap2.moedaFrete), valor: (x.tp.cap2.fretePrepaid || 0) + (x.tp.cap2.freteCollect || 0) } : null, seguro: x.tp.cap2 && x.tp.cap2.valorSeguro ? { moeda: moedaISO(x.tp.cap2.moedaSeguro), valor: x.tp.cap2.valorSeguro } : null, pesoLiq: soma(x.tp.itens, 'pesoLiq'), pesoBruto: x.tp.capi && x.tp.capi.pesoBruto } : null,
        relatorio: x.rel ? { refAgil: x.rel.cab.refAgil, refCliente: x.rel.cab.refCliente, moeda: x.rel.cab.moeda, taxaMoeda: x.rel.cab.taxaMoeda, taxaUsd: x.rel.cab.taxaUsd, totais: x.rel.totais, linhas: x.rel.itens.length } : null
      },
      achados, itens
    };
  }

  /* ---------------- parecer (texto para e-mail e PDF) ---------------- */
  function montarParecer(analise, ocorrencias, opcoes) {
    const op = Object.assign({ saudacao: 'Bom dia!', intro: 'Segue abaixo análise da documentação em questão:', fechamento: 'Atenciosamente,', extras: {}, documentosAnalisados: (analise.resumo && analise.resumo.documentos) || [] }, opcoes || {});
    const sel = (ocorrencias || []).filter(o => o.incluir_pdf !== false && o.incluirPdf !== false);
    const secoes = [];
    SECOES.forEach(([doc, titulo]) => {
      const linhas = [];
      const vistos = new Set();
      sel.filter(o => (o.documento || o.documento) === doc).forEach(o => { const t = String(o.texto || o.sugestao || o.mensagem || '').trim(); if (t && !vistos.has(t)) { vistos.add(t); linhas.push(t); } });
      (op.extras[doc] || []).filter(Boolean).forEach(t => linhas.push(String(t).trim()));
      const analisado = op.documentosAnalisados.includes(doc) || (doc === 'catalogo' && (analise.resumo || {}).catalogo);
      if (linhas.length) secoes.push({ documento: doc, titulo, itens: linhas });
      else if (analisado && doc !== 'relatorio' && doc !== 'processo') secoes.push({ documento: doc, titulo, itens: [doc === 'catalogo' ? 'Todos os itens estão publicados no Catálogo de Produtos.' : 'Documento em conformidade.'] });
    });
    const fecha = (t, ult) => t.replace(/[;.:\s]+$/, '') + (ult ? '.' : ';');
    const texto = [op.saudacao, '', op.intro, ''].concat(...secoes.map(s => [`# ${s.titulo}`, ...s.itens.map((t, i) => `  •  ${fecha(t, i === s.itens.length - 1)}`), ''])).concat(op.observacoes ? ['Observações:', op.observacoes, ''] : []).concat([op.fechamento]).join('\n');
    return { secoes, texto };
  }

  REGRAS.forEach(r => { r.interna = INTERNAS.has(r.codigo) || r.documento === 'relatorio'; });
  C.regras = { REGRAS, MAPA, DOCS, COM_ARTIGO, SECOES, ACOES, PESO_SEV, VERSAO_MOTOR, analisar, montarParecer, fmtCnpj, incluirPorPadrao, fecha: (t, ult) => String(t).replace(/[;.:\s]+$/, '') + (ult ? '.' : ';') };
  C.analisar = analisar;
})(typeof self !== 'undefined' ? self : this);
