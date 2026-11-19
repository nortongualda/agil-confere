/* Ágil Confere · leitura de páginas escaneadas pela IA (Claude API via função do Supabase).
   Envia a imagem de cada página, recebe a transcrição estruturada e monta "abas"
   num layout de planilha que os leitores de invoice, packing list e BL já conhecem.
   Itens que não fecham na conta (qtd × preço ≠ total) são relidos uma vez. */
(function () {
  const C = window.Confere;
  const FUNCAO = 'confere-leitura';
  let cacheStatus = null, cacheEm = 0;

  function cliente() { return window.AGIL_SB; }
  async function chamar(corpo) {
    const sb = cliente();
    if (!sb) throw new Error('Sem conexão com o servidor.');
    const { data: s } = await sb.auth.getSession();
    const token = s && s.session ? s.session.access_token : '';
    const r = await fetch(`${window.AGIL_CONFIG.url}/functions/v1/${FUNCAO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, apikey: window.AGIL_CONFIG.key },
      body: JSON.stringify(corpo)
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) { throw new Error(`Resposta inválida do servidor (${r.status}).`); }
    if (!r.ok || j.erro) { const e = new Error(j.erro || `Erro ${r.status}`); e.codigo = j.codigo; throw e; }
    return j;
  }
  async function status(forcar) {
    if (!forcar && cacheStatus && Date.now() - cacheEm < 60000) return cacheStatus;
    try { cacheStatus = await chamar({ acao: 'status' }); } catch (e) { cacheStatus = { configurada: false, ativa: false, erro: e.message }; }
    cacheEm = Date.now();
    return cacheStatus;
  }
  const disponivel = st => !!(st && st.configurada && st.ativa && st.gasto < st.limite);

  // imagem no maior tamanho que a IA aproveita sem reduzir (~4.700 blocos de 28 px, lado maior até 2.576 px)
  function imagemDaPagina(cv) {
    const w = cv.width, h = cv.height;
    let s = Math.sqrt(4600 * 784 / (w * h));
    s = Math.min(s, 2576 / Math.max(w, h), 1);
    const o = document.createElement('canvas');
    o.width = Math.round(w * s); o.height = Math.round(h * s);
    const ctx = o.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, o.width, o.height);
    const url = o.toDataURL('image/jpeg', 0.9);
    o.width = o.height = 0;
    return url.slice(url.indexOf(',') + 1);
  }
  const ESTIMATIVA_PAGINA = 0.07; // US$ por página com Sonnet (imagem ~5 mil tokens + resposta ~5 mil)

  async function lerPagina(cvOuImagem, op) {
    const imagem = typeof cvOuImagem === 'string' ? cvOuImagem : imagemDaPagina(cvOuImagem);
    let ultimo;
    for (let t = 0; t < 2; t++) {
      try {
        return await chamar({ imagem, tipo: 'image/jpeg', arquivo: op.arquivo, pagina: op.pagina, dica: op.dica || '', etapa: op.etapa || 'leitura', estimativa: ESTIMATIVA_PAGINA });
      } catch (e) {
        ultimo = e;
        if (e.codigo === 'limite' || e.codigo === 'sem_chave' || e.codigo === 'desligada' || e.codigo === 'api') throw e;
        await new Promise(r => setTimeout(r, 2500));
      }
    }
    throw ultimo;
  }
  // roda tarefas com no máximo n ao mesmo tempo
  async function emParalelo(tarefas, n) {
    const out = new Array(tarefas.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, async () => {
      while (i < tarefas.length) { const k = i++; out[k] = await tarefas[k](); }
    }));
    return out;
  }

  /* ---------- números ---------- */
  const v = x => (x == null ? '' : String(x).trim());
  function numerico(s, formato) {
    const t = v(s).replace(/\s/g, '').replace(/^(USD|US\$|\$|CNY|RMB|EUR|€|KGS?|M3|CBM)/i, '').replace(/(USD|KGS?|M3|CBM|PCS|SETS?)$/i, '');
    if (!/^[-+]?\d[\d.,]*$/.test(t)) return null;
    const n = Number(C.pdfgrade.normalizarNumero(t, formato));
    return isFinite(n) ? n : null;
  }
  const numOuTexto = (s, f) => { const n = numerico(s, f); return n == null ? v(s) : n; };
  function partirVolumes(s, f) {
    const m = /(\d[\d.,]*)\s*([A-Za-z][A-Za-z ()\/]*)?/.exec(v(s));
    return m ? [numerico(m[1], f), v(m[2]).toUpperCase()] : [v(s)];
  }
  function moedaDe(s) {
    const m = /\b(USD|CNY|RMB|EUR|BRL|JPY|GBP|CHF)\b|US\$|€/i.exec(v(s));
    if (!m) return '';
    const x = m[0].toUpperCase();
    return x === 'US$' ? 'USD' : x === '€' ? 'EUR' : x === 'RMB' ? 'CNY' : x;
  }

  /* ---------- junta as páginas em documentos ---------- */
  function documentos(paginas) {
    const docs = [];
    let atual = null;
    paginas.forEach(pg => {
      if (!pg || !pg.dados) return;
      const secoes = (pg.dados.secoes || []).filter(s => s && s.tipo);
      secoes.forEach((s, k) => {
        // página sem cabeçalho próprio (continuação de tabela) segue no documento atual, mesmo que a IA chute outro tipo
        const temCabecalho = s.campos && Object.values(s.campos).some(x => x != null && v(x) !== '');
        const continua = atual && atual.tipo !== 'bl' && s.tipo !== 'bl' && (s.continuacao || !temCabecalho);
        const tipo = continua ? atual.tipo : s.tipo === 'outro' && atual && s.itens && s.itens.length ? atual.tipo : s.tipo;
        const novo = !atual || atual.tipo !== tipo || (!s.continuacao && tipo !== 'bl' && s.campos && s.campos.numero && atual.campos.numero && v(s.campos.numero) !== v(atual.campos.numero));
        if (novo) { atual = { tipo, campos: {}, colunas: [], itens: [], totais: {}, paginas: [], textos: [], duvidas: [] }; docs.push(atual); }
        Object.entries(s.campos || {}).forEach(([c, x]) => {
          if (x == null || v(x) === '') return;
          if (c === 'descricaoMercadoria' && atual.campos[c]) atual.campos[c] += '\n' + v(x);
          else if (atual.campos[c] == null) atual.campos[c] = v(x);
        });
        if ((s.colunas || []).length && !atual.colunas.length) atual.colunas = s.colunas;
        (s.itens || []).forEach(i => atual.itens.push(Object.assign({ _pagina: pg.numero }, i)));
        Object.entries(s.totais || {}).forEach(([c, x]) => { if (x != null && v(x) !== '') atual.totais[c] = x; });
        if (!atual.paginas.includes(pg.numero)) atual.paginas.push(pg.numero);
        if (k === 0) {
          if (pg.dados.texto) atual.textos.push(pg.dados.texto);
          (pg.dados.duvidas || []).forEach(d => atual.duvidas.push(Object.assign({ _pagina: pg.numero }, d)));
        }
      });
    });
    return docs;
  }

  /* ---------- layout de planilha para cada documento ---------- */
  const COLS_ITEM = [
    ['seq', 'NO.'], ['ncm', 'HS CODE'], ['codigo', 'PART NO.'], ['descricao', 'DESCRIPTION'], ['qtd', 'QTY'], ['unidade', 'UNIT'],
    ['preco', 'UNIT PRICE'], ['total', 'AMOUNT'], ['pesoLiq', 'N.W. (KG)'], ['pesoBruto', 'G.W. (KG)'], ['po', 'PO NO.'],
    ['fabricante', 'MANUFACTURER'], ['fabEndereco', "MANUFACTURER'S ADDRESS"], ['fabPais', "MANUFACTURER'S COUNTRY"]
  ];
  const NUMERICOS = ['qtd', 'preco', 'total', 'pesoLiq', 'pesoBruto'];
  function abaComercial(d, nome, formato) {
    const c = d.campos, L = [], confs = [], origem = [];
    const add = (row, cf, o) => { L.push(row); confs.push(cf || []); origem.push(o || null); };
    add([d.tipo === 'invoice' ? 'COMMERCIAL INVOICE' : 'PACKING LIST']);
    [['numero', 'INVOICE NO.:'], ['data', 'DATE:'], ['ipRef', 'IP REF.:'], ['poRef', 'PO REF.:'], ['portoOrigem', 'FROM:'], ['portoDestino', 'TO:'],
      ['incoterm', 'INCOTERMS:'], ['paisOrigem', 'COUNTRY OF ORIGIN:'], ['paisAquisicao', 'COUNTRY OF ACQUISITION:'], ['paisProcedencia', 'COUNTRY OF PROCEDENCE:']]
      .forEach(([k, r]) => { if (c[k] != null) add([r, c[k]]); });
    if (c.exportador) add(['SELLER\n' + c.exportador]);
    if (c.importador) add(['BUYER\n' + c.importador]);
    add([]);
    const moeda = moedaDe(c.moeda) || moedaDe((d.colunas || []).join(' ')) || moedaDe(c.extenso) || moedaDe(c.incoterm);
    const usadas = COLS_ITEM.filter(([k]) => k === 'seq' || k === 'codigo' || k === 'descricao' || k === 'qtd' || d.itens.some(i => v(i[k]) !== ''));
    add(usadas.map(([k, t]) => (k === 'preco' || k === 'total') && moeda ? `${t} (${moeda})` : t));
    const duv = new Map();
    d.duvidas.forEach(x => { const s = v(x.seq); if (s) { const m = duv.get(s) || new Set(); m.add(String(x.campo || '').replace(/^itens?\./, '')); duv.set(s, m); } });
    d.itens.forEach(i => {
      const marc = duv.get(v(i.seq));
      add(usadas.map(([k]) => k === 'seq' ? (numerico(i.seq, formato) ?? v(i.seq)) : NUMERICOS.includes(k) ? (numerico(i[k], formato) ?? v(i[k])) : v(i[k])),
        usadas.map(([k]) => marc && (marc.has(k) || marc.has('*') || marc.has('item')) ? 40 : 99), { pagina: i._pagina, seq: v(i.seq) });
    });
    const T = d.totais || {};
    add(usadas.map(([k], j) => j === 0 ? 'TOTAL' : NUMERICOS.includes(k) && k !== 'preco' && T[k] != null ? numerico(T[k], formato) : ''));
    add([]);
    if (c.pagamento) add(['PAYMENT TERMS:', c.pagamento]);
    if (c.frete) add(['FREIGHT:', numerico((/(\d[\d.,]*)/.exec(c.frete) || [])[1], formato) ?? '', c.frete]);
    if (c.seguro) add(['INSURANCE:', numerico((/(\d[\d.,]*)/.exec(c.seguro) || [])[1], formato) ?? '', c.seguro]);
    if (c.desconto) add(['DISCOUNT:', numerico((/(\d[\d.,]*)/.exec(c.desconto) || [])[1], formato) ?? '', c.desconto]);
    if (c.extenso) add(['SAY TOTAL:', c.extenso]);
    const vol = c.volumes || T.volumes;
    if (vol) add(['TOTAL PACKED IN:'].concat(partirVolumes(vol, formato)));
    if (c.marcas) add(['SHIPPING MARKS:', c.marcas]);
    const cub = c.cubagem || T.cubagem;
    if (cub) add(['MEASUREMENT:', numOuTexto((/(\d[\d.,]*)/.exec(cub) || [])[1] || cub, formato)]);
    if (c.madeira) add(['WOODEN PACKING:', c.madeira]);
    if (c.container) add(['CONTAINER NO.:', c.container]);
    if (c.lacre) add(['SEAL NO.:', c.lacre]);
    const pgs = d.paginas;
    return { nome: `${nome} · ${d.tipo === 'invoice' ? 'invoice' : 'packing list'} · pág. ${pgs[0]}${pgs.length > 1 ? '-' + pgs[pgs.length - 1] : ''}`, titulo: d.tipo, linhas: L, confs, origem, paginas: pgs, formatoNumerico: formato, texto: d.textos.join('\n'), ia: true };
  }
  function abaBL(d, nome, formato) {
    const c = d.campos, L = [];
    L.push(['BILL OF LADING']);
    [['numero', 'BILL OF LADING NO.'], ['shipper', 'SHIPPER'], ['consignee', 'CONSIGNEE'], ['notify', 'NOTIFY PARTY'], ['localRecebimento', 'PLACE OF RECEIPT'],
      ['navio', 'OCEAN VESSEL'], ['portoEmbarque', 'PORT OF LOADING'], ['portoDescarga', 'PORT OF DISCHARGE'], ['destinoFinal', 'PLACE OF DELIVERY'],
      ['transbordo', 'PORT OF TRANSHIPMENT'], ['paisOrigem', 'COUNTRY OF ORIGIN'], ['agente', 'FORWARDING AGENT']]
      .forEach(([k, r]) => { if (c[k] != null) L.push([r + '\n' + c[k]]); });
    L.push([]);
    L.push(['MARKS AND NUMBERS', 'NO. OF PKGS', 'DESCRIPTION OF GOODS', 'GROSS WEIGHT (KG)', 'MEASUREMENT (CBM)']);
    // cláusulas fora do quadro de descrição (frete, free time, madeira, lacre) entram na descrição se faltarem
    let desc = v(c.descricaoMercadoria);
    const nd = desc.toUpperCase();
    d.textos.join('\n').split(/\r?\n/).forEach(l => {
      const u = l.toUpperCase();
      if (/FREIGHT|FREE\s*TIME|WOOD|SEAL|INCOTERM|\bNCM\b|\bIPH?\s*[:：]/.test(u) && !nd.includes(u.trim())) desc += '\n' + l.trim();
    });
    const pb = c.pesoBruto || (d.totais || {}).pesoBruto;
    const cub = c.cubagem || (d.totais || {}).cubagem;
    L.push([v(c.marcas), v(c.volumes || (d.totais || {}).volumes), desc, pb ? numOuTexto((/(\d[\d.,]*)/.exec(pb) || [])[1] || pb, formato) : '', cub ? numOuTexto((/(\d[\d.,]*)/.exec(cub) || [])[1] || cub, formato) : '']);
    L.push([]);
    L.push(['', '', '', '', '', '', d.textos.join('\n')]);
    const pgs = d.paginas;
    return { nome: `${nome} · BL · pág. ${pgs[0]}${pgs.length > 1 ? '-' + pgs[pgs.length - 1] : ''}`, titulo: 'bl', linhas: L, confs: [], paginas: pgs, formatoNumerico: formato, texto: d.textos.join('\n'), ia: true, campos: c };
  }
  function montarAbas(paginas, nome) {
    const docs = documentos(paginas);
    const amostra = [];
    docs.forEach(d => { d.itens.forEach(i => NUMERICOS.forEach(k => { if (i[k] != null) amostra.push(v(i[k])); })); Object.values(d.totais || {}).forEach(x => amostra.push(v(x))); ['pesoBruto', 'cubagem', 'frete', 'seguro'].forEach(k => { const m = /\d[\d.,]*\d/.exec(v(d.campos[k])); if (m) amostra.push(m[0]); }); });
    const formato = C.pdfgrade.formatoNumerico(amostra);
    return docs.filter(d => d.tipo !== 'outro' || d.itens.length).map(d => d.tipo === 'bl' ? abaBL(d, nome, formato) : abaComercial(d.tipo === 'outro' ? Object.assign(d, { tipo: 'invoice' }) : d, nome, formato));
  }

  /* ---------- conferência: o que não fecha é relido ---------- */
  // o que reler: contas que não fecham, valores que faltaram e itens pulados (buraco na numeração)
  function suspeitos(paginas, nome) {
    const out = new Map(); // página -> { seqs: [], completa: bool, faltam: [] }
    const marca = (pg, seq, completa, falta) => { if (pg == null) return; if (!out.has(pg)) out.set(pg, { seqs: [], completa: false, faltam: [] }); const o = out.get(pg); if (seq != null && !o.seqs.includes(seq)) o.seqs.push(seq); if (completa) o.completa = true; if (falta != null && !o.faltam.includes(falta)) o.faltam.push(falta); };
    montarAbas(paginas, nome).filter(a => a.titulo !== 'bl').forEach(a => {
      const com = C.lerDocumentosComerciais([a]);
      const d = com.invoice || com.packing;
      if (!d) return;
      const tem = k => d.itens.some(i => i[k] != null);
      const exige = (d.tipo === 'invoice' ? ['qtd', 'preco', 'total'] : ['qtd']).concat(['pesoLiq', 'pesoBruto']).filter(tem);
      d.itens.forEach(i => {
        const o = a.origem[i.linha - 1];
        if (!o || !o.seq) return;
        const ruim = (i.qtd != null && i.preco != null && i.total != null && Math.abs(i.qtd * i.preco - i.total) > Math.max(0.011, Math.abs(i.total) * 0.0005)) ||
          (i.pesoLiq != null && i.pesoBruto != null && i.pesoLiq > i.pesoBruto) || exige.some(k => i[k] == null);
        if (ruim) marca(o.pagina, o.seq);
      });
      // numeração 1, 2, 3...: o que falta entre duas linhas lidas foi pulado
      const lidos = a.origem.filter(Boolean).map(o => ({ n: Number(o.seq), pg: o.pagina })).filter(o => Number.isInteger(o.n));
      for (let k = 1; k < lidos.length; k++) {
        const ant = lidos[k - 1], at = lidos[k];
        if (at.n - ant.n > 1 && at.n - ant.n < 200) for (let f = ant.n + 1; f < at.n; f++) { marca(ant.pg, null, true, f); if (at.pg !== ant.pg) marca(at.pg, null, true, f); }
      }
    });
    return out;
  }
  function dicaReleitura(s) {
    if (s.completa) return `RELEITURA COMPLETA. Na primeira leitura desta página faltaram itens${s.faltam.length ? ` (números ${faixa(s.faltam)})` : ''}. Transcreva TODOS os itens da página, sem pular nenhum, conferindo dígito por dígito quantidade, preço unitário, valor total e pesos. Copie o que está impresso, mesmo que a conta do documento não feche.`;
    return `RELEITURA. Transcreva SOMENTE os itens de número ${s.seqs.join(', ')} desta página, preenchendo todas as colunas que existem na tabela (inclusive valor total e pesos) e conferindo dígito por dígito. Copie o que está impresso, mesmo que a conta do documento não feche.`;
  }
  const faixa = l => { const n = l.map(Number).sort((a, b) => a - b); return n.length > 2 && n[n.length - 1] - n[0] === n.length - 1 ? `${n[0]} a ${n[n.length - 1]}` : n.join(', '); };
  // aplica a releitura: troca só os itens relidos (mesmo seq) da página
  function aplicarReleitura(pg, rel) {
    const novos = new Map();
    ((rel && rel.secoes) || []).forEach(s => (s.itens || []).forEach(i => { if (v(i.seq)) novos.set(v(i.seq), i); }));
    let trocas = 0;
    const secs = (pg.dados.secoes || []).filter(s => s.tipo !== 'bl');
    const vistos = new Set();
    secs.forEach(s => (s.itens || []).forEach((i, k) => {
      const n = novos.get(v(i.seq));
      if (!n) return;
      vistos.add(v(i.seq));
      const mudou = NUMERICOS.some(c => v(n[c]) !== v(i[c]) && v(n[c]) !== '');
      if (mudou) { s.itens[k] = Object.assign({}, i, Object.fromEntries(Object.entries(n).filter(([, x]) => x != null && v(x) !== ''))); trocas++; }
    }));
    // itens que só a releitura trouxe: entram na ordem da numeração
    const alvo = secs.find(s => (s.itens || []).length) || secs[0];
    if (alvo) {
      novos.forEach((i, sq) => {
        if (vistos.has(sq)) return;
        const n = Number(sq), pos = alvo.itens.findIndex(x => Number(x.seq) > n);
        if (pos < 0) alvo.itens.push(i); else alvo.itens.splice(pos, 0, i);
        trocas++;
      });
    }
    (rel.duvidas || []).forEach(d => pg.dados.duvidas.push(d));
    return trocas;
  }

  window.ConfereIA = { status, disponivel, lerPagina, emParalelo, montarAbas, suspeitos, dicaReleitura, aplicarReleitura, documentos, ESTIMATIVA_PAGINA, _interno: { numerico, imagemDaPagina } };
})();
