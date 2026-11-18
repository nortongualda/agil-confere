/* Ágil Confere · núcleo de leitura (sem tela, sem rede).
   Lê o TXT do TOTVS (layout SIGAEIC despachante), as planilhas do exportador
   (invoice, packing list, draft de BL), o relatório de itens do Sigraweb e o
   catálogo de produtos exportado do Portal Único.
   Roda no navegador (window.Confere) e no Node (testes). */
(function (raiz) {
  'use strict';
  const C = (typeof module === 'object' && module.exports) ? module.exports : (raiz.Confere = raiz.Confere || {});

  /* ============================== utilidades ============================== */
  const semAc = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => semAc(s).toUpperCase().replace(/[ \s]+/g, ' ').trim();
  const normCod = s => norm(s).replace(/\s+/g, '');
  const alnum = s => norm(s).replace(/[^A-Z0-9]/g, '');
  const vazio = v => v == null || (typeof v === 'string' && !v.trim());
  const cel = v => v == null ? '' : (typeof v === 'string' ? v : (typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v)));

  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'boolean') return null;
    let s = String(v).replace(/[^\d,.\-]/g, '');
    if (!s || s === '-' || !/\d/.test(s)) return null;
    if (s.includes(',') && s.includes('.')) {
      const ul = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
      s = s.slice(0, ul).replace(/[.,]/g, '') + '.' + s.slice(ul + 1);
    } else if (s.includes(',')) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
    } else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  function arred(v, c) {
    if (v == null || !isFinite(v)) return null;
    const f = Math.pow(10, c);
    return Math.round(v * f + (v >= 0 ? 1e-7 : -1e-7)) / f;
  }
  function iguais(a, b, casas) {
    if (a == null || b == null) return a == null && b == null;
    return arred(a, casas) === arred(b, casas);
  }
  function fmt(v, c = 2) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
  }
  function fmtAuto(v, max = 6) {
    if (v == null || !isFinite(v)) return '—';
    const r = arred(v, max);
    const dec = (String(r).split('.')[1] || '').length;
    return fmt(r, Math.max(Math.min(dec, max), Number.isInteger(r) ? 0 : 2));
  }
  const ncmLimpa = s => String(s == null ? '' : s).replace(/\D/g, '');
  function fmtNcm(s) {
    const d = ncmLimpa(s);
    return d.length === 8 ? d.slice(0, 4) + '.' + d.slice(4, 6) + '.' + d.slice(6) : (d || '—');
  }
  function dataISO(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
    if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    const MES = { JAN: 1, FEB: 2, FEV: 2, MAR: 3, APR: 4, ABR: 4, MAY: 5, MAI: 5, JUN: 6, JUL: 7, AUG: 8, AGO: 8, SEP: 9, SET: 9, OCT: 10, OUT: 10, NOV: 11, DEC: 12, DEZ: 12 };
    const t = norm(s);
    m = /^([A-Z]{3})[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
    if (m && MES[m[1]]) return `${m[3]}-${String(MES[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = /^(\d{1,2})[\s-]+([A-Z]{3})[A-Z]*\.?[\s-]+(\d{4})$/.exec(t);
    if (m && MES[m[2]]) return `${m[3]}-${String(MES[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }
  function dataDDMMAA(s) {
    const d = String(s || '').trim();
    if (!/^\d{6}$/.test(d) || d === '000000') return null;
    return `20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  }
  const fmtData = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  function hashTexto(s) {
    let h = 0x811c9dc5;
    const t = String(s == null ? '' : s);
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  function decodificar(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return t.replace(/^﻿/, '');
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  const MOEDAS = {
    USD: { cod: '220', nomes: ['USD', 'US$', 'US DOLLAR', 'DOLAR', 'DOLLAR', 'DOLAR DOS EUA', 'DOLAR NORTE AMERICANO', 'DOLAR DOS ESTADOS UNIDOS'] },
    EUR: { cod: '978', nomes: ['EUR', 'EURO', 'EUROS', '€'] },
    CNY: { cod: '795', nomes: ['CNY', 'RMB', 'YUAN', 'IUAN', 'RENMINBI', 'RENMIMBI', 'IUAN RENMIMBI', 'IUAN RENMINBI', 'YUAN RENMINBI', 'CHINESE YUAN'] },
    BRL: { cod: '790', nomes: ['BRL', 'R$', 'REAL', 'REAIS'] },
    JPY: { cod: '470', nomes: ['JPY', 'IENE', 'YEN'] },
    GBP: { cod: '540', nomes: ['GBP', 'LIBRA', 'LIBRA ESTERLINA', 'POUND'] },
    CHF: { cod: '425', nomes: ['CHF', 'FRANCO SUICO', 'SWISS FRANC'] }
  };
  function moedaISO(v) {
    const t = norm(v);
    if (!t) return null;
    for (const [iso, m] of Object.entries(MOEDAS)) {
      if (t === m.cod || t.replace(/^0+/, '') === m.cod) return iso;
      if (m.nomes.some(n => t === n)) return iso;
    }
    for (const [iso, m] of Object.entries(MOEDAS)) if (m.nomes.some(n => n.length > 3 && t.includes(n))) return iso;
    const x = /\b(USD|EUR|CNY|RMB|BRL|JPY|GBP|CHF)\b/.exec(t);
    return x ? (x[1] === 'RMB' ? 'CNY' : x[1]) : null;
  }
  const PAISES = {
    '160': ['CHINA', 'P R CHINA', 'PR CHINA', 'PRC', 'P.R. CHINA', 'REPUBLICA POPULAR DA CHINA', 'PEOPLES REPUBLIC OF CHINA', 'PEOPLE S REPUBLIC OF CHINA'],
    '249': ['ESTADOS UNIDOS', 'EUA', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'],
    '023': ['ALEMANHA', 'GERMANY', 'DEUTSCHLAND'],
    '399': ['JAPAO', 'JAPAN'],
    '190': ['COREIA DO SUL', 'SOUTH KOREA', 'KOREA', 'REPUBLIC OF KOREA'],
    '161': ['TAIWAN', 'FORMOSA'],
    '351': ['HONG KONG'],
    '361': ['INDIA'],
    '386': ['ITALIA', 'ITALY'],
    '275': ['FRANCA', 'FRANCE'],
    '245': ['ESPANHA', 'SPAIN'],
    '628': ['REINO UNIDO', 'UNITED KINGDOM', 'UK', 'ENGLAND'],
    '493': ['MEXICO'],
    '858': ['VIETNA', 'VIETNAM', 'VIET NAM'],
    '105': ['BRASIL', 'BRAZIL']
  };
  function paisCodigo(v) {
    const t = norm(v).replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    if (/^\d{3,4}$/.test(String(v).trim())) return String(v).trim().slice(0, 3);
    for (const [cod, nomes] of Object.entries(PAISES)) if (nomes.some(n => t === n.replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim())) return cod;
    for (const [cod, nomes] of Object.entries(PAISES)) if (nomes.some(n => n.length > 4 && t.includes(n))) return cod;
    return null;
  }
  const paisNome = cod => (PAISES[cod] || [cod])[0];
  const UNIDADES = {
    UN: ['UN', 'UND', 'UNID', 'UNIDADE', 'PC', 'PCS', 'PCE', 'PIECE', 'PIECES', 'UNIT', 'UNITS', 'EA', 'EACH', 'SET', 'SETS', 'NOS'],
    KG: ['KG', 'KGS', 'KILO', 'KILOS', 'KILOGRAMA', 'QUILOGRAMA'],
    M: ['M', 'MT', 'MTS', 'METER', 'METERS', 'METRO', 'METROS'],
    L: ['L', 'LT', 'LTS', 'LITRO', 'LITROS', 'LITER', 'LITERS'],
    M2: ['M2', 'SQM'],
    M3: ['M3', 'CBM']
  };
  function unidadeBase(u) {
    const t = norm(u).replace(/[^A-Z0-9]/g, '');
    if (!t) return null;
    for (const [k, l] of Object.entries(UNIDADES)) if (l.includes(t)) return k;
    return t;
  }
  const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'DAT'];
  const INCOTERM_COM_FRETE = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'DAT'];
  const INCOTERM_COM_SEGURO = ['CIF', 'CIP'];

  C.util = { semAc, norm, normCod, alnum, vazio, cel, num, arred, iguais, fmt, fmtAuto, ncmLimpa, fmtNcm, dataISO, dataDDMMAA, fmtData, hashTexto, decodificar, moedaISO, paisCodigo, paisNome, unidadeBase, MOEDAS, PAISES, INCOTERMS, INCOTERM_COM_FRETE, INCOTERM_COM_SEGURO };

  /* ============================== TXT TOTVS ============================== */
  // Layout "Envio de dados do Purchase Order e Embarque/Desembaraço ao Despachante" (TDN TOTVS, SIGAEIC).
  // Posições 1-based, inclusivas. 'n' = numérico com ponto decimal; 'd' = data DDMMAA.
  const POS = {
    ITDI: { data: [5, 10, 'd'], hora: [11, 16], cnpj: [17, 30], usuario: [31, 50], recebedor: [51, 90] },
    CAPI: { processo: [5, 19], refCliente: [20, 39], data: [40, 45, 'd'], tipoDeclaracao: [46, 47], codImportador: [49, 52], urfDespacho: [70, 76], aplicacao: [88, 88], via: [89, 90], transportador: [92, 95], veiculo: [111, 140], manifesto: [145, 159], tipoDocCarga: [160, 161], master11: [162, 172], house11: [173, 183], dataEmissao: [184, 189, 'd'], localEmbarque: [190, 199], dataChegada: [201, 206, 'd'], pesoLiq: [207, 221, 'n'], pesoBruto: [222, 236, 'n'], paisProcedencia: [237, 239], house: [241, 258], master: [259, 277] },
    CAP2: { agente: [20, 23], urfEntrada: [24, 30], recinto: [31, 37], nItens: [38, 40, 'n'], moedaNeg: [55, 57], valorMerc: [58, 72, 'n'], moedaFrete: [73, 75], fretePrepaid: [76, 90, 'n'], freteCollect: [91, 105, 'n'], freteTerritorio: [106, 120, 'n'], moedaSeguro: [121, 123], tipoSeguro: [124, 124], pctSeguro: [125, 131, 'n'], valorSeguro: [132, 146, 'n'], moedaCarga: [147, 149], valorCarga: [150, 164, 'n'], incoterm: [165, 167], localIncoterm: [168, 177], modalidadePag: [189, 190], parcelas: [211, 213, 'n'], periodicidade: [214, 216, 'n'], valorTotal: [217, 231, 'n'] },
    CAP3: { valorCambio: [20, 39, 'n'], rof: [40, 47], antecipado: [50, 64, 'n'], aVista: [65, 79, 'n'] },
    ITEA: { codigo: [20, 39], qtd: [40, 54, 'n'], unidade: [55, 56], pesoLiq: [57, 68, 'n'], precoUnit: [69, 80, 'n'], tipoCalc: [81, 81], pctDesconto: [82, 86, 'n'], desconto: [87, 96, 'n'], vinculacao: [99, 99], codExportador: [100, 103], codFabricante: [104, 107], paisOrigem: [108, 110], paisAquisicao: [111, 113], ncm: [114, 123], exNcm: [124, 126], seq: [237, 240] },
    ITEB: { moeda: [82, 84], incoterm: [85, 87], localIncoterm: [88, 97], aliqII: [133, 139, 'n'], unidadeEstat: [173, 174], aliqIPI: [209, 215, 'n'], li: [230, 239] },
    ITED: { pesoLiqD: [20, 38, 'n'], po: [39, 53], posicaoPo: [54, 57], pli: [58, 67], dataFatura: [68, 73, 'd'], invoice: [241, 255], tabelaNve: [256, 258] },
    AG4A: { nome: [5, 64], endereco: [65, 144], numero: [215, 220], pais: [221, 223], codigo: [224, 227], tin: [241, 275] },
    AG4B: { nomeReduzido: [5, 29], estado: [30, 54], telefone: [55, 74], contato: [76, 115] },
    FTDI: { qtdProcessos: [5, 8, 'n'] }
  };
  const corta = (l, a, b) => l.substring(a - 1, b);
  function campos(l, def) {
    const o = {};
    for (const [k, [a, b, t]] of Object.entries(def)) {
      const s = corta(l, a, b);
      if (t === 'n') o[k] = s.trim() ? num(s.trim()) : null;
      else if (t === 'd') o[k] = dataDDMMAA(s);
      else o[k] = s.trim();
    }
    return o;
  }
  const RECS = new Set(['ITDI', 'CAPI', 'CAP2', 'CAP3', 'AD25', 'AD02', 'AD27', 'AD26', 'AD22', 'AD42', 'ITEA', 'ITEB', 'ITEC', 'ITED', 'AD40', 'AD13', 'AG4A', 'AG4B', 'RE5A', 'RE5B', 'NVAE', 'FTDI']);

  function lerTotvs(texto, arquivo) {
    const r = { tipo: 'txt', arquivo: arquivo || '', itdi: null, processos: [], ftdi: null, avisos: [], linhas: 0, curtas: 0, desconhecidas: [] };
    let P = null, it = null;
    const novo = () => { P = { capi: null, cap2: null, cap3: null, info: [], itens: [], fabricantes: [] }; r.processos.push(P); it = null; };
    String(texto || '').split(/\r?\n/).forEach((l, i) => {
      if (!l.trim()) return;
      r.linhas++;
      const rec = l.slice(0, 4).toUpperCase();
      if (l.length < 240 && !/^FTDI/.test(rec)) r.curtas++;
      if (rec === 'ITDI') r.itdi = campos(l, POS.ITDI);
      else if (rec === 'CAPI') { novo(); P.capi = campos(l, POS.CAPI); }
      else if (rec === 'CAP2') { if (!P) novo(); P.cap2 = campos(l, POS.CAP2); }
      else if (rec === 'CAP3') { if (!P) novo(); P.cap3 = campos(l, POS.CAP3); }
      else if (/^IP\d\d$/.test(rec)) { if (P) P.info.push(corta(l, 20, 240).trim()); }
      else if (rec === 'ITEA') {
        if (!P) novo();
        it = Object.assign({ linha: i + 1, dp: [], ic: [] }, campos(l, POS.ITEA));
        it.codigo = it.codigo.trim();
        it.ncm = ncmLimpa(it.ncm);
        P.itens.push(it);
      }
      else if (rec === 'ITEB') { if (it) Object.assign(it, campos(l, POS.ITEB)); }
      else if (rec === 'ITEC') { if (it) it.itec = corta(l, 20, 240); }
      else if (rec === 'ITED') { if (it) Object.assign(it, campos(l, POS.ITED)); }
      else if (/^DP\d\d$/.test(rec)) { if (it) it.dp.push(corta(l, 40, 240).replace(/\s+$/, '')); }
      else if (/^IC\d\d$/.test(rec)) { if (it) it.ic.push(corta(l, 40, 240).trim()); }
      else if (rec === 'AG4A') { if (!P) novo(); P.fabricantes.push(campos(l, POS.AG4A)); }
      else if (rec === 'AG4B') { if (P && P.fabricantes.length) Object.assign(P.fabricantes[P.fabricantes.length - 1], campos(l, POS.AG4B)); }
      else if (rec === 'FTDI') r.ftdi = campos(l, POS.FTDI);
      else if (!RECS.has(rec)) r.desconhecidas.push({ linha: i + 1, rec });
    });
    r.processos.forEach(p => p.itens.forEach(x => {
      x.descricao = x.dp.map(s => s.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      x.valor = (x.qtd || 0) * (x.precoUnit || 0) - (x.desconto || 0);
    }));
    if (!r.itdi) r.avisos.push('Registro ITDI (início do arquivo) não encontrado.');
    if (!r.processos.length) r.avisos.push('Nenhum processo (registro CAPI) encontrado no arquivo.');
    if (!r.ftdi) r.avisos.push('Registro FTDI (fim de transmissão) não encontrado: o arquivo pode estar incompleto.');
    else if (r.ftdi.qtdProcessos != null && r.ftdi.qtdProcessos !== r.processos.length) r.avisos.push(`FTDI informa ${r.ftdi.qtdProcessos} processo(s), mas o arquivo tem ${r.processos.length}.`);
    r.processos.forEach(p => {
      if (!p.cap2) r.avisos.push('Registro CAP2 (dados de frete, seguro e moeda) não encontrado.');
      else if (p.cap2.nItens != null && p.cap2.nItens !== p.itens.length) r.avisos.push(`CAP2 informa ${p.cap2.nItens} item(ns), mas o arquivo tem ${p.itens.length} registro(s) ITEA.`);
      p.itens.forEach(x => {
        if (!/^\d{8}$/.test(x.ncm)) r.avisos.push(`Item ${x.codigo || '(sem código)'} (linha ${x.linha}): NCM "${x.ncm}" fora do padrão de 8 dígitos.`);
        if (x.qtd == null) r.avisos.push(`Item ${x.codigo} (linha ${x.linha}): quantidade não lida.`);
        if (x.pesoLiqD != null && x.pesoLiq != null && !iguais(x.pesoLiq, x.pesoLiqD, 4)) r.avisos.push(`Item ${x.codigo}: peso líquido diferente entre ITEA (${fmtAuto(x.pesoLiq)}) e ITED (${fmtAuto(x.pesoLiqD)}).`);
        if (!x.dp.length) r.avisos.push(`Item ${x.codigo}: sem linhas de descrição (DPnn).`);
      });
    });
    if (r.curtas) r.avisos.push(`${r.curtas} linha(s) com menos de 240 posições: confira se o arquivo veio completo do TOTVS.`);
    if (r.desconhecidas.length) r.avisos.push(`${r.desconhecidas.length} linha(s) com registro não previsto no layout (ex.: ${r.desconhecidas.slice(0, 3).map(d => d.rec).join(', ')}).`);
    return r;
  }
  C.lerTotvs = lerTotvs;
  C.POS_TOTVS = POS;

  /* ============================== planilhas ============================== */
  function lerPastaTrabalho(XLSX, buf) {
    const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: false });
    return wb.SheetNames.map(nome => ({ nome, linhas: XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: '', blankrows: true }) }));
  }
  C.lerPastaTrabalho = lerPastaTrabalho;

  // rótulos "RÓTULO:" com valor à direita (ou "RÓTULO: valor" na mesma célula)
  function pares(linhas, ate) {
    const out = [];
    const lim = Math.min(linhas.length, ate == null ? linhas.length : ate);
    for (let r = 0; r < lim; r++) {
      const row = linhas[r] || [];
      for (let c = 0; c < row.length; c++) {
        const t = cel(row[c]).trim();
        if (!t || t.length > 70 || t.includes('\n')) continue;
        const dir = [];
        for (let k = c + 1; k < row.length; k++) if (!vazio(row[k])) dir.push(row[k]);
        if (/[:：]$/.test(t)) {
          let vals = dir, abaixo = false;
          if (!vals.length) {
            for (let k = r + 1; k < Math.min(lim, r + 3); k++) {
              const b = cel((linhas[k] || [])[c]).trim();
              if (!b) continue;
              if (!/[:：]$/.test(b) && b.length <= 120 && !b.includes('\n')) { vals = [b]; abaixo = true; }
              break;
            }
          }
          out.push({ r, c, rotulo: t.replace(/[:：]$/, '').trim(), chave: norm(t.replace(/[:：]$/, '')), valor: vals.length ? vals[0] : null, valores: vals, abaixo });
        }
        else {
          const m = /^([A-Za-zÀ-ú][A-Za-zÀ-ú .'\/()\-º°]{1,40})[:：]\s*(\S.*)$/.exec(t);
          if (m) out.push({ r, c, rotulo: m[1].trim(), chave: norm(m[1]), valor: m[2].trim(), valores: [m[2].trim()], inline: true });
          else out.push({ r, c, rotulo: t, chave: norm(t), valor: dir.length ? dir[0] : null, valores: dir, semDoisPontos: true });
        }
      }
    }
    return out;
  }
  function achar(ps, re, exigeDoisPontos = true) {
    const p = ps.find(x => re.test(x.chave) && (!exigeDoisPontos || !x.semDoisPontos));
    return p || null;
  }
  // bloco de texto abaixo de um rótulo (EXPORTER / IMPORTER)
  function blocoAbaixo(linhas, re, maxR) {
    for (let r = 0; r < Math.min(linhas.length, maxR || 40); r++) {
      const row = linhas[r] || [];
      for (let c = 0; c < row.length; c++) {
        const t = cel(row[c]);
        if (!t.trim()) continue;
        const ls = t.split(/\r?\n/);
        const l0 = norm(ls[0].replace(/[:：]\s*$/, ''));
        const inl = /^([^:：]{2,40})[:：]\s*(\S.*)$/.exec(ls[0]);
        const rotOk = s0 => re.test(s0) || re.test(s0.replace(/\s*(\(.*\)|[\/&].*)$/, '').trim());
        let resto;
        if (rotOk(l0)) resto = ls.slice(1).join('\n').trim();
        else if (inl && rotOk(norm(inl[1]))) resto = [inl[2]].concat(ls.slice(1)).join('\n').trim();
        else continue;
        if (resto) return { texto: resto, r, c };
        for (let k = r + 1; k < Math.min(linhas.length, r + 4); k++) {
          const v = cel((linhas[k] || [])[c]).trim();
          if (v) return { texto: v, r: k, c };
        }
      }
    }
    return null;
  }
  function parteBloco(texto) {
    if (!texto) return null;
    const ls = String(texto).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const cnpj = /(\d{2}[.,]?\d{3}[.,]?\d{3}\/?\d{4}-?\d{2})/.exec(texto);
    return { nome: ls[0] || '', endereco: ls.slice(1).filter(l => !/CNPJ/i.test(l)).join(', '), cnpj: cnpj ? cnpj[1].replace(/\D/g, '') : null, texto: ls.join('\n'), linhas: ls.length };
  }
  const COLS = [
    ['seq', /^(NO\.?|N[O°º]\.?|ITEM\s*NO\.?|#|SEQ\.?|NR\.?)$/],
    ['ncm', /^(NCM|HS\s*CODE|H\.?S\.?\s*CODE|HS|NCM\/SH|HS\s*NO\.?|CLASSIFICACAO\s*FISCAL)\b/],
    ['codigo', /(MATERIAL\s*CODE|PART\s*(NO|NUMBER|#)|ITEM\s*CODE|PRODUCT\s*CODE|CODIGO|COD\.?\s*PRINCIPAL|^REFERENCE|^REF\.?$|MODEL\s*NO|^P\/N|^SKU|ARTICLE\s*NO)/],
    ['fabEndereco', /(MANUFACTURER'?S?\s*ADDRESS|ENDERECO\s*DO\s*FABRICANTE)/],
    ['fabPais', /(MANUFACTURER'?S?\s*COUNTRY|PAIS\s*(DO\s*FABRICANTE|DE\s*ORIGEM)|^COUNTRY\s*OF\s*ORIGIN)/],
    ['descricao', /(DESCRIPTION|DESCRICAO|PRODUCT\s*NAME|COMMODITY|^GOODS|MERCADORIA|SPECIFICATION)/],
    ['fabricante', /^(MANUFACTURER|FABRICANTE|MAKER)\b/],
    ['unidade', /(QTY\s*UNIT|UNIT\s*OF\s*MEASURE|^UOM$|^UNIT$|^UNIDADE$|^UNID\.?$)/],
    ['qtd', /^(QTY|Q'?TY|QUANTITY|QUANTIDADE|QTDE?)\b/],
    ['preco', /(UNIT\s*PRICE|^PRICE|PRECO\s*UNIT|VALOR\s*UNIT|VR\.?\s*UNIT|^U\/?\s*PRICE)/],
    ['pesoLiq', /(NET\s*WEIGHT|^N\.?\s?W\.?\b|PESO\s*LIQ|NET\s*WT)/],
    ['pesoBruto', /(GROSS\s*WEIGHT|^G\.?\s?W\.?\b|PESO\s*BRUTO|GROSS\s*WT)/],
    ['total', /^(TOTAL|AMOUNT|VALOR\s*TOTAL|VR\.?\s*TOTAL)/],
    ['po', /^(PO|P\.O\.?|PO\s*(NO|NUMBER)|PURCHASE\s*ORDER|PEDIDO)\b/]
  ];
  function classifica(t) {
    const s = norm(t);
    if (!s || s.length > 60) return null;
    for (const [k, re] of COLS) if (re.test(s)) return k;
    return null;
  }
  function acharCabecalho(linhas) {
    let melhor = null;
    for (let r = 0; r < Math.min(linhas.length, 80); r++) {
      const row = linhas[r] || [];
      const cols = {}, rot = {};
      row.forEach((v, c) => {
        if (typeof v !== 'string') return;
        const k = classifica(v);
        if (k && cols[k] == null) { cols[k] = c; rot[k] = v.trim(); }
      });
      const n = Object.keys(cols).length;
      const ok = cols.qtd != null && (cols.descricao != null || cols.codigo != null);
      if (ok && (!melhor || n > melhor.n)) melhor = { r, cols, rot, n };
    }
    return melhor;
  }
  function moedaDosRotulos(rot) {
    for (const k of ['preco', 'total']) {
      const m = /\((USD|CNY|EUR|RMB|BRL|JPY|GBP|CHF)\)/i.exec(rot[k] || '') || /\b(USD|CNY|EUR|RMB|BRL)\b/i.exec(rot[k] || '');
      if (m) return m[1].toUpperCase() === 'RMB' ? 'CNY' : m[1].toUpperCase();
    }
    return null;
  }
  function tituloAba(linhas, aba) {
    if (aba && aba.titulo) return aba.titulo;
    if (linhas && linhas.titulo) return linhas.titulo;
    for (let r = 0; r < Math.min(linhas.length, 6); r++) for (const v of (linhas[r] || [])) {
      const t = norm(v);
      if (/^(COMMERCIAL\s+)?INVOICE$|^FATURA(\s+COMERCIAL)?$|^PROFORMA\s+INVOICE$/.test(t)) return 'invoice';
      if (/^PACKING\s*LIST$|^ROMANEIO/.test(t)) return 'packing';
      if (/^BILL\s+OF\s+LADING$|^(HOUSE\s+)?B\/L$|^CONHECIMENTO/.test(t)) return 'bl';
    }
    return null;
  }
  function lerTabela(linhas, cab) {
    const c = cab.cols, itens = [];
    let totais = null, brancas = 0;
    for (let r = cab.r + 1; r < linhas.length; r++) {
      const row = linhas[r] || [];
      const g = k => c[k] == null ? '' : row[c[k]];
      const prim = cel(row.find(v => !vazio(v)));
      if (!row.some(v => !vazio(v))) { if (++brancas >= 3 && itens.length) break; continue; }
      brancas = 0;
      if (/^\s*(TOTAL|SUB-?TOTAL|GRAND\s+TOTAL)\b/i.test(semAc(prim)) && !(c.seq != null && num(g('seq')) != null)) {
        totais = { rotulo: prim.trim(), linha: r + 1, qtd: num(g('qtd')), pesoLiq: num(g('pesoLiq')), pesoBruto: num(g('pesoBruto')), total: num(g('total')) };
        break;
      }
      const qtd = num(g('qtd'));
      const desc = cel(g('descricao')).trim(), cod = cel(g('codigo')).trim();
      if (qtd == null || (!desc && !cod)) continue;
      // PDF/OCR: número do item colado na NCM ("63 85332120")
      let ncmTxt = cel(g('ncm')).trim(), seq = num(g('seq'));
      const mNcm = /(?:^|\s)(\d{4}\.?\d{2}\.?\d{2})$/.exec(ncmTxt);
      if (mNcm && ncmLimpa(ncmTxt).length > 8) { const pre = ncmTxt.slice(0, mNcm.index).trim(); if (seq == null && /^\d{1,4}$/.test(pre)) seq = +pre; ncmTxt = mNcm[1]; }
      itens.push({
        linha: r + 1, seq, ncm: ncmLimpa(ncmTxt), codigo: cod, descricao: desc,
        fabricante: cel(g('fabricante')).trim(), fabEndereco: cel(g('fabEndereco')).trim(), fabPais: cel(g('fabPais')).trim(),
        qtd, unidade: cel(g('unidade')).trim(), preco: num(g('preco')), pesoLiq: num(g('pesoLiq')), pesoBruto: num(g('pesoBruto')),
        total: num(g('total')), po: cel(g('po')).trim()
      });
    }
    return { itens, totais };
  }
  function linhaApos(linhas, r0, re) {
    for (let r = r0; r < linhas.length; r++) {
      const row = linhas[r] || [];
      for (let c = 0; c < row.length; c++) {
        const t = cel(row[c]).trim();
        const m = t ? re.exec(norm(t)) : null;
        if (m) {
          const dir = [];
          for (let k = c + 1; k < row.length; k++) if (!vazio(row[k])) dir.push(row[k]);
          const inl = /[:：]\s*(\S.*)$/.exec(t);
          // PDF: "TOTAL PACKED IN 45 PACKAGES" chega numa célula só
          const resto = norm(t).slice(m.index + m[0].length).replace(/^[\s:：.]+/, '').trim();
          return { r, c, texto: t, valores: dir.length ? dir : inl ? [inl[1]] : resto ? resto.split(/\s+/) : [] };
        }
      }
    }
    return null;
  }
  const ehRotulo = v => typeof v === 'string' && /[:：]\s*$/.test(v.trim());

  function lerFaturaOuRomaneio(aba, tipoForcado) {
    const linhas = aba.linhas;
    const cab = acharCabecalho(linhas);
    if (!cab) return null;
    const titulo = tituloAba(linhas, aba);
    const tipo = tipoForcado || titulo || (cab.cols.preco != null || cab.cols.total != null ? 'invoice' : 'packing');
    const ps = pares(linhas, cab.r);
    const psRod = pares(linhas.slice(cab.r + 1));
    const tab = lerTabela(linhas, cab);
    const pv = re => { const p = achar(ps, re); return p ? p.valor : null; };
    const exp = parteBloco((blocoAbaixo(linhas, /^(EXPORTER|SELLER|SHIPPER|VENDEDOR|EXPORTADOR|BENEFICIARY)$/, cab.r) || {}).texto);
    const imp = parteBloco((blocoAbaixo(linhas, /^(IMPORTER|BUYER|CONSIGNEE|IMPORTADOR|COMPRADOR|SOLD TO|BILL TO)$/, cab.r) || {}).texto);
    const incP = achar(ps, /^INCOTERMS?\b/);
    const doc = {
      tipo, aba: aba.nome,
      cab: {
        numero: cel(pv(/^(INVOICE|INVOICE\s*NO\.?|INVOICE\s*NUMBER|FATURA|N[O°º]\.?\s*DA\s*FATURA|PROFORMA\s*NO\.?)$/)).trim() || null,
        data: dataISO(pv(/^(DATE|DATA|INVOICE\s*DATE|DATA\s*DA\s*FATURA)$/)),
        ipRef: cel(pv(/^(IP\s*REF\.?|IP|REF\.?|REFERENCE|IMPORT\s*REF\.?)$/)).trim() || null,
        poRef: cel(pv(/^(PO\s*REF\.?|PO|P\.O\.?|PURCHASE\s*ORDER|ORDER\s*NO\.?)$/)).trim() || null,
        portoOrigem: cel(pv(/^(FROM|PORT\s*OF\s*LOADING|POL|ORIGEM)$/)).trim() || null,
        portoDestino: cel(pv(/^(TO|PORT\s*OF\s*DISCHARGE|POD|DESTINO|DESTINATION)$/)).trim() || null,
        incoterm: incP ? (norm(incP.valor).match(/\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP|DAT)\b/) || [null, norm(incP.valor) || null])[1] : null,
        incotermRotulo: incP ? incP.rotulo : null,
        paisOrigem: cel(pv(/^COUNTRY\s*OF\s*ORIGIN$|^PAIS\s*DE\s*ORIGEM$/)).trim() || null,
        paisAquisicao: cel(pv(/^COUNTRY\s*OF\s*ACQUISITION$|^PAIS\s*DE\s*AQUISICAO$/)).trim() || null,
        paisProcedencia: cel(pv(/^COUNTRY\s*OF\s*(PRECEDENCE|PROVENANCE|PROCEDENCE)$|^PAIS\s*DE\s*PROCEDENCIA$/)).trim() || null,
        exportador: exp, importador: imp,
        moeda: moedaDosRotulos(cab.rot), colunas: cab.rot, colIdx: cab.cols, linhaCabecalho: cab.r + 1
      },
      itens: tab.itens, totais: tab.totais, avisos: []
    };
    const paga = achar(psRod, /^(PAYMENT\s*TERMS?|PAYMENT|TERMS\s*OF\s*PAYMENT|CONDICOES\s*DE\s*PAGAMENTO|PAGAMENTO)$/);
    doc.cab.pagamento = paga ? cel(paga.valor).trim() : null;
    const ext = achar(psRod, /^(TOTAL|SAY\s*TOTAL|AMOUNT\s*IN\s*WORDS|TOTAL\s*AMOUNT)$/);
    if (ext) {
      const vs = ext.valores.map(cel);
      doc.cab.extenso = vs.filter(v => /[A-Z]{4,}/i.test(v)).sort((a, b) => b.length - a.length)[0] || null;
      if (!doc.cab.moeda) doc.cab.moeda = moedaISO(vs.find(v => moedaISO(v)) || '');
    }
    if (!doc.cab.moeda) doc.cab.moeda = moedaISO(cel(ext && ext.valor)) || null;
    // frete, seguro, desconto declarados
    const busca = (re) => {
      const p = psRod.concat(ps).find(x => re.test(x.chave) && !/TERMS?|PREPAID|COLLECT/.test(x.chave));
      if (!p) return null;
      const n = p.valores.map(num).find(v => v != null);
      return { rotulo: p.rotulo, valor: n == null ? null : n, texto: p.valores.map(cel).join(' ').trim() };
    };
    doc.cab.frete = busca(/^(OCEAN\s*|INTERNATIONAL\s*|AIR\s*)?FREIGHT(\s*COST|\s*CHARGES?|\s*\(.*\))?$|^FRETE(\s*INTERNACIONAL)?$/);
    doc.cab.seguro = busca(/^(INSURANCE|SEGURO)(\s*\(.*\))?$/);
    doc.cab.desconto = busca(/^(DISCOUNT|DESCONTO)(\s*\(.*\))?$/);
    if (tipo === 'packing' || tipo === 'invoice') {
      const vol = linhaApos(linhas, cab.r, /^(TOTAL\s+PACKED\s+IN|PACKED\s+IN|TOTAL\s+(PACKAGES|PKGS|CARTONS|PALLETS|CASES)|QUANTIDADE\s+DE\s+VOLUMES|NO\.?\s*OF\s*PACKAGES)/);
      if (vol) {
        const n = vol.valores.map(num).find(v => v != null);
        const esp = vol.valores.map(cel).find(v => /[A-Za-z]{3,}/.test(v) && num(v) == null);
        doc.cab.volumes = { qtd: n == null ? null : n, especie: esp ? esp.trim() : null };
      }
      const mk = linhaApos(linhas, cab.r, /^(SHIP(MENT|PING)\s+MARKS?|MARKS(\s+(AND|&)\s+NUMBERS?)?|MARCAS?)\b/);
      if (mk) doc.cab.marcas = mk.valores.length && !ehRotulo(mk.valores[0]) ? cel(mk.valores[0]).trim() : '';
      const cb = linhaApos(linhas, cab.r, /^(VOLUME|MEASUREMENT|CUBAGEM|TOTAL\s+VOLUME|CBM)\b/);
      if (cb) doc.cab.cubagem = cb.valores.map(num).find(v => v != null) ?? null;
      const wd = linhaApos(linhas, cab.r, /(WOOD(EN)?\s+(PACK|PACKING|PACKAGE|PACKAGING)|EMBALAGE(M|NS)\s+DE\s+MADEIRA)/);
      if (wd) doc.cab.madeira = wd.valores.length && !ehRotulo(wd.valores[0]) ? cel(wd.valores[0]).trim() : (/[:：]\s*(\S.*)$/.exec(wd.texto) || [])[1] || '';
      const ct = linhaApos(linhas, cab.r, /^CONTAINER\s*(NO|NUMBER|N[O°º])?\.?/);
      if (ct) doc.cab.container = ct.valores.length && !ehRotulo(ct.valores[0]) ? cel(ct.valores[0]).trim() : '';
      const sl = linhaApos(linhas, cab.r, /^SEAL\s*(NO|NUMBER|N[O°º])?\.?|^LACRE/);
      if (sl) doc.cab.lacre = sl.valores.length && !ehRotulo(sl.valores[0]) ? cel(sl.valores[0]).trim() : '';
      if (!sl && ct) { const m = /SEAL\s*NO\.?\s*[:：]?\s*(\S*)/i.exec(ct.valores.map(cel).join(' ')); if (m) doc.cab.lacre = m[1] || ''; }
    }
    if (!tab.itens.length) doc.avisos.push(`Aba "${aba.nome}": cabeçalho de itens encontrado, mas nenhum item foi lido.`);
    return doc;
  }

  function lerDocumentosComerciais(abas) {
    const out = { invoice: null, packing: null, avisos: [], abas: [] };
    for (const aba of abas) {
      const t = tituloAba(aba.linhas, aba);
      if (t === 'bl') { out.abas.push({ nome: aba.nome, tipo: 'bl', itens: 0 }); continue; }
      const d = lerFaturaOuRomaneio(aba, t);
      out.abas.push({ nome: aba.nome, tipo: d ? d.tipo : (t || 'ignorada'), itens: d ? d.itens.length : 0 });
      if (!d || !d.itens.length) continue;
      if (d.tipo === 'invoice' && !out.invoice) out.invoice = d;
      else if (d.tipo === 'packing' && !out.packing) out.packing = d;
    }
    if (!out.invoice && !out.packing) out.avisos.push('Nenhuma tabela de itens reconhecida (procuro colunas como quantidade, descrição/código, preço e pesos).');
    return out;
  }
  C.lerDocumentosComerciais = lerDocumentosComerciais;
  C.colunas = { COLS, classifica, acharCabecalho, tituloAba };

  /* ============================== BL / HBL ============================== */
  const BL_ROT = [
    ['shipper', /^(SHIPPER|EXPORTER|EMBARCADOR)(?!['’`]?S\b)\b/],
    ['consignee', /^(CONSIGNEE|CONSIGNATARIO)\b/],
    ['notify', /^(NOTIFY(\s*PARTY)?|NOTIFICAR)\b/],
    ['localRecebimento', /^PLACE\s+OF\s+RECEIPT/],
    ['portoEmbarque', /^PORT\s+OF\s+LOADING/],
    ['portoDescarga', /^PORT\s+OF\s+DISCHARGE/],
    ['destinoFinal', /^(FINAL\s+DESTINATION|PLACE\s+OF\s+DELIVERY)/],
    ['transbordo', /^PORT\s+OF\s+TRANSHIPMENT/],
    ['navio', /^((OCEAN\s+)?VESSEL|EXPORT\s+CARRIER)/],
    ['numero', /^(BILL\s+OF\s+LADING\s+NO|B\/L\s+(NO|NUMBER)|BL\s+(NO|NUMBER)|HBL\s+NO|HOUSE\s+B\/L|DOCUMENT\s+NO)/],
    ['paisOrigem', /^COUNTRY\s+OF\s+ORIGIN/],
    ['refEmbarcador', /^SHIPPER'?S\s+REF/],
    ['agente', /^(F\/AGENT|FORWARDING\s+AGENT|DELIVERY\s+AGENT)/]
  ];
  const ehRotuloBL = t => BL_ROT.some(([, re]) => re.test(norm(String(t).split(/\r?\n/)[0]).replace(/^\d{1,2}[A-Z]?\s*[.)]\s*/, ''))) || /^(MARKS|NO\.?\s*OF\s*PKGS|DESCRIPTION\s+OF|GROSS\s+WEIGHT|MEASUREMENT|CARRIER|NO\.?\s*OF\s*BILLS)/.test(norm(t));
  function lerBL(abas) {
    const aba = abas.find(a => tituloAba(a.linhas, a) === 'bl') || abas[0];
    const L = aba.linhas;
    const cab = {};
    for (let r = 0; r < L.length; r++) for (let c = 0; c < (L[r] || []).length; c++) {
      const t = cel(L[r][c]);
      if (!t.trim()) continue;
      const ls = t.split(/\r?\n/);
      const prim = norm(ls[0].replace(/[:：]\s*$/, '')).replace(/^\d{1,2}[A-Z]?\s*[.,)]\s*/, '');
      for (const [k, re] of BL_ROT) {
        if (cab[k] !== undefined || !re.test(prim) || ls[0].trim().length > 60 || /^[a-z]/.test(ls[0].trim())) continue;
        const inl = /^[^:：]{2,40}[:：]\s*(\S.*)$/.exec(ls[0]);
        let v = (inl ? [inl[1]] : []).concat(ls.slice(1)).join('\n').trim();
        if (!v) {
          for (let k2 = r + 1; k2 < Math.min(L.length, r + 3); k2++) { const b = cel((L[k2] || [])[c]).trim(); if (b && !ehRotuloBL(b)) { v = b; break; } if (b) break; }
        }
        cab[k] = v;
      }
    }
    ['shipper', 'consignee', 'notify'].forEach(k => { cab[k] = parteBloco(cab[k]); });
    // tabela de mercadorias
    let hdr = null;
    for (let r = 0; r < L.length && !hdr; r++) {
      const row = (L[r] || []).map(norm);
      if (row.some(v => /^MARKS/.test(v)) && row.some(v => /GROSS\s*WEIGHT/.test(v))) {
        const m = {};
        row.forEach((v, c) => {
          if (/^MARKS/.test(v)) m.marcas = c;
          else if (/(NO\.?\s*OF\s*PKGS|PACKAGES|PKGS|VOLUMES)/.test(v) && m.volumes == null) m.volumes = c;
          else if (/DESCRIPTION/.test(v)) m.descricao = c;
          else if (/GROSS\s*WEIGHT/.test(v)) m.pesoBruto = c;
          else if (/(MEASUREMENT|CBM|CUBAGEM)/.test(v)) m.cubagem = c;
        });
        hdr = { r, m };
      }
    }
    const desc = [];
    if (hdr) {
      for (let r = hdr.r + 1; r < L.length; r++) {
        const row = L[r] || [];
        if (!row.some(v => !vazio(v))) continue;
        const g = k => hdr.m[k] == null ? '' : row[hdr.m[k]];
        if (cab.marcas == null && !vazio(g('marcas'))) cab.marcas = cel(g('marcas')).trim();
        if (cab.volumesTexto == null && !vazio(g('volumes'))) cab.volumesTexto = cel(g('volumes')).trim();
        if (!vazio(g('descricao'))) desc.push(cel(g('descricao')));
        if (cab.pesoBruto == null && num(g('pesoBruto')) != null) cab.pesoBruto = num(g('pesoBruto'));
        if (cab.cubagem == null && num(g('cubagem')) != null) cab.cubagem = num(g('cubagem'));
      }
    }
    if (!desc.length) { const ini = L.findIndex(r => (r || []).some(v => /GOODS|DESCRIPTION|COMMODIT|PARTS\s+FOR/.test(norm(v)))); (ini >= 0 ? L.slice(ini) : L).forEach(r => { const t = (r || []).map(cel).filter(v => v.trim()).join(' '); if (t) desc.push(t); }); }
    const D = desc.join('\n');
    cab.descricaoCompleta = D;
    cab.descricao = (D.split(/\r?\n/).find(s => s.trim()) || '').trim();
    const ND = norm(D);
    const ncms = [];
    (D.match(/NCM\s*[:：]?\s*[0-9][0-9.,\/\s;]*/gi) || []).forEach(s => s.replace(/^NCM\s*[:：]?/i, '').split(/[,\/\s;]+/).forEach(x => { const d = ncmLimpa(x); if (d.length >= 4) ncms.push(d); }));
    cab.ncms = [...new Set(ncms)];
    const ip = /\bIPH?\s*[:：]\s*([A-Z0-9][A-Z0-9\/\-]+)/.exec(ND); cab.ipRef = ip ? ip[1] : null;
    cab.pos = [...new Set((ND.match(/\bPO\s*\d{5,7}(?:\s*&\s*\d{5,7})*/g) || []).flatMap(s => s.replace(/PO\s*/, '').split('&').map(x => x.trim())))];
    const LN = D.split(/\r?\n/).map(norm);
    const linhaRe = re => { for (const l of LN) { const m = re.exec(l); if (m) return m; } return null; };
    const wd = linhaRe(/WOOD(?:EN)?\s*(?:PACKAGE|PACKING|PACKAGING)S?\s*(?:USED)?\s*[:：]?\s*([A-Z][A-Z \-]*)/); cab.madeira = wd ? wd[1].trim() : null;
    const fr = /(OCEAN\s*)?FREIGHT\s*[:：]\s*([^\n]*)/i.exec(D);
    cab.freteTexto = fr ? fr[2].trim() : null;
    cab.freteValor = fr ? num((fr[2].match(/[\d.,]+/) || [])[0]) : null;
    cab.freteMoeda = fr ? moedaISO(fr[2]) : null;
    const inc = /INCOTERMS?\s*(?:20\d\d)?\s*[:：]?\s*([A-Z]{3})\b/.exec(ND); cab.incoterm = inc ? inc[1] : null;
    const fm = /FREIGHT\s+(PREPAID|COLLECT)/.exec(ND); cab.freteModalidade = fm ? fm[1] : null;
    const ft = /(\d+)\s*DAYS?\s*FREE\s*TIME/.exec(ND); cab.freeTime = ft ? +ft[1] : null;
    const tudo = norm(L.map(r => (r || []).map(cel).join(' ')).join(' '));
    const cont = /\b([A-Z]{3}U\s?\d{7})\b/.exec(ND) || /\b([A-Z]{3}U\s?\d{7})\b/.exec(tudo); cab.container = cont ? cont[1].replace(/\s/g, '') : null;
    const lac = /SEAL\s*(?:NO\.?)?\s*[:：]\s*([A-Z0-9\-]{4,})/.exec(ND); cab.lacre = lac ? lac[1] : null;
    // totais na linha "TOTALS: 152 PKG 45662.660 Kg 163.277 m3" (BL sem tabela)
    const tl = /TOTA(?:L|IS)S?\s*[:：]?\s*(\d[\d.,]*)\s*(PKGS?|PACKAGES|CARTONS|CTNS|PLTS?|PALLETS|VOLUMES)\s*(\d[\d.,\s]*?)\s*KGS?\b\s*(\d[\d.,]*)?\s*(M3|CBM)?/.exec(ND);
    if (tl) { if (cab.volumesTexto == null) cab.volumesTexto = tl[1] + ' ' + tl[2]; if (cab.pesoBruto == null) cab.pesoBruto = num(tl[3].replace(/\s/g, '')); if (cab.cubagem == null && tl[4]) cab.cubagem = num(tl[4]); }
    if (cab.volumesTexto) {
      const m = /(\d[\d.,]*)\s*([A-Za-z][A-Za-z ]*)?/.exec(cab.volumesTexto);
      cab.volumes = m ? { qtd: num(m[1]), especie: (m[2] || '').trim().toUpperCase() || null } : null;
    }
    return { tipo: 'bl', aba: aba.nome, cab, avisos: hdr ? [] : ['Tabela de mercadorias do BL (Marks / Gross Weight) não encontrada.'] };
  }
  C.lerBL = lerBL;

  /* ============================== relatório de itens (Sigraweb) ============================== */
  const REL_CAB = [
    ['importador', /^IMPORTADOR$/], ['cnpj', /^CNPJ$/], ['refAgil', /^REF\.?\s*AGIL$/], ['refCliente', /^REF\.?\s*CLIENTE$/],
    ['moeda', /^MOEDA\s*NEGOCIADA$/], ['taxaMoeda', /^TX\.?\s*MOEDA\s*NEGOCIADA$/], ['taxaUsd', /^TAXA\s*USD$/],
    ['incoterm', /^INCOTERM$/], ['pesoLiq', /^PESO\s*LIQ/], ['pesoBruto', /^PESO\s*BR/]
  ];
  const REL_COLS = [
    ['adicao', /^ADICAO$/], ['item', /^ITEM$/], ['ncm', /^NCM$/], ['codigo', /COD\.?\s*PRINCIPAL/], ['codSec', /COD\.?\s*SECUNDARIO/],
    ['descricao', /^DESCRICAO/], ['fabricante', /^FABRICANTE/], ['qtd', /^QUANTIDADE/], ['unidade', /^UNIDADE$/],
    ['unitMoeda', /VR\.?\s*UNIT\s*\(MOEDA/], ['unitBrl', /VR\.?\s*UNIT\s*\(BRL/], ['totalMoeda', /VR\.?\s*TOTAL\s*\(MOEDA/], ['totalBrl', /VR\.?\s*TOTAL\s*\(BRL/],
    ['pesoLiq', /^(NET\s*WEIGHT|PESO\s*LIQ)/], ['pesoBruto', /^(GROSS\s*WEIGHT|PESO\s*BR)/], ['finalidade', /^FINALIDADE/],
    ['fobMoeda', /VR\.?\s*FOB\s*\(MOEDA/], ['freteMoeda', /^FRETE\s*\(MOEDA/], ['freteBrl', /^FRETE\s*\(BRL/], ['seguroMoeda', /^SEGURO\s*\(MOEDA/], ['seguroBrl', /^SEGURO\s*\(BRL/],
    ['cifMoeda', /^CIF\s*\(MOEDA/], ['aliqII', /^ALIQ\.?\s*II$/], ['aliqIPI', /^ALIQ\.?\s*IPI$/], ['aliqPIS', /^ALIQ\.?\s*PIS$/], ['aliqCOFINS', /^ALIQ\.?\s*COFINS$/]
  ];
  function lerRelatorio(abas) {
    let alvo = null;
    for (const a of abas) {
      for (let r = 0; r < Math.min(a.linhas.length, 40); r++) {
        const row = (a.linhas[r] || []).map(norm);
        if (row.includes('NCM') && row.some(v => /COD\.?\s*PRINCIPAL/.test(v)) && row.some(v => /^QUANTIDADE/.test(v))) { alvo = { aba: a, r }; break; }
      }
      if (alvo) break;
    }
    if (!alvo) return { tipo: 'relatorio', cab: {}, itens: [], avisos: ['Planilha não reconhecida como relatório de itens (procuro as colunas NCM, CÓD. PRINCIPAL e QUANTIDADE).'] };
    const L = alvo.aba.linhas;
    const cab = {};
    for (let r = 0; r < alvo.r; r++) {
      const row = L[r] || [];
      row.forEach((v, c) => {
        const t = norm(v);
        const def = REL_CAB.find(([, re]) => re.test(t));
        if (!def || cab[def[0]] !== undefined) return;
        let val = null;
        for (let k = c + 1; k < row.length; k++) if (!vazio(row[k])) { val = row[k]; break; }
        cab[def[0]] = val;
      });
    }
    cab.moedaISO = moedaISO(cab.moeda);
    ['taxaMoeda', 'taxaUsd', 'pesoLiq', 'pesoBruto'].forEach(k => { cab[k] = num(cab[k]); });
    if (cab.cnpj) cab.cnpj = String(cab.cnpj).replace(/\D/g, '');
    const h1 = L[alvo.r] || [], h2 = L[alvo.r + 1] || [];
    const sub = h2.some(v => /\(MOEDA|\(BRL/.test(norm(v)));
    const n = Math.max(h1.length, h2.length);
    const cols = {};
    for (let c = 0; c < n; c++) {
      const cands = [norm(h2[c]), norm(h1[c])].filter(Boolean);
      for (const t of cands) {
        const def = REL_COLS.find(([, re]) => re.test(t));
        if (def && cols[def[0]] == null) { cols[def[0]] = c; break; }
      }
    }
    const itens = [];
    let totais = null;
    for (let r = alvo.r + (sub ? 2 : 1); r < L.length; r++) {
      const row = L[r] || [];
      if (!row.some(v => !vazio(v))) continue;
      const g = k => cols[k] == null ? '' : row[cols[k]];
      if (/^TOTA(L|IS)$/.test(norm(row[0]))) {
        totais = { qtd: num(g('qtd')), totalMoeda: num(g('totalMoeda')), totalBrl: num(g('totalBrl')), pesoLiq: num(g('pesoLiq')), pesoBruto: num(g('pesoBruto')), fobMoeda: num(g('fobMoeda')), freteMoeda: num(g('freteMoeda')), freteBrl: num(g('freteBrl')), seguroMoeda: num(g('seguroMoeda')), seguroBrl: num(g('seguroBrl')), cifMoeda: num(g('cifMoeda')) };
        break;
      }
      const cod = cel(g('codigo')).trim();
      if (!cod && vazio(g('ncm'))) continue;
      itens.push({
        linha: r + 1, adicao: cel(g('adicao')).trim(), item: cel(g('item')).trim(), ncm: ncmLimpa(g('ncm')), codigo: cod, codSec: cel(g('codSec')).trim(),
        descricao: cel(g('descricao')).trim(), fabricante: cel(g('fabricante')).trim(), qtd: num(g('qtd')), unidade: cel(g('unidade')).trim(),
        unitMoeda: num(g('unitMoeda')), unitBrl: num(g('unitBrl')), totalMoeda: num(g('totalMoeda')), totalBrl: num(g('totalBrl')),
        pesoLiq: num(g('pesoLiq')), pesoBruto: num(g('pesoBruto')), finalidade: cel(g('finalidade')).trim(),
        fobMoeda: num(g('fobMoeda')), freteMoeda: num(g('freteMoeda')), seguroMoeda: num(g('seguroMoeda')), cifMoeda: num(g('cifMoeda')),
        aliqII: num(g('aliqII')), aliqIPI: num(g('aliqIPI')), aliqPIS: num(g('aliqPIS')), aliqCOFINS: num(g('aliqCOFINS'))
      });
    }
    const avisos = [];
    if (!itens.length) avisos.push('Relatório de itens sem linhas de item.');
    ['codigo', 'ncm', 'qtd', 'totalMoeda', 'pesoLiq'].forEach(k => { if (cols[k] == null) avisos.push(`Coluna "${k}" não encontrada no relatório de itens.`); });
    return { tipo: 'relatorio', aba: alvo.aba.nome, cab, itens, totais, colunas: cols, avisos };
  }
  C.lerRelatorio = lerRelatorio;

  /* ============================== planilha de validação de diferimento de ICMS ============================== */
  function lerDiferimento(abas) {
    for (const a of abas) {
      for (let r = 0; r < Math.min(a.linhas.length, 15); r++) {
        const row = (a.linhas[r] || []).map(norm);
        const ic = row.findIndex(v => /^COD(IGO|\.)?\s*PRINCIPAL$|^CODIGO$/.test(v)), inc = row.findIndex(v => v === 'NCM');
        const idf = row.findIndex(v => /^DIFERIMENTO/.test(v));
        if (ic < 0 || inc < 0 || idf < 0) continue;
        const col = re => row.findIndex(v => re.test(v));
        const c = { desc: col(/^DESCRICAO/), fin: col(/^FINALIDADE/), prot: col(/^PROTOCOLO/), ex: col(/^EX[-\s]?TARIFARIO/), tex: col(/^TEXTO\s*EX/) };
        const g = (lin, k) => k < 0 ? '' : cel(lin[k]).trim();
        const itens = [];
        for (let k = r + 1; k < a.linhas.length; k++) {
          const lin = a.linhas[k] || [];
          const cod = g(lin, ic);
          if (!cod) continue;
          itens.push({ linha: k + 1, codigo: cod, descricao: g(lin, c.desc), ncm: ncmLimpa(lin[inc]), finalidade: g(lin, c.fin), diferimento: g(lin, idf), protocolo: g(lin, c.prot), ex: g(lin, c.ex), textoEx: g(lin, c.tex) });
        }
        return { tipo: 'diferimento', aba: a.nome, itens, avisos: itens.length ? [] : ['Planilha de diferimento sem itens.'] };
      }
    }
    return null;
  }
  C.lerDiferimento = lerDiferimento;

  /* ============================== catálogo de produtos ============================== */
  const ehAtivo = p => /^ATIVAD/.test(norm(p.situacao));
  function lerCatalogo(json, arquivo) {
    const lista = Array.isArray(json) ? json : (json && (json.produtos || json.itens || json.data || json.content)) || null;
    if (!Array.isArray(lista) || !lista.length || typeof lista[0] !== 'object') throw new Error('Arquivo não reconhecido como catálogo: esperada a lista de produtos exportada do Portal Único (JSON).');
    if (!('ncm' in lista[0]) || !('codigo' in lista[0])) throw new Error('O JSON não tem os campos de produto do catálogo (codigo, ncm, codigosInterno).');
    const produtos = lista.map(p => ({
      seq: p.seq ?? null, codigo: String(p.codigo ?? '').trim(), descricao: cel(p.descricao).trim(), denominacao: cel(p.denominacao).trim(),
      situacao: cel(p.situacao).trim(), ncm: ncmLimpa(p.ncm), versao: String(p.versao ?? '').trim(), modalidade: p.modalidade || null,
      cnpjRaiz: p.cpfCnpjRaiz ? String(p.cpfCnpjRaiz) : null,
      codigosInterno: (p.codigosInterno || []).map(x => cel(x).trim()).filter(Boolean),
      atributos: { simples: p.atributos || [], multivalorados: p.atributosMultivalorados || [], compostos: p.atributosCompostos || [], compostosMultivalorados: p.atributosCompostosMultivalorados || [] },
      inicioVigencia: p.inicioVigencia || null, fimVigencia: p.fimVigencia || null
    }));
    produtos.forEach(p => { p.assinatura = [p.codigo, p.versao, p.ncm, ehAtivo(p) ? 'A' : 'D', hashTexto(norm(p.descricao))].join('|'); });
    const m = /CATALOGO_PRODUTOS_(\d{8})_(\d{14})/i.exec(arquivo || '');
    const geradoEm = m ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}T${m[2].slice(8, 10)}:${m[2].slice(10, 12)}:${m[2].slice(12, 14)}-03:00` : null;
    const meta = {
      arquivo: arquivo || '', cnpjRaiz: m ? m[1] : (produtos.find(p => p.cnpjRaiz) || {}).cnpjRaiz || null, geradoEm,
      total: produtos.length, ativos: produtos.filter(ehAtivo).length, desativados: produtos.filter(p => !ehAtivo(p)).length
    };
    return { meta, produtos };
  }
  function indexarCatalogo(cat) {
    if (cat.__idx) return cat.__idx;
    const idx = new Map();
    cat.produtos.forEach(p => p.codigosInterno.forEach(ci => {
      const k = normCod(ci);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(p);
    }));
    Object.defineProperty(cat, '__idx', { value: idx, enumerable: false });
    return idx;
  }
  function consultarCatalogo(cat, codigoInterno) {
    const lista = (indexarCatalogo(cat).get(normCod(codigoInterno)) || []).slice();
    const vnum = p => num(p.versao) || 0;
    const ativos = lista.filter(ehAtivo).sort((a, b) => vnum(b) - vnum(a) || (num(b.codigo) || 0) - (num(a.codigo) || 0));
    const inativos = lista.filter(p => !ehAtivo(p));
    const status = !lista.length ? 'nao_encontrado' : !ativos.length ? 'desativado' : ativos.length > 1 ? 'multiplos' : 'ativo';
    return { status, ativos, inativos, produto: ativos[0] || null };
  }
  function descricaoSemCodigo(p, codigoInterno) {
    let d = cel(p && p.descricao).trim();
    const pref = [codigoInterno, ...(p && p.codigosInterno || [])].filter(Boolean);
    for (const c of pref) {
      const re = new RegExp('^\\s*' + String(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–:]\\s*', 'i');
      if (re.test(d)) { d = d.replace(re, ''); break; }
    }
    return d;
  }
  function diffCatalogos(antigo, novo) {
    const porCi = cat => {
      const m = new Map();
      cat.produtos.forEach(p => p.codigosInterno.forEach(ci => {
        const k = normCod(ci);
        if (!m.has(k)) m.set(k, { ci, ativos: [], todos: [] });
        m.get(k).todos.push(p);
        if (ehAtivo(p)) m.get(k).ativos.push(p);
      }));
      m.forEach(v => { v.sig = v.ativos.map(p => p.assinatura).sort().join(';'); });
      return m;
    };
    const A = antigo ? porCi(antigo) : new Map(), B = porCi(novo);
    const resumo = { novos: [], removidos: [], alterados: [] };
    const curto = p => p ? { codigo: p.codigo, versao: p.versao, ncm: p.ncm, situacao: p.situacao } : null;
    B.forEach((v, k) => {
      const a = A.get(k);
      if (!a) { resumo.novos.push({ codigoInterno: v.ci, depois: v.ativos.map(curto) }); return; }
      if (a.sig !== v.sig) {
        const mud = [];
        const pa = a.ativos[0], pb = v.ativos[0];
        if ((pa && pa.ncm) !== (pb && pb.ncm)) mud.push('ncm');
        if ((pa && pa.codigo) !== (pb && pb.codigo)) mud.push('produto');
        if ((pa && pa.versao) !== (pb && pb.versao)) mud.push('versao');
        if (pa && pb && hashTexto(norm(pa.descricao)) !== hashTexto(norm(pb.descricao))) mud.push('descricao');
        if (a.ativos.length !== v.ativos.length) mud.push('qtd_ativos');
        resumo.alterados.push({ codigoInterno: v.ci, mudancas: mud, antes: a.ativos.map(curto), depois: v.ativos.map(curto) });
      }
    });
    A.forEach((v, k) => { if (!B.has(k)) resumo.removidos.push({ codigoInterno: v.ci, antes: v.ativos.map(curto) }); });
    return resumo;
  }
  function saudeCatalogo(cat) {
    const idx = indexarCatalogo(cat);
    const multiplos = [], placeholders = [];
    idx.forEach((lista, k) => { const at = lista.filter(ehAtivo); if (at.length > 1) multiplos.push({ codigoInterno: lista[0].codigosInterno.find(c => normCod(c) === k) || k, produtos: at.map(p => ({ codigo: p.codigo, versao: p.versao, ncm: p.ncm })) }); });
    cat.produtos.filter(ehAtivo).forEach(p => { const ph = C.descricao ? C.descricao.placeholders(p.descricao) : []; if (ph.length) placeholders.push({ codigo: p.codigo, codigosInterno: p.codigosInterno, campos: ph }); });
    return { multiplos, placeholders };
  }
  C.catalogo = { lerCatalogo, indexarCatalogo, consultarCatalogo, descricaoSemCodigo, diffCatalogos, saudeCatalogo, ehAtivo };

  /* ============================== descrições ============================== */
  const STOP = new Set('DE DA DO DAS DOS E COM PARA EM A O AS OS NA NO NAS NOS POR OU UM UMA UNS UMAS AO AOS SEM SOB SOBRE THE OF AND FOR WITH TO IN ON BY OR AN AT AS IS ATE AINDA QUE SE TIPO'.split(' '));
  const radical = w => w.length > 5 ? w.replace(/(OES|AES|IS|ES|OS|AS|S)$/, '').replace(/(O|A|E)$/, '') : w;
  function palavras(t) {
    return norm(String(t == null ? '' : t).replace(/\uFFFD/g, '')).replace(/[^A-Z0-9+\-./ ]/g, ' ').split(/\s+/).map(w => w.replace(/^[\-./]+|[\-./]+$/g, '')).filter(w => w.length >= 2 && !STOP.has(w)).map(radical);
  }
  function similaridade(a, b) {
    const A = new Set(palavras(a)), B = new Set(palavras(b));
    if (!A.size || !B.size) return { jaccard: 0, contencao: 0, soA: [...A], soB: [...B], comuns: [] };
    const comuns = [...A].filter(x => B.has(x));
    return {
      jaccard: comuns.length / (A.size + B.size - comuns.length),
      contencao: comuns.length / Math.min(A.size, B.size),
      soA: [...A].filter(x => !B.has(x)), soB: [...B].filter(x => !A.has(x)), comuns
    };
  }
  const RE_PH = /\b(X{3,}|Y{3,}|Z{3,}|M{4,}|L{4,}|N{4,}|W{4,}|_{3,}|0{8,}|TBD|TBA|A DEFINIR|A INFORMAR|TO BE (DEFINED|CONFIRMED|ADVISED))\b/g;
  function placeholders(t) {
    const s = norm(t);
    const out = [...new Set((s.match(RE_PH) || []))];
    const cjk = String(t || '').match(/[　-〿㐀-鿿＀-￯]+/g);
    if (cjk) out.push(...new Set(cjk.map(x => `"${x}" (texto em chinês)`)));
    return out;
  }
  const UN_GRUPO = [
    ['potencia', /^(DBM|KW|MW|W|VA|KVA|CV|HP)$/], ['tensao', /^(VAC|VDC|KV|MV|V)$/], ['corrente', /^(MA|KA|A)$/],
    ['frequencia', /^(GHZ|MHZ|KHZ|HZ)$/], ['taxa', /^(GBPS|MBPS|KBPS|BPS|MBIT\/S|KBIT\/S|GBIT\/S)$/], ['capacidade', /^(MAH|AH|WH|KWH|TB|GB|MB|KB)$/],
    ['dimensao', /^(MM|CM)$/], ['massa', /^(KG|G)$/], ['temperatura', /^(°C|C)$/]
  ];
  const ROT = [
    ['marca', /\b(?:MARCA|BRAND|TRADEMARK)\s*[:：]?\s*([A-Z0-9][A-Z0-9\-.&]*)/g],
    ['modelo', /\b(?:MODELO|MODEL)\s*[:：]?\s*([A-Z0-9][A-Z0-9\-.\/]*)/g],
    ['ano', /\b(?:ANO\s+DE\s+FABRICACAO|ANO\s+FABRICACAO|YEAR\s+OF\s+MANUFACTURE|MANUFACTURING\s+YEAR|FABRICADO\s+EM)\s*[:：]?\s*((?:19|20)\d{2}|[A-Z]{4})/g],
    ['serie', /\b(?:NUMEROS?\s+DE\s+SERIE|N[Oº°]?\.?\s*DE\s+SERIE|SERIAL\s+(?:NO\.?|NUMBERS?)|S\/N)\s*[:：]?\s*([A-Z0-9\-]+(?:\s+(?:A|TO|ATE)\s+[A-Z0-9\-]+)?)/g],
    ['referencia', /\b(?:REFERENCIA|PART\s*(?:NO|NUMBER)|P\/N)\s*[:：]?\s*([A-Z0-9][A-Z0-9\-.\/]{2,})/g]
  ];
  const TECNO = ['WI-SUN', 'WISUN', 'LTE', 'GSM', 'GPRS', 'EDGE', 'WCDMA', 'HSDPA', 'HSUPA', 'HSPA+', 'LORA', 'NB-IOT', 'NB1', 'NB2', 'CAT-M1', 'ZIGBEE', 'BLUETOOTH', 'WI-FI', 'WIFI', 'RS485', 'RS232', 'PLC', 'FHSS', 'IPV6', 'PKI', 'MESH', 'TTL', 'PSRAM', 'PCBA', 'SMD', 'LED', 'LEDS', 'LCD'];
  function compacta(s) {
    return norm(s).replace(/(\d)\s*(?:~|\bA\b|\bTO\b|\bATE\b|-)\s*(?=[+\-]?\d)/g, '$1-').replace(/,(?=\d)/g, '.').replace(/[^A-Z0-9.\-+\/]/g, '');
  }
  function tokens(texto) {
    const t = norm(texto);
    const out = [];
    const add = (tipo, valor, bruto) => { const v = String(valor).trim(); const k = compacta(v); if (v && k && !out.some(o => o.chave === k)) out.push({ tipo, valor: v, chave: k, bruto: bruto || v }); };
    for (const [tipo, re] of ROT) { re.lastIndex = 0; let m; while ((m = re.exec(t))) add(tipo, m[1], m[0]); }
    const reUn = /(?<![A-Z0-9.])([+\-]?\d+(?:[.,]\d+)?(?:\s*(?:~|\bA\b|\bTO\b|\bATE\b|-)\s*[+\-]?\d+(?:[.,]\d+)?)?)\s*(DBM|KVA|KW|MW|VA|CV|HP|VAC|VDC|KV|MV|MA|KA|GHZ|MHZ|KHZ|HZ|GBPS|MBPS|KBPS|BPS|MBIT\/S|KBIT\/S|GBIT\/S|MAH|AH|KWH|WH|TB|GB|MB|KB|MM|CM|KG|W|V|A|G)(?![A-Z0-9])/g;
    let m;
    while ((m = reUn.exec(t))) {
      const un = m[2];
      const g = (UN_GRUPO.find(([, re]) => re.test(un)) || ['grandeza'])[0];
      if (un === 'A' && /^\s*[+\-]?\d/.test(t.slice(reUn.lastIndex))) continue;
      add(g, `${m[1].replace(/\s+/g, ' ')} ${un}`, m[0]);
    }
    TECNO.forEach(k => { if (new RegExp('(?<![A-Z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Z0-9])').test(t)) add('tecnologia', k); });
    const reCod = /(?<![A-Z0-9])(?=[A-Z0-9.\-\/]*\d)(?=[A-Z0-9.\-\/]*[A-Z])[A-Z0-9][A-Z0-9.\-\/]*[A-Z0-9](?![A-Z0-9])/g;
    while ((m = reCod.exec(t))) {
      const v = m[0];
      if (/^\d+(?:[.,]\d+)?(DBM|KVA|KW|MW|VA|VAC|VDC|KV|MV|MA|GHZ|MHZ|KHZ|HZ|GBPS|MBPS|KBPS|MAH|AH|KWH|WH|GB|MB|KB|MM|CM|KG|W|V|A|G)$/.test(v)) continue;
      if (/^(\d+\/)+\d+$/.test(v) || /^\d+(POR|DE|DO|DA|DOS|DAS|EM|E|A|O|X)$/.test(v)) continue;
      add('codigo', v);
    }
    return out;
  }
  function contemToken(tok, alvo) {
    const A = compacta(alvo);
    if (A.includes(tok.chave)) return true;
    if (/\d/.test(tok.chave) && A.replace(/O/g, '0').includes(tok.chave.replace(/O/g, '0'))) return true;
    if (tok.tipo === 'tecnologia') return A.includes(tok.chave.replace(/-/g, '')) || A.replace(/-/g, '').includes(tok.chave.replace(/-/g, ''));
    return false;
  }
  const NOMES_TIPO = { marca: 'marca', modelo: 'modelo', ano: 'ano de fabricação', serie: 'número de série', referencia: 'referência', potencia: 'potência', tensao: 'tensão', corrente: 'corrente', frequencia: 'frequência', taxa: 'taxa de transmissão', capacidade: 'capacidade', dimensao: 'dimensão', massa: 'massa', temperatura: 'temperatura', grandeza: 'grandeza', codigo: 'código/modelo', tecnologia: 'tecnologia/padrão' };
  function comparar(a, b) {
    const ta = tokens(a), tb = tokens(b);
    const faltamEmB = ta.filter(x => !contemToken(x, b));
    const faltamEmA = tb.filter(x => !contemToken(x, a));
    const s = similaridade(a, b);
    return { similaridade: s.jaccard, contencao: s.contencao, faltamEmB, faltamEmA, soA: s.soA, soB: s.soB, iguais: norm(a).replace(/[^A-Z0-9]/g, '') === norm(b).replace(/[^A-Z0-9]/g, '') };
  }
  C.descricao = { palavras, similaridade, placeholders, tokens, comparar, contemToken, compacta, NOMES_TIPO };
})(typeof self !== 'undefined' ? self : this);
