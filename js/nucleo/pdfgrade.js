/* Ágil Confere · grade a partir de PDF (texto ou OCR).
   Recebe, por página, as palavras com posição (em pontos, y para baixo) e as linhas
   de tabela desenhadas na página (réguas), e devolve "abas" no mesmo formato das
   planilhas, para os leitores do núcleo (invoice, packing list, BL).
   Não depende de tela nem de rede: roda no navegador e no Node (testes). */
(function (raiz) {
  'use strict';
  const C = (typeof module === 'object' && module.exports) ? Object.assign(module.exports, require('./base.js')) : raiz.Confere;
  const { norm, num } = C.util;
  const { classifica } = C.colunas;

  const mediana = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const RE_NUM = /^[(\-+]?[$€¥£]?\d[\d.,]*\)?%?$/;
  const ehNumero = t => RE_NUM.test(String(t).trim()) && num(t) != null;
  const minConf = (a, b) => a == null ? b : b == null ? a : Math.min(a, b);

  /* ---------- títulos de documento ---------- */
  const TITULOS = [
    ['invoice', /^(COMMERCIAL\s+|CUSTOMS\s+|FINAL\s+)?INVOICE(\s*(&|AND|\/)\s*PACKING\s*LIST)?$|^PRO\s*-?\s*FORMA\s+INVOICE$|^FATURA(\s+COMERCIAL)?$|^FACTURA(\s+COMERCIAL)?$/],
    ['packing', /^PACKING\s*LIST$|^PACKING\s*(LIST\s*)?(&|AND|\/)\s*WEIGHT\s*LIST$|^ROMANEIO(\s+DE\s+CARGA)?$|^LISTA\s+DE\s+EMPAQUE$/],
    ['bl', /^(HOUSE\s+|MASTER\s+|OCEAN\s+|MULTIMODAL\s+)?BILL\s+OF\s+LADING\b|^(HOUSE\s+)?B\/L$|^(SEA\s+)?WAYBILL$|^CONHECIMENTO\s+DE\s+(EMBARQUE|TRANSPORTE)/]
  ];
  function tituloDe(texto) {
    const t = norm(texto).replace(/[:.]+$/, '').trim();
    if (!t || t.length > 70) return null;
    for (const [k, re] of TITULOS) if (re.test(t)) return k;
    return null;
  }

  /* ---------- rótulos de bloco (endereços) e de campo ---------- */
  const RE_BLOCO = /^(EXPORTER|SELLER|SHIPPER|VENDEDOR|EXPORTADOR|BENEFICIARY|IMPORTER|BUYER|CONSIGNEE|IMPORTADOR|COMPRADOR|SOLD\s+TO|BILL\s+TO|NOTIFY(\s+PARTY)?|NOTIFICAR|MESSRS\.?)(?![A-Z])/;
  const RE_CAMPO = /^(INVOICE|DATE|DATA|P\.?\s?O\.?\s*(NO|REF|NUMBER)|ORDER\s+NO|REF(ERENCE)?(?![A-Z])|IP\s*REF|CONTRACT|PAYMENT|TERMS|FROM|TO(?![A-Z])|PORT\s+OF|VESSEL|VOYAGE|INCOTERMS?|COUNTRY\s+OF|MARKS|DESCRIPTION|PLACE\s+OF|BILL\s+OF|B\/L|FINAL\s+DESTINATION|NO\.?\s*OF|FREIGHT|CARRIER|SHIPPER'?S)/;
  const RE_PAGINA = /^(PAGE|PAG(INA)?\.?|P\.)\s*\d+\s*(OF|DE|\/)\s*\d+$|^\d+\s*\/\s*\d+$|^-\s*\d+\s*-$/;

  /* ---------- 1. palavras ---------- */
  function prepararTokens(pg) {
    const out = [];
    for (const t of pg.tokens || []) {
      const txt = String(t.t == null ? '' : t.t).replace(/[  - ]/g, ' ');
      if (!txt.trim()) continue;
      const w = t.x1 - t.x0;
      if (!(w > 0) || !(t.y1 > t.y0)) continue;
      const cw = w / txt.length;
      const re = /\S+(?: \S+)*/g; let m;
      while ((m = re.exec(txt))) out.push({ t: m[0], x0: t.x0 + m.index * cw, x1: t.x0 + (m.index + m[0].length) * cw, y0: t.y0, y1: t.y1, conf: t.conf == null ? null : t.conf });
    }
    out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const res = [];
    for (const t of out) if (!res.slice(-8).some(u => u.t === t.t && Math.abs(u.x0 - t.x0) < 1.5 && Math.abs(u.y0 - t.y0) < 1.5)) res.push(t);
    return res;
  }

  /* ---------- 2. linhas de texto ---------- */
  function agruparLinhas(toks) {
    const ts = toks.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const L = [];
    for (const t of ts) {
      const h = t.y1 - t.y0, yc = (t.y0 + t.y1) / 2;
      let alvo = null;
      for (let k = L.length - 1; k >= Math.max(0, L.length - 3); k--) {
        const l = L[k];
        const ov = Math.min(t.y1, l.c1) - Math.max(t.y0, l.c0);
        if (ov >= 0.5 * Math.min(h, l.h) && Math.abs(yc - l.yc) <= 0.5 * Math.max(h, l.h)) { alvo = l; break; }
      }
      if (alvo) {
        alvo.toks.push(t);
        alvo.y0 = Math.min(alvo.y0, t.y0); alvo.y1 = Math.max(alvo.y1, t.y1);
        alvo.hs.push(h); alvo.ycs.push(yc);
        alvo.h = mediana(alvo.hs); alvo.yc = mediana(alvo.ycs); alvo.c0 = alvo.yc - alvo.h / 2; alvo.c1 = alvo.yc + alvo.h / 2;
      } else L.push({ toks: [t], y0: t.y0, y1: t.y1, yc, h, hs: [h], ycs: [yc], c0: t.y0, c1: t.y1 });
    }
    L.forEach(l => l.toks.sort((a, b) => a.x0 - b.x0));
    return L.sort((a, b) => a.yc - b.yc);
  }

  /* ---------- 3. réguas ---------- */
  const temReguaV = (V, xa, xb, y0, y1) => (V || []).some(v => v.x > xa && v.x < xb && v.y0 <= y1 - 0.2 * (y1 - y0) && v.y1 >= y0 + 0.2 * (y1 - y0));
  const temReguaH = (H, ya, yb, x0, x1) => (H || []).some(h => h.y > ya && h.y < yb && Math.min(h.x1, x1) - Math.max(h.x0, x0) > 0.5 * Math.min(x1 - x0, h.x1 - h.x0));

  /* ---------- 4. pedaços de linha (células fora de tabela) ---------- */
  function junta(a, b, gap, h) {
    if (!a) return b;
    if (/-$/.test(a) && /^[A-Za-z0-9]/.test(b) && gap < 0.2 * h) return a + b;
    return a + (gap > 0.12 * h ? ' ' : '') + b;
  }
  function pedacos(l, V) {
    const out = [];
    let cur = null;
    for (const t of l.toks) {
      if (cur) {
        const gap = t.x0 - cur.x1;
        const cw = Math.max((t.x1 - t.x0) / Math.max(1, t.t.length), (cur.toks[cur.toks.length - 1].x1 - cur.toks[cur.toks.length - 1].x0) / Math.max(1, cur.toks[cur.toks.length - 1].t.length));
        if (gap <= Math.max(1.2, 0.6 * l.h, 1.4 * cw) && !temReguaV(V, cur.x1 - 0.6, t.x0 + 0.6, l.c0, l.c1)) {
          cur.t = junta(cur.t, t.t, gap, l.h); cur.x1 = Math.max(cur.x1, t.x1); cur.toks.push(t); cur.conf = minConf(cur.conf, t.conf);
          continue;
        }
      }
      cur = { t: t.t, x0: t.x0, x1: t.x1, toks: [t], conf: t.conf };
      out.push(cur);
    }
    return out;
  }
  // "RÓTULO: valor" num mesmo pedaço vira duas células
  function dividirRotulos(chs) {
    const out = [];
    for (const c of chs) {
      const m = /^([A-Za-zÀ-ú][^:：]{0,44}?)\s*[:：]\s+(\S.*)$/s.exec(c.t);
      if (!m || c.bloco || m[1].split(/\s+/).length > 6 || /^(HTTPS?|WWW)$/i.test(m[1])) { out.push(c); continue; }
      const k = c.toks.findIndex(t => /[:：]$/.test(t.t));
      if (k >= 0 && k < c.toks.length - 1) {
        const a = c.toks.slice(0, k + 1), b = c.toks.slice(k + 1);
        out.push({ t: m[1].trim() + ':', x0: a[0].x0, x1: a[a.length - 1].x1, toks: a, conf: c.conf });
        out.push({ t: m[2].trim(), x0: b[0].x0, x1: c.x1, toks: b, conf: c.conf });
      } else {
        const cw = (c.x1 - c.x0) / Math.max(1, c.t.length);
        const i2 = c.t.length - m[2].length;
        out.push({ t: m[1].trim() + ':', x0: c.x0, x1: c.x0 + (m[1].length + 1) * cw, toks: c.toks, conf: c.conf });
        out.push({ t: m[2].trim(), x0: c.x0 + i2 * cw, x1: c.x1, toks: c.toks, conf: c.conf });
      }
    }
    return out;
  }

  /* ---------- 5. cabeçalho de tabela ---------- */
  const APROX = [
    ['descricao', /DESCR|PRODU[CT]|GOODS|MERCAD|COMMOD/, 'DESCRIPTION'], ['pesoBruto', /GRO[S5]{1,2}|BRUT/, 'GROSS WEIGHT'], ['pesoLiq', /\bNET\b|N\.W\b|LIQ/, 'NET WEIGHT'],
    ['preco', /PRI[CG]E|PRE[CÇ]O/, 'PRICE'], ['qtd', /^.?[QO0]\W?T[YV]|QUANT|QTDE/, 'QTY'], ['total', /AMOUNT|TOTA[LI]/, 'TOTAL'], ['codigo', /\bCODE\b|PART\s*N/, 'PART NO']
  ];
  // pedaço de cabeçalho com dois títulos colados ("QTY UNIT PRICE") vira dois
  function separarTitulos(chs) {
    const out = [];
    chs.forEach(c => {
      if (c.toks.length < 2) { out.push(c); return; }
      let melhor = null;
      for (let k = 1; k < c.toks.length; k++) {
        const a = c.toks.slice(0, k), b = c.toks.slice(k);
        const ta = a.map(t => t.t).join(' '), tb = b.map(t => t.t).join(' ');
        const ka = classifica(ta), kb = classifica(tb);
        if (ka && kb && ka !== kb) { const gap = b[0].x0 - a[a.length - 1].x1; if (!melhor || gap > melhor.gap) melhor = { a, b, ta, tb, gap }; }
      }
      if (!melhor || classifica(c.t) && melhor.gap < 0.45 * (c.toks[0].y1 - c.toks[0].y0)) { out.push(c); return; }
      const mk = (ts, t) => ({ t, x0: ts[0].x0, x1: ts[ts.length - 1].x1, toks: ts, conf: ts.reduce((m, x) => minConf(m, x.conf), null) });
      out.push(...separarTitulos([mk(melhor.a, melhor.ta)]), ...separarTitulos([mk(melhor.b, melhor.tb)]));
    });
    return out;
  }
  function colunasDoGrupo(linhas, V) {
    let cols = [];
    linhas.forEach((l, i) => {
      const chs = separarTitulos(pedacos(l, V));
      if (i === 0) { cols = chs.map(c => ({ x0: c.x0, x1: c.x1, partes: [c.t], toks: c.toks.slice() })); return; }
      const novos = [];
      chs.forEach(c => {
        const sob = cols.filter(k => Math.min(k.x1, c.x1) - Math.max(k.x0, c.x0) > -0.3 * l.h);
        if (!sob.length) { novos.push({ x0: c.x0, x1: c.x1, partes: [c.t], toks: c.toks.slice() }); return; }
        // pedaço sobre várias colunas (título de grupo): fica com a de maior sobreposição
        const k = sob.sort((a, b) => (Math.min(b.x1, c.x1) - Math.max(b.x0, c.x0)) - (Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)))[0];
        k.partes.push(c.t); k.toks.push(...c.toks);
        if (sob.length === 1) { k.x0 = Math.min(k.x0, c.x0); k.x1 = Math.max(k.x1, c.x1); }
      });
      cols = cols.concat(novos).sort((a, b) => a.x0 - b.x0);
    });
    cols.forEach(k => {
      k.texto = k.partes.join(' ').replace(/\s+/g, ' ').trim(); k.chave = classifica(k.texto); k.conf = k.toks.reduce((m, t) => minConf(m, t.conf), null);
      if (!k.chave) { // título mal lido (OCR): reconhece por pedaço da palavra e grava o nome padrão
        const n = norm(k.texto);
        const f = APROX.find(([, re]) => re.test(n));
        if (f && n.length <= 40) { k.texto = f[2] + ' [' + k.texto + ']'; k.chave = classifica(k.texto); }
      }
    });
    // coluna sem título reconhecido colada a uma reconhecida ("PRODUCT" + "DESCRIPTION")
    const h = mediana(linhas.map(l => l.h)) || 8;
    for (let k = 0; k < cols.length; k++) {
      const a = cols[k];
      if (a.chave) continue;
      const viz = [cols[k - 1], cols[k + 1]].filter(Boolean).filter(b => b.chave && Math.max(b.x0 - a.x1, a.x0 - b.x1) < 1.0 * h && !temReguaV(V, Math.min(a.x1, b.x1) - 0.5, Math.max(a.x0, b.x0) + 0.5, linhas[0].y0, linhas[linhas.length - 1].y1));
      for (const b of viz) {
        const t = b.x0 < a.x0 ? b.texto + ' ' + a.texto : a.texto + ' ' + b.texto;
        if (classifica(t) === b.chave) { b.texto = t; b.x0 = Math.min(a.x0, b.x0); b.x1 = Math.max(a.x1, b.x1); b.toks.push(...a.toks); cols.splice(k, 1); k--; break; }
      }
    }
    return cols;
  }
  const linhaDeDados = l => l.toks.filter(t => ehNumero(t.t) && /[.,]\d/.test(t.t)).length >= 2;
  function acharCabecalhoTabela(L, V, H) {
    let melhor = null;
    for (let i = 0; i < L.length; i++) {
      const grupo = [];
      for (let n = 0; n < 4 && i + n < L.length; n++) {
        const l = L[i + n];
        if (n > 0) {
          const ant = L[i + n - 1];
          if (l.y0 - ant.y1 > 0.9 * Math.max(l.h, ant.h)) break;
          if (temReguaH(H, ant.y1 - 0.3, l.y0 + 0.3, Math.min(ant.toks[0].x0, l.toks[0].x0), Math.max(ant.toks[ant.toks.length - 1].x1, l.toks[l.toks.length - 1].x1))) break;
        }
        if (linhaDeDados(l)) break;
        grupo.push(l);
        const cols = colunasDoGrupo(grupo, V);
        const chaves = new Set(cols.map(c => c.chave).filter(Boolean));
        const textos = cols.map(c => norm(c.texto));
        let tipo = null;
        if (chaves.has('qtd') && (chaves.has('descricao') || chaves.has('codigo'))) tipo = 'itens';
        else if (textos.some(t => /^MARKS/.test(t)) && textos.some(t => /GROSS\s*(WEIGHT|WT)|PESO\s*BRUTO/.test(t))) tipo = 'bl';
        if (!tipo) continue;
        const pont = tipo === 'itens' ? chaves.size * 10 + n : 30 + n;
        if (!melhor || pont > melhor.pont) melhor = { i, n: n + 1, cols, tipo, pont, y0: grupo[0].y0, y1: grupo[grupo.length - 1].y1 };
      }
      if (melhor && i > melhor.i + 3) break;
    }
    return melhor;
  }

  /* ---------- 6. limites de coluna ---------- */
  function limitesColunas(cols, dadosToks, V, y0, y1) {
    const lim = [];
    for (let j = 0; j < cols.length - 1; j++) {
      const a = cols[j], b = cols[j + 1];
      const ia = Math.min(a.x1, b.x0), ib = Math.max(a.x1, b.x0);
      const vr = (V || []).filter(v => v.x >= ia - 1.5 && v.x <= ib + 1.5 && v.y0 <= y1 && v.y1 >= y0);
      if (vr.length) { lim.push(mediana(vr.map(v => v.x))); continue; }
      if (ib - ia < 0.5) { lim.push((a.x1 + b.x0) / 2); continue; }
      // calha: faixa sem palavras entre as duas colunas
      const passo = 0.5, n = Math.ceil((ib - ia) / passo) + 1;
      const cob = new Array(n).fill(0);
      dadosToks.forEach(t => {
        if (t.x1 < ia || t.x0 > ib) return;
        const s = Math.max(0, Math.floor((t.x0 - ia) / passo)), e = Math.min(n - 1, Math.ceil((t.x1 - ia) / passo));
        for (let k = s; k <= e; k++) cob[k]++;
      });
      let best = null, k = 0;
      while (k < n) {
        if (cob[k] === 0) { let e = k; while (e + 1 < n && cob[e + 1] === 0) e++; if (!best || e - k > best[1] - best[0]) best = [k, e]; k = e + 1; } else k++;
      }
      if (best) lim.push(ia + ((best[0] + best[1]) / 2) * passo);
      else { let mi = 0; cob.forEach((v, q) => { if (v < cob[mi]) mi = q; }); lim.push(ia + mi * passo); }
    }
    return lim;
  }
  const colunaDe = (lim, x) => { let j = 0; while (j < lim.length && x >= lim[j]) j++; return j; };
  function porColuna(toks, lim) {
    const m = new Map();
    toks.forEach(t => { const j = colunaDe(lim, (t.x0 + t.x1) / 2); if (!m.has(j)) m.set(j, []); m.get(j).push(t); });
    return m;
  }

  /* ---------- 7. linhas lógicas da tabela ---------- */
  const RE_FIM = /^(REMARKS?|OBS(ERVA[CÇ][AÃ]O|ERVA[CÇ][OÕ]ES|ERVATIONS?)?:?|PAYMENT|TERMS\s+OF|SAY\s|SAY$|TOTAL\s+AMOUNT\s+IN|AMOUNT\s+IN\s+WORDS|BANK|BENEFICIARY|SHIP(PING|MENT)\s+MARKS?|TOTAL\s+PACKED|PACKED\s+IN|WOOD(EN)?\s+PACK|DECLARATION|WE\s+(HEREBY|CERTIFY|DECLARE)|AUTHORI[SZ]ED|SIGNATURE|CONTAINER\s*(NO|NUMBER)|SEAL\s*NO)/;
  const RE_TOTAL = /^(TOTAL|SUB-?\s?TOTAL|GRAND\s+TOTAL|TOTAIS|TOTAL\s+GERAL|SUMA|TOTALES)(?![A-Z])/;
  const COLS_NUM = ['qtd', 'preco', 'total', 'pesoLiq', 'pesoBruto', 'seq'];
  function ehAncora(l, tab) {
    const pc = porColuna(l.toks, tab.lim);
    let hits = 0, qtd = false;
    pc.forEach((ts, j) => { const ch = tab.cols[j] && tab.cols[j].chave; if (COLS_NUM.includes(ch) && ts.some(t => ehNumero(t.t))) { hits++; if (ch === 'qtd') qtd = true; } });
    return { pc, ancora: qtd || hits >= 2 };
  }
  function linhasLogicas(dados, tab, H) {
    const info = dados.map(l => { const a = ehAncora(l, tab); return { l, porCol: a.pc, ancora: tab.tipo === 'itens' ? a.ancora : true }; });
    if (tab.tipo !== 'itens') return info.map(x => [x]);
    // réguas horizontais atravessando a tabela: cada faixa é uma linha lógica
    const larg = tab.cols[tab.cols.length - 1].x1 - tab.cols[0].x0;
    const hs = (H || []).filter(h => h.x1 - h.x0 >= 0.6 * larg && h.y > tab.y1 - 1).map(h => h.y).sort((a, b) => a - b);
    if (hs.length >= 2) {
      const faixas = new Map();
      info.forEach(x => { let k = 0; while (k < hs.length && hs[k] < x.l.yc) k++; if (!faixas.has(k)) faixas.set(k, []); faixas.get(k).push(x); });
      const grupos = [...faixas.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
      if (grupos.length > 1 && grupos.every(g => g.filter(x => x.ancora).length <= 1)) return grupos;
    }
    const anc = info.map((x, i) => x.ancora ? i : -1).filter(i => i >= 0);
    if (!anc.length) return [];
    const grupos = anc.map(i => [info[i]]);
    const altura = mediana(dados.map(l => l.h)) || 8;
    const passos = []; for (let i = 1; i < info.length; i++) passos.push(info[i].l.yc - info[i - 1].l.yc);
    const passo = mediana(passos.filter(p => p < 3 * altura)) || altura * 1.2;
    const antes = anc[0] > 0, depois = anc[anc.length - 1] < info.length - 1;
    const modo = antes && depois ? 'meio' : antes ? 'baixo' : 'topo';
    for (let i = anc[0] - 1; i >= 0; i--) grupos[0].unshift(info[i]);
    for (let g = 0; g < anc.length; g++) {
      const a = anc[g], b = g + 1 < anc.length ? anc[g + 1] : info.length;
      const meio = []; for (let i = a + 1; i < b; i++) meio.push(i);
      if (!meio.length) continue;
      if (g + 1 >= anc.length) { meio.forEach(i => grupos[g].push(info[i])); continue; }
      // o maior vão vertical decide o corte; sem vão claro, vale o alinhamento da tabela
      const seq = [a].concat(meio, [b]);
      const vaos = []; for (let k = 1; k < seq.length; k++) vaos.push(info[seq[k]].l.y0 - info[seq[k - 1]].l.y1);
      let corte = 0; vaos.forEach((v, k) => { if (v > vaos[corte]) corte = k; });
      const tipico = mediana(vaos);
      let nCima;
      if (vaos[corte] > Math.max(1.6 * tipico, tipico + 0.35 * passo)) nCima = corte;
      else if (modo === 'topo') nCima = meio.length;
      else if (modo === 'baixo') nCima = 0;
      else nCima = meio.filter(i => info[i].l.yc - info[a].l.yc <= info[b].l.yc - info[i].l.yc).length;
      meio.forEach((i, k) => (k < nCima ? grupos[g] : grupos[g + 1]).push(info[i]));
      grupos[g + 1].sort((x, y) => x.l.yc - y.l.yc);
    }
    return grupos;
  }
  function celulasDoGrupo(grupo) {
    const cel = new Map();
    grupo.forEach(x => x.porCol.forEach((ts, j) => {
      const c = cel.get(j) || { partes: [], conf: null };
      let s = '', fim = null;
      ts.forEach(t => { s = fim == null ? t.t : junta(s, t.t, t.x0 - fim, x.l.h); fim = t.x1; c.conf = minConf(c.conf, t.conf); });
      c.partes.push(s);
      cel.set(j, c);
    }));
    const out = [];
    cel.forEach((c, j) => {
      let texto = '';
      c.partes.forEach(p => { texto = !texto ? p : (/[A-Za-z0-9]-$/.test(texto) && /^[A-Za-z0-9]/.test(p) ? texto + p : texto + ' ' + p); });
      out.push({ j, t: texto.trim(), conf: c.conf });
    });
    return out.sort((a, b) => a.j - b.j);
  }

  /* ---------- 8. blocos de endereço (EXPORTER, CONSIGNEE...) ---------- */
  function juntarBlocos(L, chunks, H) {
    const usado = new Set();
    const passo = mediana(L.slice(1).map((l, i) => l.yc - L[i].yc).filter(v => v > 0 && v < 40)) || 10;
    L.forEach((l, i) => {
      chunks[i].forEach(c => {
        if (usado.has(c) || c.consumido) return;
        let rotulo, primeira = '', ancoras = [c.x0];
        const semNum = t => norm(t).replace(/^\d{1,2}[A-Z]?\s*[.,)]\s*/, '');
        const mc = /^([^:：]{2,48})[:：]\s*(.*)$/s.exec(c.t);
        if (mc && RE_BLOCO.test(semNum(mc[1]))) {
          rotulo = mc[1].trim(); primeira = mc[2].trim();
          const k = c.toks.findIndex(t => /[:：]$/.test(t.t));
          if (primeira && k >= 0 && k + 1 < c.toks.length) ancoras.push(c.toks[k + 1].x0);
        } else {
          const n = semNum(c.t), m = RE_BLOCO.exec(n);
          if (!m || n.slice(m[0].length).replace(/^\s*(\([^)]*\)|[\/&][A-Z .]+)\s*$/, '').trim()) return;
          rotulo = c.t.trim();
        }
        if (!primeira) {
          const viz = chunks[i].find(d => d !== c && d.x0 > c.x1 && d.x0 - c.x1 < 60 && !usado.has(d) && !d.consumido && !RE_BLOCO.test(norm(d.t)) && !RE_CAMPO.test(norm(d.t)));
          if (viz) { primeira = viz.t; ancoras.push(viz.x0); usado.add(viz); viz.consumido = true; }
        }
        const corpo = primeira ? [primeira] : [];
        let ult = l;
        for (let k = i + 1; k < L.length && k <= i + 12; k++) {
          const lk = L[k];
          if (lk.y0 - ult.y1 > 1.25 * passo) break;
          if (temReguaH(H, ult.y1 - 0.5, lk.y0 + 0.5, c.x0, c.x0 + 80)) break;
          const d = chunks[k].find(x => !usado.has(x) && !x.consumido && (ancoras.some(a => Math.abs(x.x0 - a) <= 3.5) || (!corpo.length && ((x.x0 > c.x0 && x.x0 - c.x0 <= 30) || (x.x0 < c.x0 && x.x1 > c.x0 + 2 && c.x0 - x.x0 <= 80)))));
          if (d && !corpo.length && !ancoras.some(a => Math.abs(d.x0 - a) <= 3.5)) ancoras.push(d.x0);
          if (!d) break;
          const nd = norm(d.t);
          if (RE_BLOCO.test(nd) || /^\d{1,2}[A-Z]?\s*[.)]\s*[A-Z]/.test(nd) || (RE_CAMPO.test(nd) && /[:：]/.test(d.t)) || tituloDe(d.t)) break;
          corpo.push(d.t); usado.add(d); d.consumido = true; ult = lk;
        }
        if (corpo.length) { c.t = rotulo + '\n' + corpo.join('\n'); c.bloco = true; usado.add(c); }
      });
    });
  }

  const RE_CAIXA = /^(PORT\s+OF\s+(LOADING|DISCHARGE|TRANSHIPMENT)|PLACE\s+OF\s+(RECEIPT|DELIVERY)|FINAL\s+DESTINATION|(OCEAN\s+)?VESSEL|EXPORT\s+CARRIER|DOCUMENT\s+NO|B\/L\s+(NO|NUMBER)|BILL\s+OF\s+LADING\s+NO|DOCUMENT\s+NUMBER|COUNTRY\s+OF\s+ORIGIN)\b/;
  function juntarCaixas(L, chunks) {
    L.forEach((l, i) => chunks[i].forEach(c => {
      if (c.consumido || c.bloco) return;
      const n = norm(c.t).replace(/^\d{1,2}[A-Z]?\s*[.,)]\s*/, '').replace(/[:：]\s*$/, '');
      if (!RE_CAIXA.test(n) || n.length > 45) return;
      let d = null;
      for (let k = i + 1; k <= i + 2 && k < L.length && !d; k++) {
        if (L[k].y0 - l.y1 > 2.8 * Math.max(l.h, L[k].h)) break;
        d = chunks[k].find(x => !x.consumido && x.x0 >= c.x0 - 4 && x.x0 <= c.x0 + 40 && /[A-Za-z0-9]{3}/.test(x.t) && !/[:：]\s*$/.test(x.t) && !RE_CAMPO.test(norm(x.t)) && !RE_CAIXA.test(norm(x.t).replace(/^\d{1,2}[A-Z]?\s*[.,)]\s*/, '')));
      }
      if (!d) return;
      c.t = c.t.replace(/[:：]\s*$/, '') + '\n' + d.t; c.bloco = true; d.consumido = true;
    }));
  }

  /* ---------- 9. números ---------- */
  function formatoNumerico(textos) {
    let us = 0, eu = 0;
    textos.forEach(t => {
      const s = String(t);
      if (/\d,\d{3}\.\d{1,4}(?!\d)/.test(s) || /^-?\d{1,3}\.\d{1,2}$/.test(s) || /^-?\d{4,}\.\d{1,2}$/.test(s)) us++;
      if (/\d\.\d{3},\d{1,4}(?!\d)/.test(s) || /^-?\d{1,3},\d{1,2}$/.test(s) || /^-?\d{4,},\d{1,2}$/.test(s)) eu++;
    });
    return eu > us ? 'eu' : 'us';
  }
  // "1.234,56" ou "1,234.56" vira "1234.56", conforme o formato do documento; o resto fica como está
  function normalizarNumero(s, formato) {
    const t = String(s).trim();
    if (!/^[-+]?\d[\d.,]*$/.test(t) || !/[.,]/.test(t)) return s;
    const dec = formato === 'eu' ? ',' : '.', mil = formato === 'eu' ? '.' : ',';
    const sinal = /^[-+]/.test(t) ? t[0] : '', u = t.replace(/^[-+]/, '');
    if (u.includes('.') && u.includes(',')) {
      const ul = Math.max(u.lastIndexOf(','), u.lastIndexOf('.'));
      const ok = /^\d{1,3}(,\d{3})*\.\d+$/.test(u) || /^\d{1,3}(\.\d{3})*,\d+$/.test(u);
      return ok || ul > 0 ? sinal + u.slice(0, ul).replace(/[.,]/g, '') + '.' + u.slice(ul + 1) : s;
    }
    const sep = u.includes('.') ? '.' : ',', p = u.split(sep);
    if (p.length > 2) return /^\d{1,3}$/.test(p[0]) && p.slice(1).every(x => /^\d{3}$/.test(x)) ? sinal + p.join('') : s;
    if (p[1].length !== 3 || sep === dec || p[0] === '0' || p[0].length > 3) return sep === mil && p[1].length === 3 && p[0] !== '0' && p[0].length <= 3 ? sinal + p.join('') : sinal + p[0] + '.' + p[1];
    return sinal + p.join('');
  }

  /* ---------- 10. montagem ---------- */
  function montar(paginas, opcoes) {
    const op = Object.assign({ nome: 'PDF' }, opcoes || {});
    const pags = paginas.map((pg, ip) => {
      const toks = prepararTokens(pg);
      const L = agruparLinhas(toks);
      const alt = pg.altura || 842;
      L.forEach(l => { const tx = norm(l.toks.map(t => t.t).join(' ')); l.margem = RE_PAGINA.test(tx); l.rodape = l.y0 > alt * 0.95; });
      let titulo = null;
      for (const l of L) {
        if (l.y0 > alt * 0.5) break;
        for (const c of pedacos(l, pg.v)) { const n = norm(c.t); const t = tituloDe(c.t) || (/\bBILL\s+OF\s+LADING\b(?!\s*(NO|NUMBER))/.test(n) ? 'bl' : /\bPACKING\s+LIST\b/.test(n) && n.length < 40 ? 'packing' : /\b(COMMERCIAL\s+)?INVOICE$/.test(n) && n.length < 40 ? 'invoice' : null); if (t) { titulo = t; break; } }
        if (titulo) break;
      }
      // página sem título: o tipo da tabela diz se é invoice (tem preço) ou packing list (só pesos)
      let tipoTabela = null;
      if (!titulo) {
        const cab = acharCabecalhoTabela(L, pg.v, pg.h);
        if (cab && cab.tipo === 'itens') { const ks = new Set(cab.cols.map(c => c.chave)); tipoTabela = ks.has('preco') || ks.has('total') ? 'invoice' : (ks.has('pesoLiq') || ks.has('pesoBruto')) ? 'packing' : null; }
      }
      return { pg, ip, toks, L, titulo, tipoTabela };
    });
    const segs = [];
    pags.forEach(p => {
      const ult = segs[segs.length - 1];
      if (ult && !p.titulo && p.tipoTabela && ult.titulo && ult.titulo !== 'bl' && p.tipoTabela !== ult.titulo) segs.push({ titulo: p.tipoTabela, pags: [p] });
      else if (!ult || (p.titulo && ult.titulo && p.titulo !== ult.titulo)) segs.push({ titulo: p.titulo, pags: [p] });
      else { ult.pags.push(p); if (!ult.titulo) ult.titulo = p.titulo; }
    });
    const abas = segs.map(sg => montarSegmento(sg, op));
    return { abas, segmentos: segs.map(s => ({ titulo: s.titulo, paginas: s.pags.map(p => p.ip + 1) })) };
  }

  function montarSegmento(sg, op) {
    const formato = formatoNumerico(sg.pags.flatMap(p => p.toks.map(t => t.t)));
    const saida = [];
    let offset = 0, tab = null;
    const textos = [];
    sg.pags.forEach(p => {
      const { L, pg } = p;
      const V = pg.v || [], H = pg.h || [];
      const usadas = new Set();
      L.forEach((l, i) => { if (l.margem) usadas.add(i); });
      const Lc = L.filter(l => !l.margem);
      const iOrig = l => L.indexOf(l);
      const novo = acharCabecalhoTabela(Lc, V, H);
      let inicio = -1;
      if (novo) {
        // cabeçalho repetido na página seguinte: herda os títulos lidos antes (OCR pode ler pior)
        if (tab && tab.continua && tab.tipo === novo.tipo) novo.cols.forEach(c => {
          const ant = tab.cols.map(a => [a, Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0)]).filter(([, o]) => o > 0).sort((x, y) => y[1] - x[1])[0];
          if (ant && ant[0].chave && (!c.chave || c.chave !== ant[0].chave) && c.texto.length <= ant[0].texto.length + 4) { c.chave = ant[0].chave; c.texto = ant[0].texto; }
        });
        tab = { tipo: novo.tipo, cols: novo.cols, y1: novo.y1, lim: null };
        inicio = novo.i + novo.n;
        for (let k = novo.i; k < inicio; k++) usadas.add(iOrig(Lc[k]));
        tab.linhaCab = { y: offset + novo.y0, cel: novo.cols.map(c => ({ x: c.x0, t: c.texto, conf: c.conf, col: c })) };
        saida.push(tab.linhaCab);
      } else if (tab && tab.continua && tab.lim) {
        inicio = Lc.findIndex(l => tab.tipo === 'itens' ? ehAncora(l, tab).ancora : l.toks.length > 0);
        if (inicio >= 0 && tab.tipo === 'itens') {
          const x0 = tab.cols[0].x0 - 25, x1 = tab.cols[tab.cols.length - 1].x1 + 25;
          while (inicio > 0) {
            const a = Lc[inicio - 1], b = Lc[inicio];
            if (b.y0 - a.y1 > 0.9 * Math.max(a.h, b.h) || a.toks.some(t => t.x0 < x0 || t.x1 > x1) || tituloDe(a.toks.map(t => t.t).join(' '))) break;
            inicio--;
          }
        }
        if (inicio >= 0) tab.y1 = Lc[inicio].y0 - 1;
      }
      if (tab && inicio >= 0) {
        const dados = [];
        let fim = inicio, total = null, terminou = false;
        const xMin = tab.cols[0].x0 - 25, xMax = tab.cols[tab.cols.length - 1].x1 + 25;
        const jDesc = tab.cols.findIndex(c => c.chave === 'descricao');
        const naDescricao = c => jDesc >= 0 && (c.x0 + c.x1) / 2 >= tab.cols[jDesc].x0 - 2 && (jDesc + 1 >= tab.cols.length || (c.x0 + c.x1) / 2 < tab.cols[jDesc + 1].x0);
        const numEmColunaNum = l => l.toks.some(t => ehNumero(t.t) && tab.cols.some(c => COLS_NUM.includes(c.chave) && c.chave !== 'seq' && (t.x0 + t.x1) / 2 >= c.x0 - 18 && (t.x0 + t.x1) / 2 <= c.x1 + 18));
        for (let k = inicio; k < Lc.length; k++) {
          const l = Lc[k];
          if (l.rodape) continue;
          const chs = pedacos(l, V);
          const prim = chs[0] ? norm(chs[0].t) : '';
          if (chs.some(c => tituloDe(c.t))) { terminou = true; break; }
          if (tab.tipo === 'itens' && RE_TOTAL.test(prim) && numEmColunaNum(l)) { total = k; fim = k + 1; terminou = true; break; }
          if (tab.tipo === 'itens' && RE_FIM.test(prim) && !naDescricao(chs[0])) { terminou = true; break; }
          if (l.toks.filter(t => t.x1 < xMin || t.x0 > xMax).length > l.toks.length / 2) { terminou = true; break; }
          if (dados.length && l.y0 - dados[dados.length - 1].y1 > 5 * Math.max(l.h, 6)) { terminou = true; break; }
          dados.push(l); fim = k + 1;
        }
        if (!tab.lim || novo) tab.lim = limitesColunas(tab.cols, dados.flatMap(l => l.toks), V, tab.y1, dados.length ? dados[dados.length - 1].y1 : tab.y1 + 1);
        if (novo && tab.tipo === 'itens' && dados.length >= 2) {
          const ks = () => new Set(tab.cols.map(c => c.chave));
          const numerica = j => dados.filter(l => l.toks.some(t => colunaDe(tab.lim, (t.x0 + t.x1) / 2) === j && ehNumero(t.t))).length >= 0.6 * dados.filter(l => ehAncora(l, tab).ancora).length;
          const nomes = { pesoBruto: 'GROSS WEIGHT', pesoLiq: 'NET WEIGHT', total: 'TOTAL', preco: 'PRICE' };
          const inferir = (j, k) => { const c = tab.cols[j]; if (c && !c.chave && !ks().has(k) && numerica(j)) { c.chave = k; c.texto = nomes[k] + ' [' + c.texto + ']'; } };
          tab.cols.forEach((c, j) => {
            const esq = tab.cols[j - 1] && tab.cols[j - 1].chave, dir = tab.cols[j + 1] && tab.cols[j + 1].chave;
            if (c.chave) return;
            if (esq === 'pesoLiq') inferir(j, 'pesoBruto');
            else if (dir === 'pesoBruto') inferir(j, 'pesoLiq');
            else if (esq === 'pesoBruto' || (esq === 'preco' && !ks().has('total'))) inferir(j, 'total');
            else if (dir === 'pesoLiq' || (dir === 'total' && esq === 'unidade')) inferir(j, 'preco');
          });
          if (tab.linhaCab) tab.linhaCab.cel.forEach(x => { if (x.col) x.t = x.col.texto; });
        }
        linhasLogicas(dados, tab, H).forEach(g => {
          saida.push({ y: offset + g[0].l.y0, cel: celulasDoGrupo(g).map(c => ({ x: tab.cols[c.j].x0, t: c.t, conf: c.conf })) });
        });
        if (total != null) {
          const l = Lc[total], ts = l.toks;
          const colNum = t => { const c = tab.cols[colunaDe(tab.lim, (t.x0 + t.x1) / 2)]; return c && COLS_NUM.includes(c.chave) && c.chave !== 'seq'; };
          const k0 = ts.findIndex(t => ehNumero(t.t) && (colNum(t) || numEmColunaNum({ toks: [t] })));
          const rot = (k0 < 0 ? ts : ts.slice(0, k0));
          const cel = [{ x: tab.cols[colunaDe(tab.lim, (rot[0].x0 + rot[0].x1) / 2)].x0, t: rot.map(t => t.t).join(' '), conf: rot.reduce((m, t) => minConf(m, t.conf), null) }];
          if (k0 >= 0) celulasDoGrupo([{ l, porCol: porColuna(ts.slice(k0), tab.lim) }]).forEach(c => cel.push({ x: tab.cols[c.j].x0, t: c.t, conf: c.conf }));
          saida.push({ y: offset + l.y0, cel });
        }
        for (let k = inicio; k < fim; k++) if (!Lc[k].rodape) usadas.add(iOrig(Lc[k]));
        tab.continua = !terminou;
        if (terminou) tab = null;
      }
      // demais linhas: pedaços, blocos de endereço e rótulos
      const Lr = L.filter((l, i) => !usadas.has(i));
      const chunks = Lr.map(l => pedacos(l, V));
      juntarBlocos(Lr, chunks, H);
      juntarCaixas(Lr, chunks);
      Lr.forEach((l, k) => {
        const finais = [];
        chunks[k].filter(c => !c.consumido).forEach(c => { if (c.bloco) finais.push(c); else dividirRotulos([c]).forEach(d => finais.push(d)); });
        if (finais.length) saida.push({ y: offset + l.y0, cel: finais.map(c => ({ x: c.x0, t: c.t, conf: c.conf })) });
      });
      L.forEach(l => textos.push(l.toks.map(t => t.t).join(' ')));
      offset += (pg.altura || 842) + 20;
    });
    saida.sort((a, b) => a.y - b.y);
    // colunas globais por posição x (sem encadear)
    const chave = x => Math.round(x * 100) / 100;
    const xs = [...new Set(saida.flatMap(r => r.cel.map(c => chave(c.x))))].sort((a, b) => a - b);
    const grupos = [];
    xs.forEach(x => { const g = grupos[grupos.length - 1]; if (g && x - g.base <= 2.5) g.vals.push(x); else grupos.push({ base: x, vals: [x] }); });
    const indice = new Map();
    grupos.forEach((g, i) => g.vals.forEach(v => indice.set(v, i * 2)));
    const linhas = [], confs = [];
    saida.forEach(r => {
      const row = [], cf = [];
      r.cel.slice().sort((a, b) => a.x - b.x).forEach(c => {
        let j = indice.get(chave(c.x));
        while (row[j] != null && row[j] !== '') j++;
        row[j] = /^[-+]?\d[\d.,]*$/.test(c.t) ? normalizarNumero(c.t, formato) : c.t;
        cf[j] = c.conf == null ? null : Math.round(c.conf);
      });
      for (let j = 0; j < row.length; j++) if (row[j] == null) row[j] = '';
      linhas.push(row); confs.push(cf);
    });
    const pgs = sg.pags.map(p => p.ip + 1);
    const nomeTipo = { invoice: 'invoice', packing: 'packing list', bl: 'BL' }[sg.titulo] || 'documento';
    return { nome: `${op.nome} · ${nomeTipo} · pág. ${pgs[0]}${pgs.length > 1 ? '-' + pgs[pgs.length - 1] : ''}`, titulo: sg.titulo, linhas, confs, paginas: pgs, formatoNumerico: formato, texto: textos.join('\n') };
  }

  C.pdfgrade = { montar, prepararTokens, agruparLinhas, pedacos, dividirRotulos, acharCabecalhoTabela, limitesColunas, tituloDe, formatoNumerico, normalizarNumero, ehNumero };
})(typeof self !== 'undefined' ? self : this);
