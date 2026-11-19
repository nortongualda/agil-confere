/* Ágil Confere · leitura de PDF e imagem no navegador (sem custo, sem enviar o documento a terceiros).
   PDF com texto: pdf.js lê as palavras e as posições. PDF escaneado ou foto: Tesseract (OCR) reconhece o texto.
   Em ambos os casos a página é desenhada para achar as linhas de tabela, e a grade final sai do núcleo
   (Confere.pdfgrade), no mesmo formato das planilhas. */
(function () {
  'use strict';
  const C = window.Confere;
  const AQUI = (document.currentScript && document.currentScript.src) || (location.href.replace(/[^/]*$/, '') + 'js/leitorpdf.js');
  const VENDOR = new URL('vendor/', AQUI).href;
  const MIN_CARACTERES_TEXTO = 40;

  /* ---------------- bibliotecas (carregadas só quando precisa) ---------------- */
  let pdfjsP = null, tessP = null, workerP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(VENDOR + 'pdfjs/pdf.min.js').then(m => { m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.js'; return m; });
    return pdfjsP;
  }
  function tesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessP) tessP = new Promise((ok, erro) => { const s = document.createElement('script'); s.src = VENDOR + 'tesseract/tesseract.min.js'; s.onload = () => ok(window.Tesseract); s.onerror = () => erro(new Error('Não foi possível carregar o leitor de imagem (OCR).')); document.head.appendChild(s); });
    return tessP;
  }
  async function workerOcr(progresso) {
    if (!workerP) {
      workerP = (async () => {
        const T = await tesseract();
        const w = await T.createWorker(['eng', 'por'], 1, {
          workerPath: VENDOR + 'tesseract/worker.min.js', corePath: VENDOR + 'tesseract/core', langPath: VENDOR + 'tesseract/lang', gzip: true,
          logger: m => { if (workerP && workerP.aoProgresso && m && m.status === 'recognizing text') workerP.aoProgresso(m.progress); }
        });
        await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '300' });
        return w;
      })();
      workerP.catch(() => { workerP = null; });
    }
    const w = await workerP;
    return w;
  }

  /* ---------------- desenho da página ---------------- */
  async function desenhar(page, escala) {
    const vp = page.getViewport({ scale: escala });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvas: cv, canvasContext: ctx, viewport: vp, background: '#ffffff' }).promise;
    return cv;
  }
  function mapaEscuro(cv, limiar) {
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const { width: W, height: H } = cv;
    const px = ctx.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < m.length; i++, j += 4) m[i] = (px[j] * 299 + px[j + 1] * 587 + px[j + 2] * 114) / 1000 < limiar ? 1 : 0;
    return { m, W, H };
  }
  // linhas de tabela: trechos escuros longos (horizontais e verticais), em pontos
  function detectarReguas(cv, escala, fator) {
    const fz = fator || 1;
    const { m, W, H } = mapaEscuro(cv, 170);
    const minH = Math.round(24 * escala * fz), minV = Math.round(14 * escala * fz), folga = Math.max(1, Math.round(escala * 0.6 * fz));
    const hs = [];
    for (let y = 0; y < H; y++) {
      const base = y * W;
      let x = 0;
      while (x < W) {
        if (!m[base + x]) { x++; continue; }
        let x1 = x, buraco = 0, k = x;
        while (k < W && buraco <= folga) { if (m[base + k]) { x1 = k; buraco = 0; } else buraco++; k++; }
        if (x1 - x + 1 >= minH) hs.push({ y, x0: x, x1 });
        x = k;
      }
    }
    const vs = [];
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H) {
        if (!m[y * W + x]) { y++; continue; }
        let y1 = y, buraco = 0, k = y;
        while (k < H && buraco <= folga) { if (m[k * W + x]) { y1 = k; buraco = 0; } else buraco++; k++; }
        if (y1 - y + 1 >= minV) vs.push({ x, y0: y, y1 });
        y = k;
      }
    }
    // junta trechos de linhas vizinhas (espessura) e descarta faixas grossas (fundo de célula)
    const juntar = (lista, pos, a, b) => {
      lista.sort((p, q) => p[pos] - q[pos] || p[a] - q[a]);
      const out = [];
      for (const s of lista) {
        const g = out.find(o => s[pos] - o.fim <= 1 && Math.min(o[b], s[b]) - Math.max(o[a], s[a]) > 0.5 * Math.min(o[b] - o[a], s[b] - s[a]));
        if (g) { g.fim = s[pos]; g[a] = Math.min(g[a], s[a]); g[b] = Math.max(g[b], s[b]); g.n++; }
        else out.push(Object.assign({}, s, { ini: s[pos], fim: s[pos], n: 1 }));
      }
      return out;
    };
    const esp = 3.5 * escala * fz;
    const H2 = [], V2 = [];
    juntar(hs, 'y', 'x0', 'x1').forEach(g => {
      const e = g.fim - g.ini + 1;
      if (e <= esp) H2.push({ y: (g.ini + g.fim) / 2 / escala, x0: g.x0 / escala, x1: g.x1 / escala });
      else { H2.push({ y: g.ini / escala, x0: g.x0 / escala, x1: g.x1 / escala }); H2.push({ y: g.fim / escala, x0: g.x0 / escala, x1: g.x1 / escala }); }
    });
    juntar(vs, 'x', 'y0', 'y1').forEach(g => {
      const e = g.fim - g.ini + 1;
      if (e <= esp) V2.push({ x: (g.ini + g.fim) / 2 / escala, y0: g.y0 / escala, y1: g.y1 / escala });
    });
    return { h: H2, v: V2, raw: { hs, vs } };
  }
  // inclinação do scan (graus), pelo perfil de projeção horizontal
  function estimarInclinacao(cv) {
    const red = 4;
    const W = Math.floor(cv.width / red), H = Math.floor(cv.height / red);
    const t = document.createElement('canvas'); t.width = W; t.height = H;
    const c2 = t.getContext('2d', { willReadFrequently: true }); c2.drawImage(cv, 0, 0, W, H);
    const { m } = mapaEscuro(t, 140);
    const pts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) pts.push(x, y);
    if (pts.length < 200) return 0;
    let melhor = 0, nota = -1;
    const avaliar = a => {
      const s = Math.sin(a * Math.PI / 180), c = Math.cos(a * Math.PI / 180);
      const hist = new Float64Array(H * 2 + 10);
      for (let i = 0; i < pts.length; i += 2) { const y = Math.round(pts[i + 1] * c - pts[i] * s) + H; if (y >= 0 && y < hist.length) hist[y]++; }
      let v = 0; for (let i = 1; i < hist.length; i++) { const d = hist[i] - hist[i - 1]; v += d * d; }
      return v;
    };
    for (let a = -3; a <= 3.0001; a += 0.25) { const v = avaliar(a); if (v > nota) { nota = v; melhor = a; } }
    for (let a = melhor - 0.25; a <= melhor + 0.25; a += 0.05) { const v = avaliar(a); if (v > nota) { nota = v; melhor = a; } }
    return melhor;
  }
  function girar(cv, graus) {
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
    const ctx = o.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, o.width, o.height);
    ctx.translate(o.width / 2, o.height / 2); ctx.rotate(-graus * Math.PI / 180); ctx.drawImage(cv, -cv.width / 2, -cv.height / 2);
    return o;
  }
  function apagarReguas(cv, reguas, escala) {
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
    const ctx = o.getContext('2d'); ctx.drawImage(cv, 0, 0); ctx.fillStyle = '#fff';
    const e = Math.max(2, Math.round(1.2 * escala));
    reguas.h.forEach(r => ctx.fillRect(r.x0 * escala - 1, r.y * escala - e, (r.x1 - r.x0) * escala + 2, 2 * e));
    reguas.v.forEach(r => ctx.fillRect(r.x * escala - e, r.y0 * escala - 1, 2 * e, (r.y1 - r.y0) * escala + 2));
    return o;
  }

  /* ---------------- texto do PDF ---------------- */
  let ctxMedida = null;
  const cacheMedida = new Map();
  function medir(t) {
    if (!t) return 0;
    if (cacheMedida.has(t)) return cacheMedida.get(t);
    if (!ctxMedida) { ctxMedida = document.createElement('canvas').getContext('2d'); ctxMedida.font = '100px Helvetica, Arial, sans-serif'; }
    const v = ctxMedida.measureText(t).width;
    if (cacheMedida.size < 20000) cacheMedida.set(t, v);
    return v;
  }
  function palavrasDoTexto(tc, vp, lib) {
    const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = lib.Util.transform(vp.transform, it.transform);
      if (Math.abs(m[1]) > Math.abs(m[0]) * 0.25 || m[0] <= 0) continue; // só texto horizontal
      const fh = Math.hypot(m[2], m[3]) || 1;
      const st = (tc.styles && tc.styles[it.fontName]) || {};
      let asc = st.ascent, desc = st.descent;
      if (!(asc > 0.4 && asc < 1.3)) asc = 0.8;
      if (!(desc < 0 && desc > -0.6)) desc = -0.2;
      const x0 = m[4], yb = m[5], w = it.width * vp.scale;
      if (!(w > 0)) continue;
      const y0 = yb - fh * asc, y1 = yb - fh * desc;
      // divide em palavras com posição medida (o pdf.js às vezes junta células vizinhas num só trecho)
      const s = it.str, total = medir(s);
      if (!/\s/.test(s.trim()) || !total) { out.push({ t: s, x0, x1: x0 + w, y0, y1 }); continue; }
      const k = w / total;
      const re = /\S+/g; let mm;
      while ((mm = re.exec(s))) { const a = medir(s.slice(0, mm.index)) * k; out.push({ t: mm[0], x0: x0 + a, x1: x0 + a + medir(mm[0]) * k, y0, y1 }); }
    }
    return out;
  }

  /* ---------------- OCR ---------------- */
  async function ocrCanvas(cv, escala, aoProgresso) {
    const w = await workerOcr();
    if (workerP) workerP.aoProgresso = aoProgresso;
    const r = await w.recognize(cv, {}, { blocks: true, text: false });
    const toks = [];
    const blocos = (r.data && r.data.blocks) || [];
    blocos.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(wd => {
      const t = String(wd.text || '').trim();
      if (!t) return;
      const bb = wd.bbox;
      if (!bb || bb.x1 <= bb.x0) return;
      // altura da linha (não da palavra) deixa as palavras da mesma linha alinhadas
      const lb = l.bbox || bb;
      toks.push({ t, x0: bb.x0 / escala, x1: bb.x1 / escala, y0: Math.max(bb.y0, lb.y0) / escala, y1: Math.min(Math.max(bb.y1, lb.y0 + 1), lb.y1) / escala, conf: wd.confidence });
    }))));
    return toks;
  }

  /* ---------------- leitura completa ---------------- */
  async function lerPDF(buf, opcoes) {
    const op = Object.assign({ nome: 'PDF', ocr: 'auto', progresso: () => {} }, opcoes || {});
    const t0 = performance.now();
    const lib = await pdfjs();
    let doc, tarefa;
    try {
      tarefa = lib.getDocument({ data: new Uint8Array(buf.slice(0)), cMapUrl: VENDOR + 'pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'pdfjs/standard_fonts/', wasmUrl: VENDOR + 'pdfjs/wasm/', iccUrl: VENDOR + 'pdfjs/iccs/', isEvalSupported: false, enableXfa: false, useSystemFonts: false });
      doc = await tarefa.promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('O PDF está protegido por senha. Peça ao cliente uma versão sem senha.');
      throw new Error('Não consegui abrir o PDF (' + ((e && e.message) || e) + ').');
    }
    const paginas = [], avisos = [];
    let usouOcr = false, somaConf = 0, nConf = 0, baixas = 0;
    const total = doc.numPages;
    if (total > 40) avisos.push(`PDF com ${total} páginas: li as 40 primeiras.`);
    const IA = window.ConfereIA;
    let comIA = !!(op.ia && IA && IA.disponivel(op.ia));
    const filaIA = [];
    async function ocrTesseract(page, vp, n) {
      const esc = Math.min(3.5, (window.CONFERE_OCR_PX || 5000) / Math.max(vp.width, vp.height));
      const fz = Math.max(1, Math.max(vp.width, vp.height) / 842);
      let cv = await desenhar(page, esc);
      const inclinacao = estimarInclinacao(cv);
      if (Math.abs(inclinacao) >= 0.1) cv = girar(cv, inclinacao);
      let reguas = detectarReguas(cv, esc, fz);
      // muitas "linhas" = ruído da foto (furos, textura): não apaga nada antes do OCR
      const limpo = reguas.h.length + reguas.v.length > 400 ? cv : apagarReguas(cv, reguas, esc);
      if (limpo === cv) reguas = { h: [], v: [] };
      op.progresso(`Reconhecendo o texto da página ${n} de ${total} (documento escaneado)…`);
      const tokens = await ocrCanvas(limpo, esc, p => op.progresso(`Reconhecendo o texto da página ${n} de ${total}: ${Math.round((p || 0) * 100)}%`));
      tokens.forEach(t => { if (t.conf != null) { somaConf += t.conf; nConf++; if (t.conf < 80) baixas++; } });
      if (limpo !== cv) { limpo.width = limpo.height = 0; } cv.width = cv.height = 0;
      return { tokens, reguas, inclinacao };
    }
    function guardar(n, vp, tokens, reguas, ocr, inclinacao) {
      const f = Math.max(vp.width, vp.height) > 1300 ? Math.max(vp.width, vp.height) / 842 : 1;
      if (f !== 1) {
        tokens.forEach(t => { t.x0 /= f; t.x1 /= f; t.y0 /= f; t.y1 /= f; });
        reguas.h.forEach(r => { r.y /= f; r.x0 /= f; r.x1 /= f; }); reguas.v.forEach(r => { r.x /= f; r.y0 /= f; r.y1 /= f; });
      }
      paginas.push({ numero: n, largura: vp.width / f, altura: vp.height / f, tokens, h: reguas.h, v: reguas.v, ocr, inclinacao });
    }
    for (let n = 1; n <= Math.min(total, 40); n++) {
      op.progresso(`Lendo página ${n} de ${total}…`);
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      let tokens = palavrasDoTexto(tc, vp, lib);
      const caracteres = tokens.reduce((s, t) => s + t.t.replace(/\s/g, '').length, 0);
      const precisaOcr = op.ocr === 'sempre' || (op.ocr === 'auto' && caracteres < MIN_CARACTERES_TEXTO);
      if (!precisaOcr) {
        const cv = await desenhar(page, 2);
        const reguas = detectarReguas(cv, 2);
        cv.width = cv.height = 0;
        guardar(n, vp, tokens, reguas, false, 0);
      } else if (comIA) {
        // imagem para a IA: ~2.600 px no lado maior
        const cv = await desenhar(page, Math.min(4, 2600 / Math.max(vp.width, vp.height)));
        filaIA.push({ numero: n, imagem: IA._interno.imagemDaPagina(cv) });
        cv.width = cv.height = 0;
      } else {
        usouOcr = true;
        const o = await ocrTesseract(page, vp, n);
        guardar(n, vp, o.tokens, o.reguas, true, o.inclinacao);
      }
      page.cleanup();
    }
    // leitura pela IA (páginas escaneadas)
    let abasIA = [], custo = 0, paginasIA = 0, relidos = 0;
    if (filaIA.length) {
      let feitas = 0, falhou = null;
      op.progresso(`Leitura por IA de ${filaIA.length} página(s) escaneada(s) (estimativa US$ ${(filaIA.length * IA.ESTIMATIVA_PAGINA).toFixed(2)})…`);
      const res = await IA.emParalelo(filaIA.map(p => async () => {
        if (falhou) return { numero: p.numero, erro: falhou };
        try {
          const r = await IA.lerPagina(p.imagem, { arquivo: op.nome, pagina: p.numero });
          custo += r.custo || 0;
          op.progresso(`Leitura por IA: ${++feitas} de ${filaIA.length} página(s)…`);
          return { numero: p.numero, dados: r.pagina };
        } catch (e) {
          if (e.codigo === 'limite' || e.codigo === 'sem_chave' || e.codigo === 'desligada') falhou = e.message;
          return { numero: p.numero, erro: e.message };
        }
      }), 4);
      const okIA = res.filter(r => r.dados);
      // conferência: itens que não fecham na conta são relidos uma vez
      const susp = IA.suspeitos(okIA, op.nome);
      if (susp.size) {
        op.progresso(`Relendo ${[...susp.values()].reduce((a, x) => a + x.length, 0)} item(ns) que não fecharam na conta…`);
        await IA.emParalelo([...susp.entries()].map(([pg, seqs]) => async () => {
          const alvo = okIA.find(r => r.numero === pg), img = filaIA.find(p => p.numero === pg);
          try {
            const r = await IA.lerPagina(img.imagem, { arquivo: op.nome, pagina: pg, etapa: 'releitura', dica: `RELEITURA. Transcreva SOMENTE os itens de número ${seqs.join(', ')} desta página, conferindo dígito por dígito quantidade, preço unitário, valor total e pesos. Copie o que está impresso, mesmo que a conta do documento não feche.` });
            custo += r.custo || 0;
            relidos += IA.aplicarReleitura(alvo, r.pagina);
          } catch (e) { /* mantém a primeira leitura */ }
        }), 4);
      }
      abasIA = okIA.length ? IA.montarAbas(okIA, op.nome) : [];
      paginasIA = okIA.length;
      // páginas que a IA não leu voltam para o reconhecimento local
      const sobras = res.filter(r => !r.dados);
      if (sobras.length) {
        avisos.push(`Leitura por IA indisponível em ${sobras.length} página(s) (${sobras[0].erro}). Usei o reconhecimento local, que é menos preciso.`);
        for (const s of sobras) {
          const page = await doc.getPage(s.numero), vp = page.getViewport({ scale: 1 });
          usouOcr = true;
          const o = await ocrTesseract(page, vp, s.numero);
          guardar(s.numero, vp, o.tokens, o.reguas, true, o.inclinacao);
          page.cleanup();
        }
        paginas.sort((a, b) => a.numero - b.numero);
      }
    }
    try { await tarefa.destroy(); } catch (e) { /* ok */ }
    const r = paginas.length ? C.pdfgrade.montar(paginas, { nome: op.nome }) : { abas: [], segmentos: [] };
    return {
      abas: abasIA.concat(r.abas), segmentos: r.segmentos, paginas: paginas.length + paginasIA, ocr: usouOcr, ia: paginasIA ? { paginas: paginasIA, custo, relidos } : null,
      confianca: nConf ? Math.round(somaConf / nConf) : null, palavrasDuvidosas: baixas,
      tempo: Math.round(performance.now() - t0), avisos, bruto: op.bruto ? paginas : undefined
    };
  }
  async function lerImagem(arquivo, opcoes) {
    const op = Object.assign({ nome: 'Imagem', progresso: () => {} }, opcoes || {});
    const t0 = performance.now();
    const bmp = await createImageBitmap(arquivo instanceof Blob ? arquivo : new Blob([arquivo]));
    const IA = window.ConfereIA;
    if (op.ia && IA && IA.disponivel(op.ia)) {
      try {
        const cv0 = document.createElement('canvas'); cv0.width = bmp.width; cv0.height = bmp.height;
        cv0.getContext('2d').drawImage(bmp, 0, 0);
        op.progresso('Leitura por IA da imagem…');
        const imagem = IA._interno.imagemDaPagina(cv0); cv0.width = cv0.height = 0;
        const r = await IA.lerPagina(imagem, { arquivo: op.nome, pagina: 1 });
        let custo = r.custo || 0, relidos = 0;
        const pg = [{ numero: 1, dados: r.pagina }];
        const susp = IA.suspeitos(pg, op.nome);
        if (susp.size) {
          op.progresso('Relendo itens que não fecharam na conta…');
          try {
            const rr = await IA.lerPagina(imagem, { arquivo: op.nome, pagina: 1, etapa: 'releitura', dica: `RELEITURA. Transcreva SOMENTE os itens de número ${susp.get(1).join(', ')}, conferindo dígito por dígito quantidade, preço unitário, valor total e pesos. Copie o que está impresso, mesmo que a conta do documento não feche.` });
            custo += rr.custo || 0; relidos = IA.aplicarReleitura(pg[0], rr.pagina);
          } catch (e) { /* mantém a primeira leitura */ }
        }
        return { abas: IA.montarAbas(pg, op.nome), segmentos: [], paginas: 1, ocr: false, ia: { paginas: 1, custo, relidos }, confianca: null, palavrasDuvidosas: 0, tempo: Math.round(performance.now() - t0), avisos: [] };
      } catch (e) {
        op.aviso = `Leitura por IA indisponível (${e.message}). Usei o reconhecimento local, que é menos preciso.`;
      }
    }
    // escala para ~300 dpi em A4 (lado maior perto de 3500 px)
    const fator = Math.min(3, Math.max(1, 3500 / Math.max(bmp.width, bmp.height)));
    let cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * fator); cv.height = Math.round(bmp.height * fator);
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    // tamanho "em pontos" como se fosse uma página A4
    const pts = Math.max(cv.width, cv.height) / 842;
    const inc = estimarInclinacao(cv);
    if (Math.abs(inc) >= 0.1) cv = girar(cv, inc);
    const reguas = detectarReguas(cv, pts);
    const limpo = apagarReguas(cv, reguas, pts);
    op.progresso('Reconhecendo o texto da imagem…');
    const tokens = await ocrCanvas(limpo, pts, p => op.progresso(`Reconhecendo o texto da imagem: ${Math.round((p || 0) * 100)}%`));
    let somaConf = 0, nConf = 0, baixas = 0;
    tokens.forEach(t => { if (t.conf != null) { somaConf += t.conf; nConf++; if (t.conf < 80) baixas++; } });
    const r = C.pdfgrade.montar([{ numero: 1, largura: cv.width / pts, altura: cv.height / pts, tokens, h: reguas.h, v: reguas.v, ocr: true, inclinacao: inc }], { nome: op.nome });
    return { abas: r.abas, segmentos: r.segmentos, paginas: 1, ocr: true, confianca: nConf ? Math.round(somaConf / nConf) : null, palavrasDuvidosas: baixas, tempo: Math.round(performance.now() - t0), avisos: op.aviso ? [op.aviso] : [] };
  }

  window.ConfereLeitor = { lerPDF, lerImagem, _interno: { detectarReguas, estimarInclinacao, palavrasDoTexto, desenhar, pdfjs } };
})();
