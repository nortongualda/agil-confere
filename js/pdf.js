/* Ágil Confere · PDF da análise documental (jsPDF + AutoTable, fonte Montserrat).
   Mesmo padrão visual das propostas do Ágil Desk: azul-marinho, faixa laranja/azul,
   rótulos em laranja e rodapé com numeração. */
(function () {
  'use strict';
  const COR = { navy: [12, 43, 68], azul: [11, 111, 196], ceu: [72, 165, 239], laranja: [242, 140, 40], texto: [40, 52, 64], cinza: [92, 106, 120], mudo: [125, 138, 151], linha: [222, 228, 235], fundo: [243, 247, 251], verde: [31, 157, 85], vermelho: [192, 57, 43] };
  const cache = {};
  async function carregar(url, tipo) {
    if (cache[url]) return cache[url];
    const r = await fetch(url);
    if (!r.ok) throw new Error('Não foi possível carregar ' + url);
    const buf = await r.arrayBuffer();
    let bin = '';
    const b = new Uint8Array(buf);
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    const b64 = btoa(bin);
    cache[url] = tipo === 'img' ? 'data:image/png;base64,' + b64 : b64;
    return cache[url];
  }
  const limpa = s => String(s == null ? '' : s)
    .replace(/"?[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]+"?\s*\(texto em chinês\)/g, 'escrito em chinês')
    .replace(/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]+/g, '[texto em chinês]')
    .replace(/≈/g, '~').replace(/→/g, '->').replace(/\u00a0/g, ' ');

  const fmtN = (v, casas, corte) => { let c = casas; if (corte) { const t = Math.abs(v).toFixed(casas).replace(/0+$/, ''); const dec = (t.split('.')[1] || '').length; c = Math.max(2, dec); } return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas === 5 || casas === 0 ? 0 : c, maximumFractionDigits: c }); };
  async function gerar(d) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const [reg, semi, bold, logoB, logoC] = await Promise.all([
      carregar('assets/fonts/Montserrat-Regular.ttf'), carregar('assets/fonts/Montserrat-SemiBold.ttf'), carregar('assets/fonts/Montserrat-Bold.ttf'),
      carregar('assets/logo-branca-colorida.png', 'img'), carregar('assets/logo-colorida.png', 'img')
    ]);
    doc.addFileToVFS('Mont-R.ttf', reg); doc.addFont('Mont-R.ttf', 'Mont', 'normal');
    doc.addFileToVFS('Mont-S.ttf', semi); doc.addFont('Mont-S.ttf', 'Mont', 'semibold');
    doc.addFileToVFS('Mont-B.ttf', bold); doc.addFont('Mont-B.ttf', 'Mont', 'bold');
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const M = 44, LARG = W - 2 * M, TOPO2 = 92, LIMITE = H - 104;
    const fonte = (estilo, tam, cor) => { doc.setFont('Mont', estilo); doc.setFontSize(tam); doc.setTextColor(...(cor || COR.texto)); };
    const faixa = (y, h) => {
      const x1 = W * 0.24;
      doc.setFillColor(...COR.laranja); doc.rect(0, y, x1, h, 'F');
      const passos = 60;
      for (let i = 0; i < passos; i++) {
        const t = i / (passos - 1);
        doc.setFillColor(Math.round(COR.ceu[0] + (COR.azul[0] - COR.ceu[0]) * t), Math.round(COR.ceu[1] + (COR.azul[1] - COR.ceu[1]) * t), Math.round(COR.ceu[2] + (COR.azul[2] - COR.ceu[2]) * t));
        doc.rect(x1 + (W - x1) * i / passos, y, (W - x1) / passos + 0.6, h, 'F');
      }
    };
    const rotulo = (txt, x, y, cor) => { fonte('semibold', 7, cor || COR.laranja); doc.setCharSpace(0.9); doc.text(limpa(txt).toUpperCase(), x, y); doc.setCharSpace(0); };
    const logoW = h => h * 2709 / 714;

    // ---------- capa (topo da 1ª página) ----------
    doc.setFillColor(...COR.navy); doc.rect(0, 0, W, 116, 'F');
    doc.addImage(logoB, 'PNG', M, 34, logoW(30), 30);
    rotulo('Análise documental', W - M - doc.getTextWidth('ANÁLISE DOCUMENTAL') - 9, 42);
    fonte('bold', 19, [255, 255, 255]); doc.text(limpa(d.titulo), W - M, 66, { align: 'right' });
    fonte('normal', 9, [159, 208, 247]); doc.text(limpa(d.subtitulo), W - M, 84, { align: 'right' });
    faixa(116, 5);

    // ---------- quadro do processo ----------
    let y = 142;
    const campos = d.campos || [];
    const cols = 3, linhas = Math.ceil(campos.length / cols), alt = 34;
    doc.setFillColor(...COR.fundo); doc.setDrawColor(...COR.linha);
    doc.roundedRect(M, y, LARG, linhas * alt + 14, 6, 6, 'FD');
    campos.forEach((c, i) => {
      const cx = M + 14 + (i % cols) * (LARG - 28) / cols, cy = y + 18 + Math.floor(i / cols) * alt;
      rotulo(c[0], cx, cy, COR.mudo);
      fonte('semibold', 8.6, COR.navy);
      const v = doc.splitTextToSize(limpa(c[1] || '—'), (LARG - 28) / cols - 10);
      doc.text(v.slice(0, 2), cx, cy + 12);
    });
    y += linhas * alt + 14 + 20;

    // ---------- resultado ----------
    const ok = !d.totalAjustes;
    const pill = ok ? 'EM CONFORMIDADE' : (d.pill || `${d.totalAjustes} ${d.totalAjustes === 1 ? 'PONTO DE AJUSTE' : 'PONTOS DE AJUSTE'}`);
    fonte('bold', 7.5, [255, 255, 255]);
    doc.setCharSpace(0.6);
    const pw = doc.getTextWidth(pill) + 20;
    doc.setFillColor(...(ok ? COR.verde : COR.laranja)); doc.roundedRect(M, y - 10, pw, 16, 8, 8, 'F');
    doc.text(pill, M + 10, y + 1);
    doc.setCharSpace(0);
    fonte('normal', 8.6, COR.cinza);
    doc.text(limpa(d.resumoLinha || ''), M + pw + 10, y + 1);
    y += 26;

    const comCabecalho = new Set([1]);
    const cabecalho2 = () => {
      const pg = doc.getCurrentPageInfo().pageNumber;
      if (comCabecalho.has(pg)) return;
      comCabecalho.add(pg);
      doc.addImage(logoC, 'PNG', M, 30, logoW(20), 20);
      fonte('normal', 8, COR.mudo);
      doc.text(limpa(`Análise documental  |  ${d.refCurta || ''}`), W - M, 44, { align: 'right' });
      doc.setDrawColor(...COR.linha); doc.line(M, 60, W - M, 60);
    };
    const novaPagina = () => {
      doc.addPage();
      cabecalho2();
      return TOPO2;
    };
    const garante = (h) => { if (y + h > LIMITE) y = novaPagina(); };
    const paragrafo = (txt, opt = {}) => {
      fonte(opt.estilo || 'normal', opt.tam || 9.4, opt.cor || COR.texto);
      const ls = doc.splitTextToSize(limpa(txt), opt.larg || LARG);
      ls.forEach(l => { garante(13); doc.text(l, opt.x || M, y); y += opt.lh || 13; });
    };
    if (d.saudacao) { paragrafo(d.saudacao, { estilo: 'semibold' }); y += 4; }
    if (d.intro) { paragrafo(d.intro); y += 10; }

    // ---------- seções por documento ----------
    const TAG = { ajustar: ['AJUSTAR', COR.laranja], validar: ['VALIDAR', COR.azul], ok: ['OK', COR.verde], obs: ['OBS.', COR.mudo] };
    (d.secoes || []).forEach(s => {
      garante(46);
      doc.setFillColor(...COR.laranja); doc.rect(M, y - 7, 18, 2.6, 'F');
      fonte('bold', 11, COR.navy); doc.text(limpa(s.titulo), M + 26, y - 2);
      y += 18;
      s.itens.forEach((it, i) => {
        const t = typeof it === 'string' ? { texto: it, pedido: 'obs' } : it;
        const ult = i === s.itens.length - 1;
        const texto = limpa(t.texto).replace(/[;.:\s]+$/, '') + (ult ? '.' : ';');
        const [rot, cor] = TAG[t.pedido] || TAG.obs;
        const XT = M + 62;
        fonte('normal', 9.2, COR.texto);
        const ls = doc.splitTextToSize(texto, W - M - XT);
        fonte('normal', 7.2, COR.mudo);
        const lb = t.base ? doc.splitTextToSize(limpa('Base: ' + t.base), W - M - XT) : [];
        garante(ls.length * 12.6 + lb.length * 9.5 + 6);
        fonte('bold', 6.6, [255, 255, 255]); doc.setCharSpace(0.4);
        doc.setFillColor(...cor); doc.roundedRect(M, y - 8.4, 54, 11.6, 5.8, 5.8, 'F');
        doc.text(rot, M + 27, y - 0.6, { align: 'center' }); doc.setCharSpace(0);
        fonte('normal', 9.2, COR.texto);
        ls.forEach(l => { doc.text(l, XT, y); y += 12.6; });
        if (lb.length) { fonte('normal', 7.2, COR.mudo); lb.forEach(l => { doc.text(l, XT, y - 2); y += 9.5; }); }
        y += 5;
      });
      y += 8;
    });

    // ---------- totais confrontados ----------
    const tt = d.totais;
    if (tt && tt.linhas && tt.linhas.length) {
      garante(90);
      doc.setFillColor(...COR.laranja); doc.rect(M, y - 7, 18, 2.6, 'F');
      fonte('bold', 11, COR.navy); doc.text('CONFERÊNCIA DE TOTAIS', M + 26, y - 2);
      y += 12;
      fonte('normal', 7.6, COR.cinza);
      const nota = tt.referencia === 'txt' ? 'Referência: TXT, utilizado no registro da DUIMP. Diferenças de até US$ 1,00 no valor e até 1 kg nos pesos são consideradas arredondamento.' : 'Referência: invoice. Diferenças de até US$ 1,00 no valor e até 1 kg nos pesos são consideradas arredondamento.';
      doc.splitTextToSize(nota, LARG).forEach(l => { doc.text(l, M, y); y += 10; });
      y += 2;
      const NOMES = { txt: 'TXT', invoice: 'Invoice', packing: 'Packing list', bl: 'HBL' };
      const fm = (l, v) => v == null ? '—' : l.chave === 'qtd' ? fmtN(v, 5) : l.chave === 'volumes' ? fmtN(v, 0) : fmtN(v, l.unidade === 'kg' ? 4 : 2, true);
      const corpo = tt.linhas.map(l => [l.nome].concat(tt.documentos.map(dc => { const r = l.porDoc[dc]; return r ? fm(l, r.valor) + (r.dif && Math.abs(r.dif) > 1e-9 && dc !== l.base ? `\n(${r.dif > 0 ? '+' : ''}${fm(l, r.dif)})` : '') : '—'; })).concat([Object.values(l.porDoc).every(r => r.ok) ? 'Confere' : 'Validar']));
      doc.autoTable({
        startY: y, margin: { left: M, right: M, top: TOPO2, bottom: 110 },
        head: [['Total'].concat(tt.documentos.map(dc => NOMES[dc] + (dc === tt.referencia ? ' (ref.)' : ''))).concat(['Situação'])],
        body: corpo.map(r => r.map(limpa)),
        styles: { font: 'Mont', fontStyle: 'normal', fontSize: 7.6, cellPadding: 4, textColor: COR.texto, lineColor: COR.linha, lineWidth: 0.4, halign: 'right' },
        headStyles: { font: 'Mont', fontStyle: 'bold', fillColor: COR.navy, textColor: [255, 255, 255], fontSize: 7.4, halign: 'right' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'semibold' } },
        didParseCell: c => { if (c.section === 'body' && c.column.index === c.table.columns.length - 1) { c.cell.styles.halign = 'center'; c.cell.styles.fontStyle = 'bold'; c.cell.styles.textColor = c.cell.raw === 'Confere' ? COR.verde : COR.laranja; } if (c.section === 'head' && c.column.index === 0) c.cell.styles.halign = 'left'; },
        didDrawPage: () => cabecalho2()
      });
      y = doc.lastAutoTable.finalY + 22;
    }

    // ---------- observações ----------
    if (d.observacoes && d.observacoes.trim()) {
      fonte('normal', 9.2, COR.texto);
      const ls = doc.splitTextToSize(limpa(d.observacoes.trim()), LARG - 28);
      garante(ls.length * 12.5 + 40);
      const h = ls.length * 12.5 + 30;
      doc.setFillColor(...COR.fundo); doc.setDrawColor(...COR.linha); doc.roundedRect(M, y - 4, LARG, h, 6, 6, 'FD');
      doc.setFillColor(...COR.ceu); doc.rect(M, y - 4, 3, h, 'F');
      rotulo('Observações', M + 14, y + 10, COR.azul);
      fonte('normal', 9.2, COR.texto);
      let yy = y + 24;
      ls.forEach(l => { doc.text(l, M + 14, yy); yy += 12.5; });
      y += h + 14;
    }

    // ---------- detalhamento por item ----------
    if (d.detalhes && d.detalhes.length) {
      garante(70);
      doc.setFillColor(...COR.laranja); doc.rect(M, y - 7, 18, 2.6, 'F');
      fonte('bold', 11, COR.navy); doc.text('DETALHAMENTO POR ITEM', M + 26, y - 2);
      y += 10;
      doc.autoTable({
        startY: y, margin: { left: M, right: M, top: TOPO2, bottom: 110 },
        head: [['Item', 'Documento', 'Campo', 'Encontrado', 'Esperado']],
        body: d.detalhes.map(r => [r.item, r.documento, r.campo, r.encontrado, r.esperado].map(limpa)),
        styles: { font: 'Mont', fontStyle: 'normal', fontSize: 7.4, cellPadding: 4, textColor: COR.texto, lineColor: COR.linha, lineWidth: 0.4, overflow: 'linebreak' },
        headStyles: { font: 'Mont', fontStyle: 'bold', fillColor: COR.navy, textColor: [255, 255, 255], fontSize: 7.2 },
        alternateRowStyles: { fillColor: [247, 250, 253] },
        columnStyles: { 0: { cellWidth: 118, fontStyle: 'semibold', fontSize: 7 }, 1: { cellWidth: 66 }, 2: { cellWidth: 64 } },
        didDrawPage: () => cabecalho2()
      });
      y = doc.lastAutoTable.finalY + 22;
    }

    // ---------- encerramento ----------
    if (d.fechamento && d.fechamento.trim()) { garante(30); paragrafo(d.fechamento); }

    // ---------- rodapé em todas as páginas ----------
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...COR.linha); doc.line(M, H - 86, W - M, H - 86);
      let yr = H - 74;
      (d.rodape || []).forEach((t, i) => {
        fonte(i === 0 ? 'semibold' : 'normal', 6.8, i === 0 ? COR.navy : COR.cinza);
        doc.splitTextToSize(limpa(t), LARG - 50).slice(0, i === 1 ? 1 : 2).forEach(l => { doc.text(l, M, yr); yr += 8.6; });
      });
      fonte('normal', 6.6, COR.mudo);
      doc.text('Ágil Soluções Aduaneiras  ·  comercial@agiladuaneira.com.br  ·  +55 85 3046.3003', M, H - 20);
      fonte('bold', 8.6, COR.navy);
      const pn = `${String(p).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      doc.text(pn, W - M, H - 20, { align: 'right' });
      doc.setFillColor(...COR.laranja); doc.rect(W - M - doc.getTextWidth(pn) - 13, H - 26.5, 7, 7, 'F');
      faixa(H - 7, 7);
    }
    doc.setProperties({ title: limpa(d.titulo + ' · ' + (d.refCurta || '')), author: 'Ágil Soluções Aduaneiras', creator: 'Ágil Confere' });
    return doc.output('blob');
  }
  window.ConferePDF = { gerar };
})();
