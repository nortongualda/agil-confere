/* Ágil Confere · aplicação (tela, Supabase, fluxo de análise).
   Dados: Supabase (projeto agil-desk, tabelas confere_*). Leitura e regras: js/nucleo. */
(function () {
  'use strict';
  const CFG = window.AGIL_CONFIG;
  const C = window.Confere, U = C.util, R = C.regras, K = C.catalogo, D = C.descricao;
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'agil-confere-auth' } });
  const SEM_CI = '(sem código interno)';
  const FASES = { pre_alerta: 'Pré-alerta', pre_registro: 'Pré-registro' };
  const TIPOS = { invoice_packing: 'Invoice + Packing List', invoice: 'Invoice', packing: 'Packing List', bl: 'Draft HBL', txt: 'TXT (TOTVS)', relatorio: 'Relatório de itens', ce: 'CE Mercante', outro: 'Outro' };
  const SEV_NOME = { bloqueante: 'Bloqueante', alerta: 'Alerta', info: 'Informativo' };
  const DOCS_ACAO = ['Invoice', 'Packing List', 'HBL', 'CE Mercante', 'TXT', 'Relatório de itens', 'Catálogo de Produtos', 'Outro'];
  let EU = null, IMP = null, CAT = null, REGRAS_DB = null, ACESSO = [];

  /* ---------------- utilidades de tela ---------------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const dataCurta = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
  const sev = s => `<span class="badge sev-${s}">${esc(SEV_NOME[s] || s)}</span>`;
  const chipsResumo = r => r ? `<span class="chips">${r.bloqueantes ? `<span class="badge sev-bloqueante">${r.bloqueantes} bloq.</span>` : ''}${r.alertas ? `<span class="badge sev-alerta">${r.alertas} alertas</span>` : ''}${r.infos ? `<span class="badge sev-info">${r.infos} info</span>` : ''}${!r.bloqueantes && !r.alertas ? '<span class="badge sev-ok">sem pendências</span>' : ''}</span>` : '—';
  const view = () => $('#view');
  function toast(msg, erro) {
    let pilha = $('#toasts');
    if (!pilha) { pilha = document.createElement('div'); pilha.id = 'toasts'; pilha.style.cssText = 'position:fixed;right:22px;bottom:22px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;z-index:400'; document.body.appendChild(pilha); }
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' er' : '');
    t.style.position = 'static';
    t.textContent = msg;
    pilha.appendChild(t);
    setTimeout(() => t.remove(), erro ? 6500 : 3200);
  }
  function erroMsg(e) { return (e && (e.message || e.error_description || e.erro)) || String(e); }
  function modal({ titulo, corpo, botoes = [], largo }) {
    const f = document.createElement('div');
    f.className = 'mdl-f';
    f.innerHTML = `<div class="mdl ${largo ? 'lg' : ''}"><div class="mh"><b>${esc(titulo)}</b><button class="x" data-x>&times;</button></div><div class="mb">${corpo}</div><div class="mf"></div></div>`;
    const fechar = () => f.remove();
    f.querySelector('[data-x]').onclick = fechar;
    const mf = f.querySelector('.mf');
    botoes.forEach(b => {
      const el = document.createElement('button');
      el.className = b.cls || 'bt2';
      el.textContent = b.txt;
      el.onclick = async () => {
        if (!b.acao) return fechar();
        el.disabled = true;
        try { const r = await b.acao(f); if (r !== false) fechar(); } catch (e) { toast(erroMsg(e), true); } finally { el.disabled = false; }
      };
      mf.appendChild(el);
    });
    document.body.appendChild(f);
    return { el: f, fechar };
  }
  async function dados(q) { const r = await q; if (r.error) throw r.error; return r.data; }
  async function todos(fabrica) {
    const out = [];
    for (let de = 0; ; de += 1000) {
      const lote = await dados(fabrica().range(de, de + 999));
      out.push(...lote);
      if (lote.length < 1000) break;
    }
    return out;
  }
  async function hashArquivo(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const nomeSeguro = n => U.semAc(n).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);
  function baixar(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function baixarArquivo(caminho, nome) {
    try { const { data, error } = await sb.storage.from('confere').download(caminho); if (error) throw error; baixar(data, nome); } catch (e) { toast('Não foi possível baixar: ' + erroMsg(e), true); }
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); toast('Texto copiado. Cole no e-mail.'); } catch (e) { modal({ titulo: 'Copie o texto', corpo: `<textarea class="in" style="min-height:360px">${esc(texto)}</textarea>`, botoes: [{ txt: 'Fechar' }] }); }
  }

  /* ---------------- login ---------------- */
  const cssLogin = `#login{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0C2B44,#0b4f8a)}
  #login .bx{background:#fff;border-radius:16px;padding:34px 34px 28px;width:min(400px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.3)}
  #login img{height:40px;display:block;margin-bottom:18px}#login h1{font-size:20px;color:#0C2B44;margin:0 0 4px}#login p{color:#6a7886;font-size:13px;margin:0 0 18px}
  #login label{display:block;font-size:11px;font-weight:700;color:#6a7886;text-transform:uppercase;letter-spacing:.05em;margin:12px 0 5px}
  #login input{width:100%;border:1px solid #dde3ea;border-radius:8px;padding:11px 12px;font-size:14px}
  #login button{width:100%;margin-top:18px;border:0;border-radius:8px;padding:12px;background:#F28C28;color:#fff;font-weight:700;font-size:14px}
  #login .msg{margin-top:12px;font-size:12.5px;color:#c0392b;min-height:16px}`;
  function telaLogin(modo, aviso) {
    let el = $('#login');
    if (!el) { const st = document.createElement('style'); st.textContent = cssLogin; document.head.appendChild(st); el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
    if (modo === 'senha') {
      el.innerHTML = `<form class="bx"><img src="assets/logo-colorida.png" alt="Ágil Aduaneira"><h1>Crie sua senha</h1><p>Primeiro acesso: escolha uma senha com pelo menos 8 caracteres.</p>
      <label for="ns1">Nova senha</label><input type="password" id="ns1" minlength="8" required autocomplete="new-password"><label for="ns2">Repita a senha</label><input type="password" id="ns2" minlength="8" required autocomplete="new-password">
      <button type="submit">Salvar senha e entrar</button><div class="msg" id="lmsg"></div></form>`;
      el.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const a = $('#ns1').value, b = $('#ns2').value, m = $('#lmsg');
        if (a.length < 8) { m.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
        if (a !== b) { m.textContent = 'As senhas não conferem.'; return; }
        const { error } = await sb.auth.updateUser({ password: a, data: { trocar_senha: false } });
        if (error) { m.textContent = 'Não foi possível salvar: ' + error.message; return; }
        const { data } = await sb.auth.getSession();
        entrar(data.session, true);
      };
      return;
    }
    el.innerHTML = `<form class="bx"><img src="assets/logo-colorida.png" alt="Ágil Aduaneira"><h1>Ágil Confere</h1><p>Verificação e análise documental da Ágil Aduaneira</p>
    <label for="lem">E-mail</label><input type="email" id="lem" required autocomplete="username" placeholder="seu.nome@agiladuaneira.com.br">
    <label for="lpw">Senha</label><input type="password" id="lpw" required autocomplete="current-password">
    <button type="submit">Entrar</button><div class="msg" id="lmsg"></div></form>`;
    if (aviso) $('#lmsg').textContent = aviso;
    el.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const m = $('#lmsg'); m.textContent = 'Entrando…';
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#lem').value.trim(), password: $('#lpw').value });
      if (error) { m.textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message; return; }
      entrar(data.session);
    };
  }
  let iniciado = false;
  async function entrar(session, aposTroca) {
    if (!session) return telaLogin();
    const email = String(session.user.email || '').toLowerCase();
    let lista = [];
    try { lista = await dados(sb.from('confere_acesso').select('email,nome,papel,ativo')); } catch (e) { lista = []; }
    const meu = lista.find(x => String(x.email).toLowerCase() === email && x.ativo);
    if (!meu) { await sb.auth.signOut(); return telaLogin(null, 'Este e-mail não tem acesso ao Ágil Confere. Fale com um usuário master.'); }
    if (!aposTroca && session.user.user_metadata && session.user.user_metadata.trocar_senha) return telaLogin('senha');
    ACESSO = lista;
    EU = { email, nome: meu.nome || email, papel: meu.papel };
    const el = $('#login'); if (el) el.remove();
    $('#usr').innerHTML = `<b>${esc(EU.nome)}</b>${EU.papel === 'master' ? 'Master' : 'Analista'}<br><a href="#" id="trocarSenha">Alterar senha</a><a href="#" id="sair">Sair</a>`;
    $('#sair').onclick = async ev => { ev.preventDefault(); await sb.auth.signOut(); location.hash = ''; location.reload(); };
    $('#trocarSenha').onclick = ev => { ev.preventDefault(); telaLogin('senha'); };
    $$('.so-master').forEach(b => b.classList.toggle('hide', EU.papel !== 'master'));
    if (!iniciado) {
      iniciado = true;
      try {
        const imps = await dados(sb.from('confere_importadores').select('*').eq('cnpj', CFG.importadorCnpj));
        IMP = imps[0];
        if (!IMP) throw new Error('Importador não cadastrado.');
      } catch (e) { view().innerHTML = `<div class="card empty">Não foi possível carregar o cadastro do importador: ${esc(erroMsg(e))}</div>`; return; }
      window.addEventListener('hashchange', rota);
      $('#menu').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) location.hash = b.dataset.v; });
      rota();
      contadores();
      setInterval(contadores, 60000);
    }
  }

  /* ---------------- dados de apoio ---------------- */
  async function contadores() {
    try {
      const [oc, al] = await Promise.all([
        sb.from('confere_ocorrencias').select('id', { count: 'exact', head: true }).eq('status', 'aberta').in('severidade', ['bloqueante', 'alerta']),
        sb.from('confere_alertas').select('id', { count: 'exact', head: true }).eq('status', 'aberto')
      ]);
      const put = (id, n) => { const e = $(id); e.textContent = n || 0; e.classList.toggle('z', !n); };
      put('#cntOc', oc.count); put('#cntAl', al.count);
    } catch (e) { /* silencioso */ }
  }
  async function carregarCatalogo(forcar) {
    if (CAT !== null && !forcar) return CAT;
    const vs = await dados(sb.from('confere_catalogo_versoes').select('*').eq('importador_id', IMP.id).order('gerado_em', { ascending: false, nullsFirst: false }).order('carregado_em', { ascending: false }).limit(1));
    if (!vs.length) { CAT = undefined; return undefined; }
    const v = vs[0];
    const linhas = await todos(() => sb.from('confere_catalogo_produtos').select('codigo,codigo_interno,situacao,ncm,versao,denominacao,descricao,assinatura,seq').eq('versao_id', v.id).order('codigo').order('codigo_interno'));
    const porCod = new Map();
    linhas.forEach(r => {
      let p = porCod.get(r.codigo);
      if (!p) { p = { seq: r.seq, codigo: r.codigo, descricao: r.descricao || '', denominacao: r.denominacao || '', situacao: r.situacao || '', ncm: r.ncm || '', versao: r.versao || '', codigosInterno: [], assinatura: r.assinatura }; porCod.set(r.codigo, p); }
      if (r.codigo_interno && r.codigo_interno !== SEM_CI) p.codigosInterno.push(r.codigo_interno);
    });
    CAT = { meta: { arquivo: v.arquivo_nome, geradoEm: v.gerado_em, total: v.total, ativos: v.ativos, desativados: v.desativados, versaoId: v.id, carregadoEm: v.carregado_em, carregadoPor: v.carregado_por }, produtos: [...porCod.values()], versao: v };
    return CAT;
  }
  async function carregarRegras(forcar) {
    if (REGRAS_DB && !forcar) return REGRAS_DB;
    REGRAS_DB = await dados(sb.from('confere_regras').select('*').order('codigo'));
    return REGRAS_DB;
  }
  const nomeUsuario = email => { const a = ACESSO.find(x => String(x.email).toLowerCase() === String(email || '').toLowerCase()); return a ? (a.nome || a.email) : (email || '—'); };
  const listaDocs = l => l.length <= 1 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
  const ncmTexto = t => String(t || '').replace(/\b(\d{8})\b/g, m => U.fmtNcm(m));
  const refProc = p => p ? `IP ${p.ref_cliente}${p.ref_agil ? ' · ' + p.ref_agil : ''}` : '—';

  /* ---------------- rotas ---------------- */
  async function rota() {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'painel';
    $$('#menu button[data-v]').forEach(b => b.classList.toggle('on', h === b.dataset.v || (h.startsWith('nova') && b.dataset.v === 'nova')));
    view().innerHTML = '<div class="empty">Carregando…</div>';
    view().onclick = null; view().onchange = null;
    try {
      if (h === 'painel') await vPainel();
      else if (h.startsWith('p-')) await vProcesso(h.slice(2));
      else if (h.startsWith('a-')) await vAnalise(h.slice(2));
      else if (h.startsWith('nova')) await vNova(h.includes('-') ? h.split('-').slice(1).join('-') : null);
      else if (h === 'ocorrencias') await vOcorrencias();
      else if (h === 'alertas') await vAlertas();
      else if (h === 'catalogo') await vCatalogo();
      else if (h === 'historico') await vHistorico();
      else if (h === 'regras') await vRegras();
      else if (h === 'usuarios') await vUsuarios();
      else await vPainel();
    } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="card empty">Algo deu errado ao abrir esta tela: ${esc(erroMsg(e))}</div>`;
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- painel de processos ---------------- */
  async function vPainel() {
    const [procs, anals, ocs, als] = await Promise.all([
      dados(sb.from('confere_processos').select('*').eq('importador_id', IMP.id).order('atualizado_em', { ascending: false }).limit(1000)),
      dados(sb.from('confere_analises').select('id,processo_id,numero,fase,resumo,decisao,analista_nome,criado_em,pdf_path').order('criado_em', { ascending: false }).limit(3000)),
      todos(() => sb.from('confere_ocorrencias').select('processo_id,severidade').eq('status', 'aberta').in('severidade', ['bloqueante', 'alerta'])),
      dados(sb.from('confere_alertas').select('processo_id').eq('status', 'aberto'))
    ]);
    const ultima = new Map();
    anals.forEach(a => { if (!ultima.has(a.processo_id)) ultima.set(a.processo_id, a); });
    const pend = new Map(), nal = new Map();
    ocs.forEach(o => { const p = pend.get(o.processo_id) || { b: 0, a: 0 }; o.severidade === 'bloqueante' ? p.b++ : p.a++; pend.set(o.processo_id, p); });
    als.forEach(a => nal.set(a.processo_id, (nal.get(a.processo_id) || 0) + 1));
    const mes = new Date(); mes.setDate(1); mes.setHours(0, 0, 0, 0);
    const abertos = procs.filter(p => p.status === 'aberto');
    view().innerHTML = `<div class="top"><div><div class="eb">Ágil Confere</div><h1 class="tt">Processos <span>Eletra</span></h1><div class="sub">Verificação documental dos embarques: pré-alerta (fase 1) e conferência para registro (fase 3).</div></div>
      <div class="acts"><button class="bt" id="bNova">+ Nova análise</button></div></div>
      <div class="kpis"><div class="kpi"><b>${abertos.length}</b><span>Processos em aberto</span></div><div class="kpi"><b>${anals.filter(a => new Date(a.criado_em) >= mes).length}</b><span>Análises no mês</span></div>
      <div class="kpi"><b>${ocs.filter(o => o.severidade === 'bloqueante').length}</b><span>Ocorrências bloqueantes em aberto</span></div><div class="kpi"><b>${als.length}</b><span>Alertas de catálogo em aberto</span></div></div>
      <div class="card"><div class="acts" style="margin-bottom:12px"><input class="in" id="fBusca" placeholder="Buscar por IP, referência Ágil ou invoice" style="max-width:360px">
      <select class="in" id="fStatus" style="max-width:200px"><option value="aberto">Em aberto</option><option value="registrado">Registrados</option><option value="cancelado">Cancelados</option><option value="">Todos</option></select></div>
      <div class="tbw"><table class="tb"><thead><tr><th>Processo</th><th>Invoice</th><th>Status</th><th>Última análise</th><th>Resultado</th><th>Pendências</th><th>Alertas</th></tr></thead><tbody id="tProc"></tbody></table></div></div>`;
    $('#bNova').onclick = () => { location.hash = 'nova'; };
    const desenha = () => {
      const q = U.norm($('#fBusca').value), st = $('#fStatus').value;
      const l = procs.filter(p => (!st || p.status === st) && (!q || U.norm([p.ref_cliente, p.ref_agil, p.invoice, p.exportador].join(' ')).includes(q)));
      $('#tProc').innerHTML = l.length ? l.map(p => {
        const a = ultima.get(p.id), pe = pend.get(p.id), n = nal.get(p.id);
        return `<tr class="cl" data-id="${p.id}"><td><b>IP ${esc(p.ref_cliente)}</b><div class="sm mut">${esc(p.ref_agil || 'sem ref. Ágil')}</div></td><td>${esc(p.invoice || '—')}<div class="sm mut">${esc(p.exportador || '')}</div></td>
        <td><span class="badge st-${p.status}">${p.status === 'aberto' ? 'Em aberto' : p.status === 'registrado' ? 'Registrado' : 'Cancelado'}</span>${p.duimp ? `<div class="sm mut">${esc(p.duimp)}</div>` : ''}</td>
        <td>${a ? `${FASES[a.fase]} nº ${a.numero}<div class="sm mut">${dataHora(a.criado_em)} · ${esc(a.analista_nome || '')}</div>` : '<span class="mut">sem análise</span>'}</td>
        <td>${a ? chipsResumo(a.resumo) : '—'}${a && a.decisao ? `<div class="sm mut">${a.decisao === 'seguir' ? 'Decisão: seguir' : 'Decisão: não seguir'}</div>` : ''}</td>
        <td>${pe ? `<span class="chips">${pe.b ? `<span class="badge sev-bloqueante">${pe.b}</span>` : ''}${pe.a ? `<span class="badge sev-alerta">${pe.a}</span>` : ''}</span>` : '<span class="mut">—</span>'}</td><td>${n ? `<span class="badge sev-alerta">${n}</span>` : '<span class="mut">—</span>'}</td></tr>`;
      }).join('') : `<tr><td colspan="7"><div class="empty">Nenhum processo. Comece por “Nova análise”.</div></td></tr>`;
    };
    $('#fBusca').oninput = desenha; $('#fStatus').onchange = desenha;
    $('#tProc').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = 'p-' + tr.dataset.id; };
    desenha();
  }

  /* ---------------- processo ---------------- */
  async function vProcesso(id) {
    const [p] = await dados(sb.from('confere_processos').select('*').eq('id', id));
    if (!p) { view().innerHTML = '<div class="card empty">Processo não encontrado.</div>'; return; }
    const [anals, docs, als, ocs] = await Promise.all([
      dados(sb.from('confere_analises').select('id,numero,fase,resumo,decisao,decisao_nota,analista_nome,criado_em,pdf_path,pdf_emitido_em').eq('processo_id', id).order('criado_em', { ascending: false })),
      dados(sb.from('confere_documentos').select('id,tipo,arquivo_nome,storage_path,enviado_por,enviado_em,tamanho').eq('processo_id', id).order('enviado_em', { ascending: false })),
      dados(sb.from('confere_alertas').select('*').eq('processo_id', id).order('criado_em', { ascending: false })),
      dados(sb.from('confere_ocorrencias').select('severidade').eq('processo_id', id).eq('status', 'aberta'))
    ]);
    const ult3 = anals.find(a => a.fase === 'pre_registro');
    const pronto = ult3 && ult3.decisao === 'seguir' && !ocs.some(o => o.severidade === 'bloqueante');
    view().innerHTML = `<div class="top"><div><div class="eb">Processo</div><h1 class="tt">IP ${esc(p.ref_cliente)} <span>${esc(p.ref_agil || '')}</span></h1>
      <div class="sub">${esc(p.invoice ? 'Invoice ' + p.invoice : 'Invoice ainda não lida')} · ${esc(p.exportador || IMP.nome)} · <span class="badge st-${p.status}">${p.status === 'aberto' ? 'Em aberto' : p.status === 'registrado' ? 'Registrado' + (p.duimp ? ' · ' + p.duimp : '') : 'Cancelado'}</span> ${pronto ? '<span class="badge sev-ok">Pronto para registro</span>' : ''}</div></div>
      <div class="acts"><button class="bt" id="bNova">+ Nova análise</button><button class="bt2" id="bEdit">Editar referências</button>${p.status === 'aberto' ? '<button class="bt2" id="bReg">Marcar como registrado</button>' : '<button class="bt2" id="bReab">Reabrir</button>'}</div></div>
      ${als.filter(a => a.status === 'aberto').length ? `<div class="banner al"><div><div class="t">${als.filter(a => a.status === 'aberto').length} alerta(s) de mudança no catálogo</div><div class="d">Itens deste processo mudaram no catálogo depois da última análise. Revise numerário, BL/CE, planilha de diferimento de ICMS e rode nova análise.</div></div><button class="bt2" onclick="location.hash='alertas'">Ver alertas</button></div>` : ''}
      <div class="card"><h2>Análises</h2><p class="cs">Cada análise guarda os documentos usados, o catálogo vigente na data e quem a realizou.</p>
      ${anals.length ? `<div class="tbw"><table class="tb"><thead><tr><th>Nº</th><th>Fase</th><th>Data</th><th>Analista</th><th>Resultado</th><th>Decisão</th><th>PDF</th></tr></thead><tbody>${anals.map(a => `<tr class="cl" data-a="${a.id}"><td><b>${a.numero}</b></td><td>${FASES[a.fase]}</td><td>${dataHora(a.criado_em)}</td><td>${esc(a.analista_nome)}</td><td>${chipsResumo(a.resumo)}</td><td>${a.decisao ? (a.decisao === 'seguir' ? '<span class="badge sev-ok">Seguir</span>' : '<span class="badge sev-bloqueante">Não seguir</span>') : '<span class="mut sm">pendente</span>'}</td><td>${a.pdf_path ? `<button class="bt3" data-pdf="${esc(a.pdf_path)}">baixar</button>` : '<span class="mut sm">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma análise ainda.</div>'}</div>
      <div class="card"><h2>Documentos enviados</h2>${docs.length ? `<table class="tb"><thead><tr><th>Tipo</th><th>Arquivo</th><th>Enviado por</th><th>Data</th><th></th></tr></thead><tbody>${docs.map(d => `<tr><td>${esc(TIPOS[d.tipo] || d.tipo)}</td><td>${esc(d.arquivo_nome)}</td><td>${esc(nomeUsuario(d.enviado_por))}</td><td>${dataHora(d.enviado_em)}</td><td>${d.storage_path ? `<button class="bt3" data-doc="${esc(d.storage_path)}" data-nome="${esc(d.arquivo_nome)}">baixar</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhum documento.</div>'}</div>
      ${als.length ? `<div class="card"><h2>Histórico de alertas</h2><table class="tb"><thead><tr><th>Data</th><th>Código interno</th><th>Mudança</th><th>Status</th></tr></thead><tbody>${als.map(a => `<tr><td>${dataHora(a.criado_em)}</td><td class="mono">${esc(a.codigo_interno)}</td><td>${esc(ncmTexto(a.mensagem))}</td><td>${a.status === 'aberto' ? '<span class="badge sev-alerta">aberto</span>' : `<span class="badge sev-ok">resolvido</span><div class="sm mut">${esc(nomeUsuario(a.resolvido_por))} · ${esc(a.nota || '')}</div>`}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    $('#bNova').onclick = () => { location.hash = 'nova-' + p.id; };
    view().onclick = e => {
      const pdf = e.target.closest('[data-pdf]'); if (pdf) { e.stopPropagation(); return baixarArquivo(pdf.dataset.pdf, pdf.dataset.pdf.split('/').pop()); }
      const d = e.target.closest('[data-doc]'); if (d) return baixarArquivo(d.dataset.doc, d.dataset.nome);
      const tr = e.target.closest('tr[data-a]'); if (tr) location.hash = 'a-' + tr.dataset.a;
    };
    $('#bEdit').onclick = () => modal({
      titulo: 'Referências do processo', corpo: `<div class="row r2"><div><label class="f">Ref. cliente (IP)</label><input class="in" id="eRc" value="${esc(p.ref_cliente)}"></div><div><label class="f">Ref. Ágil</label><input class="in" id="eRa" value="${esc(p.ref_agil || '')}"></div></div><label class="f">Observações</label><textarea class="in" id="eOb">${esc(p.observacoes || '')}</textarea>`,
      botoes: [{ txt: 'Cancelar' }, { txt: 'Salvar', cls: 'bt', acao: async f => { await dados(sb.from('confere_processos').update({ ref_cliente: $('#eRc', f).value.trim() || p.ref_cliente, ref_agil: $('#eRa', f).value.trim() || null, observacoes: $('#eOb', f).value, atualizado_em: new Date().toISOString() }).eq('id', p.id)); toast('Processo atualizado.'); rota(); } }]
    });
    const bReg = $('#bReg');
    if (bReg) bReg.onclick = () => modal({
      titulo: 'Marcar como registrado', corpo: `<p class="sm mut">Processos registrados deixam de receber alertas de mudança no catálogo.</p><label class="f">Número da DUIMP</label><input class="in" id="rDu" placeholder="26BR0000000000-0">`,
      botoes: [{ txt: 'Cancelar' }, { txt: 'Confirmar registro', cls: 'bt ok', acao: async f => { await dados(sb.from('confere_processos').update({ status: 'registrado', duimp: $('#rDu', f).value.trim() || null, registrado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', p.id)); toast('Processo marcado como registrado.'); rota(); } }]
    });
    const bReab = $('#bReab');
    if (bReab) bReab.onclick = async () => { await dados(sb.from('confere_processos').update({ status: 'aberto', atualizado_em: new Date().toISOString() }).eq('id', p.id)); toast('Processo reaberto.'); rota(); };
  }

  /* ---------------- nova análise ---------------- */
  const SLOTS = {
    pre_alerta: [['invoice', 'Invoice (+ packing list)', 'Planilha do exportador (.xlsx). Se o packing list estiver na mesma planilha, ele é lido junto.'], ['packing', 'Packing list', 'Opcional quando já vem na planilha da invoice.'], ['bl', 'Draft HBL', 'Planilha do draft (.xlsx).']],
    pre_registro: [['txt', 'TXT do TOTVS', 'Arquivo .txt gerado no ERP da Eletra (layout SIGAEIC).'], ['invoice', 'Invoice final', 'Planilha da invoice (.xlsx).'], ['relatorio', 'Relatório de itens', 'Relatório de itens do Sigraweb (.xlsx).']]
  };
  async function lerArquivo(file) {
    const buf = await file.arrayBuffer();
    const hash = await hashArquivo(buf);
    const nome = file.name;
    if (/\.pdf$/i.test(nome)) return { file, buf, hash, nome, tipo: 'outro', aviso: 'PDF fica anexado ao processo, mas ainda não é lido automaticamente. Para conferir, envie a planilha (.xlsx).' };
    if (/\.txt$/i.test(nome)) {
      const txt = C.lerTotvs(U.decodificar(buf), nome);
      return { file, buf, hash, nome, tipo: 'txt', txt };
    }
    if (/\.json$/i.test(nome)) return { file, buf, hash, nome, tipo: 'erro', erro: 'Para o catálogo, use a tela Catálogo de produtos.' };
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(nome)) return { file, buf, hash, nome, tipo: 'erro', erro: 'Formato não suportado. Envie .xlsx, .txt ou .pdf.' };
    const abas = C.lerPastaTrabalho(XLSX, buf);
    const rel = C.lerRelatorio(abas);
    if (rel.itens.length) return { file, buf, hash, nome, tipo: 'relatorio', relatorio: rel };
    const ehBL = abas.some(a => (a.linhas.slice(0, 4).flat().some(v => /^BILL OF LADING$|^(HOUSE )?B\/L$/.test(U.norm(v)))));
    if (ehBL) return { file, buf, hash, nome, tipo: 'bl', bl: C.lerBL(abas) };
    const com = C.lerDocumentosComerciais(abas);
    if (com.invoice || com.packing) return { file, buf, hash, nome, tipo: com.invoice && com.packing ? 'invoice_packing' : com.invoice ? 'invoice' : 'packing', invoice: com.invoice, packing: com.packing, abas: com.abas };
    return { file, buf, hash, nome, tipo: 'erro', erro: 'Não reconheci esta planilha como invoice, packing list, BL ou relatório de itens.' };
  }
  function resumoDoc(slot, x) {
    const L = [];
    if (slot === 'invoice' && x.invoice) {
      const i = x.invoice, c = i.cab, t = i.totais || {};
      L.push(`<b>Invoice ${esc(c.numero || '(sem número)')}</b> · ${U.fmtData(c.data)} · ${i.itens.length} itens · ${esc(c.incoterm || 'incoterm?')} · ${esc(c.moeda || '')} ${U.fmt(t.total)}`);
      L.push(`Peso líq. ${U.fmt(t.pesoLiq)} kg · bruto ${U.fmt(t.pesoBruto)} kg${x.packing ? ` · <b>packing list na mesma planilha</b> (${x.packing.itens.length} itens${x.packing.cab.volumes ? `, ${x.packing.cab.volumes.qtd} ${esc(x.packing.cab.volumes.especie || '')}` : ''})` : ''}`);
    } else if (slot === 'packing' && x.packing) {
      const p = x.packing;
      L.push(`<b>Packing list ${esc(p.cab.numero || '')}</b> · ${p.itens.length} itens${p.cab.volumes ? ` · ${p.cab.volumes.qtd} ${esc(p.cab.volumes.especie || '')}` : ''}${p.cab.cubagem != null ? ` · ${U.fmt(p.cab.cubagem)} m³` : ''}`);
    } else if (slot === 'bl' && x.bl) {
      const c = x.bl.cab;
      L.push(`<b>BL ${esc(c.numero || '(draft sem número)')}</b> · ${esc(c.portoEmbarque || '?')} → ${esc(c.portoDescarga || '?')}`);
      L.push(`${c.volumes ? `${c.volumes.qtd} ${esc(c.volumes.especie || '')} · ` : ''}${U.fmt(c.pesoBruto)} kg · ${U.fmt(c.cubagem)} m³ · NCM ${esc((c.ncms || []).join(', ') || '—')}`);
    } else if (slot === 'txt' && x.txt) {
      const t = x.txt, p = t.processos[0];
      L.push(`<b>TXT de ${U.fmtData(t.itdi && t.itdi.data)}</b>${t.itdi && t.itdi.usuario ? ` (${esc(t.itdi.usuario)})` : ''} · ref. ${esc(p && p.capi ? p.capi.refCliente : '?')}`);
      if (p) L.push(`${p.itens.length} linhas de item (${new Set(p.itens.map(i => U.normCod(i.codigo))).size} códigos) · frete ${esc(U.moedaISO(p.cap2 && p.cap2.moedaFrete) || '')} ${U.fmt(p.cap2 ? (p.cap2.fretePrepaid || 0) + (p.cap2.freteCollect || 0) : null)}`);
    } else if (slot === 'relatorio' && x.relatorio) {
      const r = x.relatorio;
      L.push(`<b>Relatório ${esc(r.cab.refAgil || '')}</b> · ref. ${esc(r.cab.refCliente || '?')} · ${r.itens.length} linhas · ${esc(r.cab.moeda || '')} (taxa ${U.fmtAuto(r.cab.taxaMoeda, 4)})`);
    }
    const av = [].concat((x.txt && x.txt.avisos) || [], (x.invoice && x.invoice.avisos) || [], (x.bl && x.bl.avisos) || [], (x.relatorio && x.relatorio.avisos) || []);
    return L.join('<br>') + av.slice(0, 4).map(a => `<div class="warn">⚠ ${esc(a)}</div>`).join('');
  }
  async function vNova(procId) {
    const procs = await dados(sb.from('confere_processos').select('id,ref_cliente,ref_agil,invoice,status').eq('importador_id', IMP.id).order('atualizado_em', { ascending: false }).limit(500));
    await carregarCatalogo();
    await carregarRegras();
    const S = { proc: procId || '', fase: 'pre_alerta', slots: {}, anteriores: {} };
    view().innerHTML = `<div class="top"><div><div class="eb">Nova análise</div><h1 class="tt">Conferência <span>documental</span></h1><div class="sub">Envie os documentos, rode a análise e trate as ocorrências. Sem tolerância: qualquer divergência vira ocorrência.</div></div></div>
      <div class="card"><h2><span class="n">1</span>Processo</h2><p class="cs">Escolha um processo em aberto ou crie um novo pela referência do cliente (IP).</p>
      <div class="row r3"><div><label class="f">Processo existente</label><select class="in" id="nProc"><option value="">+ Novo processo</option>${procs.map(p => `<option value="${p.id}" ${p.id === procId ? 'selected' : ''}>IP ${esc(p.ref_cliente)}${p.ref_agil ? ' · ' + esc(p.ref_agil) : ''}${p.status !== 'aberto' ? ' (' + p.status + ')' : ''}</option>`).join('')}</select></div>
      <div class="novo"><label class="f">Ref. cliente (IP) *</label><input class="in" id="nRc" placeholder="026B/2026"></div><div class="novo"><label class="f">Ref. Ágil</label><input class="in" id="nRa" placeholder="AGIM4407-26"></div></div></div>
      <div class="card"><h2><span class="n">2</span>Fase</h2><div class="fase">
      <label class="on"><input type="radio" name="fase" value="pre_alerta" checked><b>Pré-alerta (fase 1)</b><small>Invoice, packing list e draft do HBL antes do embarque: exigências do Regulamento Aduaneiro, conferência entre documentos e situação de cada item no catálogo.</small></label>
      <label><input type="radio" name="fase" value="pre_registro"><b>Pré-registro (fase 3)</b><small>TXT do TOTVS, invoice final e relatório de itens: conciliação item a item (NCM, quantidades, valores, pesos, descrições) contra o catálogo vigente.</small></label></div></div>
      <div class="card"><h2><span class="n">3</span>Documentos</h2><p class="cs">Arraste os arquivos em qualquer quadro; o sistema reconhece o tipo pelo conteúdo.</p><div class="drops" id="drops"></div>
      <div class="prog" id="catInfo"></div></div>
      <div class="acts"><button class="bt" id="bRodar">Rodar análise</button><span class="prog" id="prog"></span></div>`;
    const desenharSlots = () => {
      $('#drops').innerHTML = SLOTS[S.fase].map(([k, t, h]) => {
        const x = S.slots[k], ant = S.anteriores[k];
        let corpo = '';
        if (x && x.erro) corpo = `<div class="file err">${esc(x.nome)}: ${esc(x.erro)}</div>`;
        else if (x) corpo = `<div class="file">${esc(x.nome)}<br>${resumoDoc(k, x)}${x.aviso ? `<div class="warn">${esc(x.aviso)}</div>` : ''}<div><button class="bt3" data-limpa="${k}">remover</button></div></div>`;
        else if (ant) corpo = `<div class="file"><label><input type="checkbox" data-ant="${k}" ${ant.usar ? 'checked' : ''}> Reaproveitar <b>${esc(ant.arquivo_nome)}</b></label><div class="sm mut">enviado em ${dataHora(ant.enviado_em)} por ${esc(nomeUsuario(ant.enviado_por))}</div></div>`;
        return `<div class="drop" data-slot="${k}"><h3>${esc(t)}</h3><div class="hint">${esc(h)}</div>${corpo}<div><label class="bt2" style="cursor:pointer">Escolher arquivo<input type="file" hidden data-in="${k}" accept=".xlsx,.xls,.xlsm,.txt,.pdf,.csv"></label></div></div>`;
      }).join('');
      $('#catInfo').innerHTML = CAT ? `Catálogo vigente: <b>${esc(CAT.meta.arquivo)}</b> (gerado em ${dataHora(CAT.meta.geradoEm)}, ${CAT.meta.total} produtos). <a href="#catalogo">Atualizar catálogo</a>` : `<span style="color:var(--err)">Nenhum catálogo carregado: a conferência por item no catálogo não será feita. <a href="#catalogo">Carregar catálogo</a></span>`;
    };
    const atribuir = async files => {
      for (const f of files) {
        const prog = $('#prog'); prog.textContent = 'Lendo ' + f.name + '…';
        let x;
        try { x = await lerArquivo(f); } catch (e) { x = { nome: f.name, erro: 'Falha ao ler: ' + erroMsg(e) }; }
        prog.textContent = '';
        if (x.erro) { toast(`${f.name}: ${x.erro}`, true); continue; }
        if (x.tipo === 'txt') { if (S.fase !== 'pre_registro') { S.fase = 'pre_registro'; marcarFase(); } S.slots.txt = x; }
        else if (x.tipo === 'relatorio') { if (S.fase !== 'pre_registro') { S.fase = 'pre_registro'; marcarFase(); } S.slots.relatorio = x; }
        else if (x.tipo === 'bl') S.slots.bl = x;
        else if (x.tipo === 'invoice_packing' || x.tipo === 'invoice') { S.slots.invoice = x; if (x.packing && S.fase === 'pre_alerta') delete S.slots.packing; }
        else if (x.tipo === 'packing') S.slots.packing = x;
        else if (x.tipo === 'outro') { S.slots['outro_' + x.hash.slice(0, 6)] = x; toast(x.aviso); }
        if (!$('#nProc').value && !$('#nRc').value) {
          const ref = (x.invoice && x.invoice.cab.ipRef) || (x.txt && x.txt.processos[0] && x.txt.processos[0].capi && x.txt.processos[0].capi.refCliente) || (x.relatorio && x.relatorio.cab.refCliente) || (x.bl && x.bl.cab.ipRef) || '';
          if (ref) $('#nRc').value = String(ref).replace(/^IPH?\s*/i, '').replace(/-(\d{4})$/, '/$1');
          if (x.relatorio && x.relatorio.cab.refAgil && !$('#nRa').value) $('#nRa').value = x.relatorio.cab.refAgil;
        }
      }
      desenharSlots();
    };
    const marcarFase = () => { $$('input[name=fase]').forEach(i => { i.checked = i.value === S.fase; i.closest('label').classList.toggle('on', i.checked); }); desenharSlots(); };
    const carregarAnteriores = async () => {
      S.anteriores = {};
      $$('.novo').forEach(e => e.classList.toggle('hide', !!S.proc));
      if (!S.proc) return desenharSlots();
      const docs = await dados(sb.from('confere_documentos').select('id,tipo,arquivo_nome,enviado_por,enviado_em,storage_path,arquivo_hash').eq('processo_id', S.proc).order('enviado_em', { ascending: false }));
      for (const d of docs) {
        const alvo = d.tipo === 'invoice_packing' ? ['invoice'] : [d.tipo];
        alvo.forEach(k => { if (!S.anteriores[k]) S.anteriores[k] = Object.assign({ usar: true }, d); });
        if (d.tipo === 'invoice_packing' && !S.anteriores.packing) S.anteriores.packing = Object.assign({ usar: true, deInvoicePacking: true }, d);
      }
      desenharSlots();
    };
    $('#nProc').onchange = () => { S.proc = $('#nProc').value; carregarAnteriores(); };
    $$('input[name=fase]').forEach(i => i.onchange = () => { S.fase = i.value; marcarFase(); });
    const drops = $('#drops');
    drops.addEventListener('dragover', e => { e.preventDefault(); const d = e.target.closest('.drop'); $$('.drop').forEach(x => x.classList.toggle('on', x === d)); });
    drops.addEventListener('dragleave', e => { if (!drops.contains(e.relatedTarget)) $$('.drop').forEach(x => x.classList.remove('on')); });
    drops.addEventListener('drop', e => { e.preventDefault(); $$('.drop').forEach(x => x.classList.remove('on')); atribuir([...e.dataTransfer.files]); });
    drops.addEventListener('change', e => { const i = e.target.closest('input[data-in]'); if (i && i.files.length) atribuir([...i.files]); const a = e.target.closest('input[data-ant]'); if (a) S.anteriores[a.dataset.ant].usar = a.checked; });
    drops.addEventListener('click', e => { const l = e.target.closest('[data-limpa]'); if (l) { delete S.slots[l.dataset.limpa]; desenharSlots(); } });
    $('#bRodar').onclick = () => rodar(S, procs);
    if (procId) { S.proc = procId; const an = await dados(sb.from('confere_analises').select('fase').eq('processo_id', procId).order('criado_em', { ascending: false }).limit(1)); if (an[0] && an[0].fase === 'pre_alerta') S.fase = 'pre_registro'; marcarFase(); }
    await carregarAnteriores();
  }

  async function rodar(S, procs) {
    const bt = $('#bRodar'), prog = $('#prog');
    const passo = t => { prog.textContent = t; };
    try {
      bt.disabled = true;
      let proc = procs.find(p => p.id === S.proc);
      const refCliente = proc ? proc.ref_cliente : $('#nRc').value.trim();
      if (!refCliente) throw new Error('Informe a referência do cliente (IP) ou escolha um processo.');
      // documentos: novos ou reaproveitados
      const docs = {}, usados = [];
      const pegarAnterior = async k => {
        const a = S.anteriores[k];
        if (!a || !a.usar) return null;
        const [d] = await dados(sb.from('confere_documentos').select('id,tipo,arquivo_nome,arquivo_hash,extraido').eq('id', a.id));
        return d;
      };
      for (const [k] of SLOTS[S.fase]) {
        const x = S.slots[k];
        if (x && !x.erro) {
          if (k === 'invoice') { if (x.invoice) docs.invoice = x.invoice; if (x.packing && S.fase === 'pre_alerta' && !S.slots.packing) docs.packing = x.packing; }
          else if (k === 'packing') { if (x.packing) docs.packing = x.packing; }
          else if (k === 'bl') docs.bl = x.bl;
          else if (k === 'txt') docs.txt = x.txt;
          else if (k === 'relatorio') docs.relatorio = x.relatorio;
        } else {
          const d = await pegarAnterior(k);
          if (d && d.extraido) {
            const e = d.extraido;
            if (k === 'invoice' && !docs.invoice) docs.invoice = e.invoice || null;
            if (k === 'packing' && !docs.packing && S.fase === 'pre_alerta') docs.packing = e.packing || null;
            if (k === 'bl' && !docs.bl) docs.bl = e.bl || null;
            if (k === 'txt' && !docs.txt) docs.txt = e.txt || null;
            if (k === 'relatorio' && !docs.relatorio) docs.relatorio = e.relatorio || null;
            if (!usados.some(u => u.id === d.id)) usados.push({ id: d.id, tipo: d.tipo, arquivo_nome: d.arquivo_nome, hash: d.arquivo_hash, reaproveitado: true });
          }
        }
      }
      if (S.fase === 'pre_alerta' && !docs.invoice && !docs.packing && !docs.bl) throw new Error('Envie ao menos a invoice, o packing list ou o draft do HBL.');
      if (S.fase === 'pre_registro' && !docs.txt) throw new Error('Na fase de pré-registro o TXT do TOTVS é obrigatório.');
      // processo
      passo('Preparando o processo…');
      if (!proc) {
        const ex = await dados(sb.from('confere_processos').select('id,ref_cliente,ref_agil,invoice,status').eq('importador_id', IMP.id).ilike('ref_cliente', refCliente));
        proc = ex[0] || (await dados(sb.from('confere_processos').insert({ importador_id: IMP.id, ref_cliente: refCliente, ref_agil: $('#nRa').value.trim() || null }).select()))[0];
      }
      // regras
      const desl = (REGRAS_DB || []).filter(r => !r.ativa).map(r => r.codigo);
      passo('Conferindo documentos…');
      const resultado = C.analisar({ fase: S.fase, processo: { refCliente: proc.ref_cliente, refAgil: proc.ref_agil, cnpj: IMP.cnpj }, docs, catalogo: CAT || null, regrasDesligadas: desl, severidades: Object.fromEntries((REGRAS_DB || []).map(r => [r.codigo, r.severidade])) });
      // arquivos novos
      const novos = Object.entries(S.slots).filter(([, x]) => x && !x.erro && x.file);
      let i = 0;
      for (const [, x] of novos) {
        passo(`Enviando arquivos (${++i}/${novos.length})…`);
        const caminho = `processos/${proc.id}/${Date.now()}-${nomeSeguro(x.nome)}`;
        const up = await sb.storage.from('confere').upload(caminho, x.file, { upsert: false, contentType: x.file.type || 'application/octet-stream' });
        if (up.error) throw up.error;
        const extraido = { invoice: x.invoice || null, packing: x.packing || null, bl: x.bl || null, txt: x.txt || null, relatorio: x.relatorio || null };
        const [d] = await dados(sb.from('confere_documentos').insert({ processo_id: proc.id, tipo: x.tipo === 'erro' ? 'outro' : x.tipo, arquivo_nome: x.nome, arquivo_hash: x.hash, tamanho: x.file.size, storage_path: caminho, extraido }).select('id,tipo,arquivo_nome,arquivo_hash'));
        usados.push({ id: d.id, tipo: d.tipo, arquivo_nome: d.arquivo_nome, hash: d.arquivo_hash });
      }
      passo('Gravando a análise…');
      const [an] = await dados(sb.from('confere_analises').insert({ processo_id: proc.id, fase: S.fase, catalogo_versao_id: CAT ? CAT.meta.versaoId : null, documentos: usados, resultado, resumo: resultado.resumo }).select('id,numero'));
      const itens = resultado.itens.filter(o => !o.codigo.startsWith('#')).map(o => {
        const q = CAT ? K.consultarCatalogo(CAT, o.codigo) : null;
        const ciCat = q && q.produto ? (q.produto.codigosInterno.find(c => U.normCod(c) === U.normCod(o.codigo)) || o.codigo) : o.codigo;
        return { analise_id: an.id, processo_id: proc.id, codigo_interno: ciCat, ncm_documento: (o.txt && o.txt.ncms && o.txt.ncms[0]) || (o.invoice && o.invoice.ncms && o.invoice.ncms[0]) || null, ncm_catalogo: q && q.produto ? q.produto.ncm : null, produto_codigo: q && q.produto ? q.produto.codigo : null, produto_versao: q && q.produto ? q.produto.versao : null, produto_assinatura: q ? q.ativos.map(p => p.assinatura).sort().join(';') : null, status: o.status };
      });
      const unicos = [...new Map(itens.map(x => [U.normCod(x.codigo_interno), x])).values()];
      for (let k = 0; k < unicos.length; k += 500) await dados(sb.from('confere_analise_itens').insert(unicos.slice(k, k + 500)));
      const ocs = resultado.achados.map(a => ({ analise_id: an.id, processo_id: proc.id, chave: a.chave, regra: a.regra, titulo: a.titulo, severidade: a.severidade, documento: a.documento, campo: a.campo, item: a.item, encontrado: a.encontrado == null ? null : String(a.encontrado), esperado: a.esperado == null ? null : String(a.esperado), mensagem: a.mensagem, sugestao: a.sugestao, texto_pdf: a.sugestao, base_legal: a.base, interna: !!a.interna, incluir_pdf: !!a.incluirPdf, acao: null, acao_documento: a.acaoDocumento || null }));
      for (let k = 0; k < ocs.length; k += 500) await dados(sb.from('confere_ocorrencias').insert(ocs.slice(k, k + 500)));
      const inv = docs.invoice;
      if (inv) await dados(sb.from('confere_processos').update({ invoice: inv.cab.numero || null, exportador: inv.cab.exportador ? inv.cab.exportador.nome : null, atualizado_em: new Date().toISOString() }).eq('id', proc.id));
      passo('');
      location.hash = 'a-' + an.id + '-nova';
      contadores();
    } catch (e) {
      console.error(e);
      passo('');
      toast(erroMsg(e), true);
    } finally { bt.disabled = false; }
  }

  /* ---------------- análise ---------------- */
  function controlesOcorrencia(o) {
    return `<div class="ctl" data-oc="${o.id}">
      <select class="in" data-k="acao"><option value="">Ação…</option>${Object.entries(R.ACOES).map(([k, v]) => `<option value="${k}" ${o.acao === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select class="in ${o.acao === 'ajuste_documento' ? '' : 'hide'}" data-k="acao_documento"><option value="">Qual documento?</option>${DOCS_ACAO.map(d => `<option ${o.acao_documento === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <span class="seg"><button class="s ${o.decisao === 'seguir' ? 'on' : ''}" data-dec="seguir" title="Aceitar e seguir">Seguir</button><button class="n ${o.decisao === 'nao_seguir' ? 'on' : ''}" data-dec="nao_seguir" title="Não seguir até ajustar">Não seguir</button></span>
      <input class="in" data-k="nota" placeholder="Nota (opcional)" value="${esc(o.nota || '')}"></div>`;
  }
  function cartaoOcorrencia(o, extra) {
    const vv = [o.campo ? `<span>Campo: <b>${esc(o.campo)}</b></span>` : '', o.item ? `<span>Item: <b class="mono">${esc(o.item)}</b></span>` : '', o.encontrado ? `<span>Encontrado: <b>${esc(o.encontrado)}</b></span>` : '', o.esperado ? `<span>Esperado: <b>${esc(o.esperado)}</b></span>` : ''].join('');
    return `<div class="oc ${o.severidade} ${o.status === 'tratada' ? 'tratada' : ''}" data-id="${o.id}">
      <div class="h">${sev(o.severidade)}<b>${esc(o.titulo || o.regra)}</b><span class="mut">${esc(o.regra)} · ${esc(o.base_legal || '')}</span>${o.interna ? '<span class="badge sev-info">interna</span>' : ''}${extra || ''}${o.tratado_por ? `<span class="mut sm" style="margin-left:auto">${o.decisao === 'seguir' ? 'Seguir' : 'Não seguir'} · ${esc(nomeUsuario(o.tratado_por))} · ${dataHora(o.tratado_em)}</span>` : ''}</div>
      <div class="m">${esc(o.mensagem)}</div><div class="vv">${vv}</div>${controlesOcorrencia(o)}</div>`;
  }
  function ligarControles(raiz, lista, aoMudar) {
    const salvar = async (id, campos) => {
      const o = lista.find(x => x.id === id);
      Object.assign(o, campos);
      const patch = Object.assign({}, campos);
      if ('decisao' in campos) { patch.status = campos.decisao ? 'tratada' : 'aberta'; patch.tratado_por = campos.decisao ? EU.email : null; patch.tratado_em = campos.decisao ? new Date().toISOString() : null; Object.assign(o, patch); }
      try { await dados(sb.from('confere_ocorrencias').update(patch).eq('id', id)); if (aoMudar) aoMudar(o); contadores(); } catch (e) { toast('Não foi possível salvar: ' + erroMsg(e), true); }
    };
    raiz.addEventListener('change', e => {
      const ctl = e.target.closest('[data-oc]'); if (!ctl) return;
      const k = e.target.dataset.k; if (!k) return;
      const v = e.target.value || null;
      if (k === 'acao') { $('[data-k=acao_documento]', ctl).classList.toggle('hide', v !== 'ajuste_documento'); const c = { acao: v }; if (v === 'ciente_ok') c.decisao = 'seguir'; salvar(ctl.dataset.oc, c); if (v === 'ciente_ok') { $$('[data-dec]', ctl).forEach(b => b.classList.toggle('on', b.dataset.dec === 'seguir')); } }
      else salvar(ctl.dataset.oc, { [k]: v });
    });
    raiz.addEventListener('click', e => {
      const b = e.target.closest('[data-dec]'); if (!b) return;
      const ctl = b.closest('[data-oc]');
      const atual = (lista.find(x => x.id === ctl.dataset.oc) || {}).decisao;
      const nova = atual === b.dataset.dec ? null : b.dataset.dec;
      $$('[data-dec]', ctl).forEach(x => x.classList.toggle('on', x.dataset.dec === nova));
      salvar(ctl.dataset.oc, { decisao: nova });
    });
  }
  async function vAnalise(arg) {
    const nova = arg.endsWith('-nova');
    const id = arg.replace(/-nova$/, '');
    const [a] = await dados(sb.from('confere_analises').select('*').eq('id', id));
    if (!a) { view().innerHTML = '<div class="card empty">Análise não encontrada.</div>'; return; }
    const [[p], ocs] = await Promise.all([dados(sb.from('confere_processos').select('*').eq('id', a.processo_id)), todos(() => sb.from('confere_ocorrencias').select('*').eq('analise_id', id).order('criado_em'))]);
    const r = a.resultado || {}, rs = a.resumo || {};
    const docsTxt = (a.documentos || []).map(d => `${TIPOS[d.tipo] || d.tipo}: ${d.arquivo_nome}${d.reaproveitado ? ' (reaproveitado)' : ''}`).join(' · ');
    const pend = ocs.filter(o => o.status !== 'substituida' && o.severidade !== 'info');
    view().innerHTML = `<div class="top"><div><div class="eb">Análise nº ${a.numero} · ${FASES[a.fase]}</div><h1 class="tt">IP ${esc(p.ref_cliente)} <span>${esc(p.ref_agil || '')}</span></h1>
      <div class="sub">${dataHora(a.criado_em)} · por <b>${esc(a.analista_nome)}</b> · catálogo ${r.resumo && r.resumo.catalogo ? `de ${dataHora(r.resumo.catalogo.geradoEm)}` : 'não carregado'} · motor ${esc(r.versaoMotor || '')}<br>${esc(docsTxt)}</div></div>
      <div class="acts"><button class="bt" id="bPdf">Emitir parecer (PDF)</button><button class="bt2" id="bTxt">Copiar texto do parecer</button><button class="bt2" onclick="location.hash='p-${p.id}'">Abrir processo</button><button class="bt2" onclick="location.hash='nova-${p.id}'">Nova análise</button></div></div>
      <div id="decisao"></div>
      <div class="kpis"><div class="kpi"><b>${rs.bloqueantes || 0}</b><span>Bloqueantes</span></div><div class="kpi"><b>${rs.alertas || 0}</b><span>Alertas</span></div><div class="kpi"><b>${rs.infos || 0}</b><span>Informativos</span></div><div class="kpi"><b>${rs.itens || 0}</b><span>Itens conferidos${rs.itensComPendencia ? ` (${rs.itensComPendencia} com pendência)` : ''}</span></div></div>
      <div class="tabs2"><button class="on" data-t="oc">Ocorrências (${ocs.length})</button><button data-t="it">Itens (${(r.itens || []).length})</button><button data-t="dc">Documentos lidos</button></div>
      <div id="tOc"></div><div id="tIt" class="hide"></div><div id="tDc" class="hide"></div>`;
    const desenharDecisao = () => {
      const el = $('#decisao');
      if (a.decisao) el.innerHTML = `<div class="banner ${a.decisao === 'seguir' ? 'ok' : 'er'}"><div><div class="t">Decisão: ${a.decisao === 'seguir' ? 'seguir com o processo' : 'não seguir até os ajustes'}</div><div class="d">${esc(nomeUsuario(a.decisao_por))} · ${dataHora(a.decisao_em)}${a.decisao_nota ? ' · ' + esc(a.decisao_nota) : ''}</div></div><button class="bt2" id="bDec">Alterar decisão</button></div>`;
      else if (pend.length) el.innerHTML = `<div class="banner al"><div><div class="t">${pend.length} divergência(s) encontrada(s): ${rs.bloqueantes || 0} bloqueante(s) e ${rs.alertas || 0} alerta(s)</div><div class="d">Sem tolerância: trate as ocorrências e registre se o processo segue ou não.</div></div><div class="acts"><button class="bt ok" data-d="seguir">Seguir com ressalvas</button><button class="bt er" data-d="nao_seguir">Não seguir</button></div></div>`;
      else el.innerHTML = `<div class="banner ok"><div><div class="t">Nenhuma divergência encontrada</div><div class="d">Documentos em conformidade com as regras ativas.</div></div><button class="bt ok" data-d="seguir">Registrar “seguir”</button></div>`;
    };
    const decidir = dec => modal({
      titulo: dec === 'seguir' ? 'Seguir com o processo' : 'Não seguir', corpo: `<p class="sm">${dec === 'seguir' ? 'Registre por que o processo pode seguir mesmo com as divergências (ex.: diferenças aceitas, ajustes já solicitados).' : 'Registre o que precisa ser ajustado antes de seguir (ex.: devolvido ao cliente).'}</p><textarea class="in" id="dNota" placeholder="Nota da decisão"></textarea>`,
      botoes: [{ txt: 'Cancelar' }, { txt: 'Confirmar', cls: dec === 'seguir' ? 'bt ok' : 'bt er', acao: async f => { const patch = { decisao: dec, decisao_nota: $('#dNota', f).value.trim() || null, decisao_por: EU.email, decisao_em: new Date().toISOString() }; await dados(sb.from('confere_analises').update(patch).eq('id', a.id)); Object.assign(a, patch); desenharDecisao(); toast('Decisão registrada.'); } }]
    });
    $('#decisao').onclick = e => { const b = e.target.closest('[data-d]'); if (b) decidir(b.dataset.d); if (e.target.id === 'bDec') { a.decisao = null; desenharDecisao(); } };
    desenharDecisao();
    // ocorrências
    const filtros = { sev: '', so: false };
    const desenharOc = () => {
      const l = ocs.filter(o => (!filtros.sev || o.severidade === filtros.sev) && (!filtros.so || !o.decisao));
      const grupos = R.SECOES.map(([k, t]) => [k, t, l.filter(o => o.documento === k)]).filter(g => g[2].length);
      $('#tOc').innerHTML = `<div class="acts" style="margin-bottom:6px"><select class="in" id="fSev" style="max-width:190px"><option value="">Todas as severidades</option><option value="bloqueante">Bloqueantes</option><option value="alerta">Alertas</option><option value="info">Informativos</option></select><label class="sm"><input type="checkbox" id="fSo" ${filtros.so ? 'checked' : ''}> só sem decisão</label></div>` +
        (grupos.length ? grupos.map(([k, t, g]) => `<div class="grp-doc">${esc(t)}</div>` + g.map(o => cartaoOcorrencia(o, o.status === 'substituida' ? '<span class="badge" style="background:#eee;color:#777">substituída por análise mais nova</span>' : '')).join('')).join('') : '<div class="empty">Nenhuma ocorrência com estes filtros.</div>');
      $('#fSev').value = filtros.sev;
      $('#fSev').onchange = () => { filtros.sev = $('#fSev').value; desenharOc(); };
      $('#fSo').onchange = () => { filtros.so = $('#fSo').checked; desenharOc(); };
    };
    ligarControles($('#tOc'), ocs, () => {});
    desenharOc();
    // itens
    const it = r.itens || [];
    const cel = (v, ref, fmtf) => { const s = v == null ? '—' : fmtf(v); return ref != null && v != null && String(v) !== String(ref) ? `<td class="num cel-dif">${s}</td>` : `<td class="num">${s}</td>`; };
    $('#tIt').innerHTML = `<p class="cs">Conciliação por código interno (agrupando linhas do TXT e do relatório). Células em destaque divergem da referência. Clique numa linha para comparar descrições.</p><div class="tbw"><table class="tb"><thead><tr><th>Código</th><th>Status</th><th>NCM ref.</th><th>NCM invoice</th><th>NCM TXT</th><th>NCM relatório</th><th>Catálogo</th><th class="num">Qtd invoice</th><th class="num">Qtd TXT</th><th class="num">Valor invoice</th><th class="num">Valor TXT</th><th class="num">Peso líq. invoice</th><th class="num">Peso líq. TXT</th></tr></thead><tbody>${it.map((o, k) => {
      const ref = o.ncmReferencia, ni = o.invoice ? o.invoice.ncms.join('/') : null, nt = o.txt ? o.txt.ncms.join('/') : null, nr = o.relatorio ? o.relatorio.ncms.join('/') : null;
      const c = o.catalogo;
      const catTxt = !c ? '—' : c.status === 'nao_encontrado' ? '<span class="badge sev-bloqueante">não cadastrado</span>' : c.status === 'desativado' ? '<span class="badge sev-bloqueante">desativado</span>' : `${c.status === 'multiplos' ? '<span class="badge sev-alerta">' + c.ativos.length + ' ativos</span> ' : ''}${esc(c.produto.codigo)} v${esc(c.produto.versao)} · ${U.fmtNcm(c.produto.ncm)}`;
      return `<tr class="cl" data-k="${k}"><td class="mono"><b>${esc(o.codigo)}</b></td><td><span class="dot ${o.status}"></span></td><td>${U.fmtNcm(ref)}</td>${[ni, nt, nr].map(n => n == null ? '<td class="mut">—</td>' : `<td class="${n !== ref ? 'cel-blq' : ''}">${esc(n.split('/').map(U.fmtNcm).join(' / '))}</td>`).join('')}<td>${catTxt}</td>
        ${cel(o.invoice && o.invoice.qtd, null, v => U.fmtAuto(v, 5))}${o.txt ? `<td class="num ${o.invoice && !U.iguais(o.txt.qtd, o.invoice.qtd, 5) ? 'cel-dif' : ''}">${U.fmtAuto(o.txt.qtd, 5)}</td>` : '<td class="mut">—</td>'}
        ${cel(o.invoice && o.invoice.total, null, v => U.fmt(v))}${o.txt ? `<td class="num ${o.invoice && !U.iguais(o.txt.valor, o.invoice.total, 2) ? 'cel-dif' : ''}">${U.fmt(o.txt.valor)}</td>` : '<td class="mut">—</td>'}
        ${cel(o.invoice && o.invoice.pesoLiq, null, v => U.fmt(v, 2))}${o.txt ? `<td class="num ${o.invoice && !U.iguais(o.txt.pesoLiq, o.invoice.pesoLiq, 2) ? 'cel-dif' : ''}">${U.fmt(o.txt.pesoLiq, 4)}</td>` : '<td class="mut">—</td>'}</tr>`;
    }).join('')}</tbody></table></div>`;
    $('#tIt').onclick = e => { const tr = e.target.closest('tr[data-k]'); if (tr) compararDescricoes(it[+tr.dataset.k]); };
    // documentos lidos
    const dl = r.documentos || {};
    const kv = o => `<dl class="kv">${Object.entries(o).filter(([, v]) => v != null && v !== '' && typeof v !== 'object').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    $('#tDc').innerHTML = Object.entries(dl).filter(([, v]) => v).map(([k, v]) => `<div class="card"><h2>${esc(R.DOCS[k] || k)}</h2>${kv(Object.assign({}, v, v.totais ? { 'qtd total': U.fmtAuto(v.totais.qtd), 'peso líquido': U.fmt(v.totais.pesoLiq), 'peso bruto': U.fmt(v.totais.pesoBruto), 'valor total': U.fmt(v.totais.total != null ? v.totais.total : v.totais.totalMoeda) } : {}, v.frete ? { frete: `${v.frete.moeda || ''} ${U.fmt(v.frete.valor)}` } : {}, v.seguro ? { seguro: `${v.seguro.moeda || ''} ${U.fmt(v.seguro.valor)}` } : {}, v.volumes ? { volumes: `${v.volumes.qtd} ${v.volumes.especie || ''}` } : {}, v.ncms ? { ncms: v.ncms.join(', ') } : {}))}</div>`).join('') || '<div class="empty">Sem dados.</div>';
    $$('.tabs2 button').forEach(b => b.onclick = () => { $$('.tabs2 button').forEach(x => x.classList.toggle('on', x === b)); $('#tOc').classList.toggle('hide', b.dataset.t !== 'oc'); $('#tIt').classList.toggle('hide', b.dataset.t !== 'it'); $('#tDc').classList.toggle('hide', b.dataset.t !== 'dc'); });
    $('#bPdf').onclick = () => editorParecer(a, p, ocs);
    $('#bTxt').onclick = () => copiar(R.montarParecer(r, ocs.filter(o => o.status !== 'substituida' && o.incluir_pdf).map(o => ({ documento: o.documento, texto: o.texto_pdf || o.sugestao })), Object.assign({}, a.parecer || {}, { documentosAnalisados: (rs.documentos || []) })).texto);
    if (nova && pend.length && !a.decisao) {
      history.replaceState(null, '', '#a-' + a.id);
      modal({ titulo: 'Divergências encontradas', corpo: `<p>A análise encontrou <b>${rs.bloqueantes || 0} bloqueante(s)</b>, <b>${rs.alertas || 0} alerta(s)</b> e ${rs.infos || 0} informativo(s).</p><p class="sm mut">Trate cada ocorrência (ação e seguir/não seguir) e registre a decisão do processo. Você pode decidir agora ou depois.</p>`, botoes: [{ txt: 'Ver ocorrências', cls: 'bt2' }, { txt: 'Não seguir', cls: 'bt er', acao: () => { decidir('nao_seguir'); } }, { txt: 'Seguir com ressalvas', cls: 'bt ok', acao: () => { decidir('seguir'); } }] });
    } else if (nova) history.replaceState(null, '', '#a-' + a.id);
  }
  function marcarTokens(texto, toks, cls) {
    let h = esc(texto);
    (toks || []).forEach(t => { const v = esc(t.bruto || t.valor); if (v && v.length > 1) h = h.split(v).join(`<mark class="${cls}">${v}</mark>`); });
    return h;
  }
  function compararDescricoes(o) {
    const inv = o.invoice && o.invoice.descricao, txt = o.txt && o.txt.descricao, rel = o.relatorio && o.relatorio.descricao, cat = o.catalogo && o.catalogo.produto ? K.descricaoSemCodigo(o.catalogo.produto, o.codigo) : null;
    const cf = o.comparacaoFatura, ct = o.comparacaoTxt;
    const bloco = (t, v, extra) => `<div class="bx"><h4>${t}</h4>${v ? v : '<span class="mut">—</span>'}${extra || ''}</div>`;
    const toks = (l, cls) => (l || []).map(t => `<span class="tok ${cls}">${esc(D.NOMES_TIPO[t.tipo] || t.tipo)}: ${esc(t.valor)}</span>`).join('') || '<span class="mut sm">nenhuma</span>';
    modal({
      titulo: 'Descrições · ' + o.codigo, largo: true,
      corpo: `${cf ? `<p class="sm">Semelhança invoice × catálogo: <b>${Math.round(cf.similaridade * 100)}%</b>${ct && ct.comFatura ? ` · TXT × invoice: <b>${Math.round(ct.comFatura.similaridade * 100)}%</b>` : ''}${ct && ct.comCatalogo ? ` · TXT × catálogo: <b>${Math.round(ct.comCatalogo.similaridade * 100)}%</b>` : ''}</p>` : ''}
      <div class="cmp">${bloco('Invoice', inv ? marcarTokens(inv, cf && cf.faltamNoCatalogo, 'f') : null)}${bloco(`Catálogo ${o.catalogo && o.catalogo.produto ? `(produto ${esc(o.catalogo.produto.codigo)} v${esc(o.catalogo.produto.versao)})` : ''}`, cat ? marcarTokens(cat, cf && cf.faltamNaFatura, 'c') : null)}
      ${bloco('TXT (TOTVS)', txt ? esc(txt) : null)}${bloco('Relatório de itens', rel ? esc(rel) : null)}</div>
      ${cf ? `<div style="margin-top:12px"><div class="sm b">Informações sensíveis da invoice que não estão no catálogo</div>${toks(cf.faltamNoCatalogo, 'f')}<div class="sm b" style="margin-top:8px">Informações do catálogo que não estão na invoice</div>${toks(cf.faltamNaFatura, 'c')}</div>` : ''}`,
      botoes: [{ txt: 'Fechar' }]
    });
  }

  /* ---------------- editor do parecer (PDF) ---------------- */
  function editorParecer(a, p, ocs) {
    const r = a.resultado || {}, rs = a.resumo || {};
    const pr = Object.assign({ saudacao: 'Bom dia!', intro: 'Segue abaixo análise da documentação em questão:', observacoes: '', fechamento: 'Atenciosamente,', assinatura: a.analista_nome || EU.nome, extras: {}, detalhamento: true }, a.parecer || {});
    const lista = ocs.filter(o => o.status !== 'substituida').map(o => ({ id: o.id, documento: o.documento, incluir: !!o.incluir_pdf, texto: o.texto_pdf || o.sugestao || o.mensagem, sev: o.severidade, interna: o.interna, item: o.item, campo: o.campo, encontrado: o.encontrado, esperado: o.esperado, original: { incluir: !!o.incluir_pdf, texto: o.texto_pdf } }));
    const RAPIDOS = { ce: ['CE ainda não foi desconsolidado.', 'CE em conformidade.'], catalogo: ['Estamos realizando o cadastro dos itens e do fabricante; assim que finalizarmos, notificaremos.'] };
    const bl09 = ocs.find(o => o.regra === 'BL-09' && o.status !== 'substituida');
    if (bl09) RAPIDOS.ce.unshift(`Notar que faltou incluir a(s) NCM(s) ${String(bl09.sugestao || '').match(/NCM\(s\) ([\d, ]+)/) ? String(bl09.sugestao).match(/NCM\(s\) ([\d, ]+)/)[1].trim() : ''} no CE.`);
    const secoes = R.SECOES.filter(([k]) => k !== 'processo' || lista.some(o => o.documento === 'processo'));
    const corpo = `<div class="pdfed"><div>
      <div class="row r2"><div><label class="f">Saudação</label><input class="in" id="pSa" value="${esc(pr.saudacao)}"></div><div><label class="f">Assinatura</label><input class="in" id="pAs" value="${esc(pr.assinatura)}"></div></div>
      <label class="f">Introdução</label><input class="in" id="pIn" value="${esc(pr.intro)}" style="margin-bottom:12px">
      ${secoes.map(([k, t]) => `<div class="sec" data-sec="${k}"><h4># ${esc(t)}</h4>${lista.filter(o => o.documento === k).map(o => `<div class="li ${o.incluir ? '' : 'off'}" data-li="${o.id}"><input type="checkbox" ${o.incluir ? 'checked' : ''} title="Incluir no parecer"><textarea class="in">${esc(o.texto)}</textarea></div>`).join('') || ''}
        <div class="ex">${(pr.extras[k] || []).map(t => `<div class="li" data-ex><input type="checkbox" checked><textarea class="in">${esc(t)}</textarea></div>`).join('')}</div>
        <div class="acts"><button class="bt3" data-add="${k}">+ observação</button>${(RAPIDOS[k] || []).map(t => `<button class="bt3" data-rap="${k}" data-t="${esc(t)}">+ “${esc(t.length > 48 ? t.slice(0, 46) + '…' : t)}”</button>`).join('')}</div></div>`).join('')}
      <label class="f">Observações adicionais</label><textarea class="in" id="pOb" placeholder="Ex.: taxas consideradas, valores em BRL/USD, prazos">${esc(pr.observacoes)}</textarea>
      <div class="row r2" style="margin-top:10px"><div><label class="f">Fechamento</label><input class="in" id="pFe" value="${esc(pr.fechamento)}"></div><div><label class="f">Anexo</label><label class="sm"><input type="checkbox" id="pDet" ${pr.detalhamento ? 'checked' : ''}> Incluir “Detalhamento por item” no PDF</label></div></div>
      </div><div><div class="sm mut" style="margin-bottom:6px">Prévia do texto (o PDF segue a identidade visual da Ágil)</div><div class="prev" id="pPrev"></div></div></div>`;
    const m = modal({ titulo: `Parecer · IP ${p.ref_cliente} · análise nº ${a.numero}`, corpo, largo: true, botoes: [{ txt: 'Fechar' }, { txt: 'Copiar texto', cls: 'bt2', acao: async () => { await salvar(false); copiar(montar().texto); return false; } }, { txt: 'Salvar', cls: 'bt2', acao: async () => { await salvar(false); toast('Parecer salvo.'); return false; } }, { txt: 'Gerar PDF', cls: 'bt', acao: async (f) => { await salvar(true); return false; } }] });
    const f = m.el;
    const ler = () => {
      $$('[data-li]', f).forEach(el => { const o = lista.find(x => x.id === el.dataset.li); o.incluir = $('input', el).checked; o.texto = $('textarea', el).value; el.classList.toggle('off', !o.incluir); });
      const extras = {};
      $$('[data-sec]', f).forEach(s => { extras[s.dataset.sec] = $$('[data-ex]', s).filter(el => $('input', el).checked).map(el => $('textarea', el).value.trim()).filter(Boolean); });
      Object.assign(pr, { saudacao: $('#pSa', f).value, intro: $('#pIn', f).value, observacoes: $('#pOb', f).value, fechamento: $('#pFe', f).value, assinatura: $('#pAs', f).value, extras, detalhamento: $('#pDet', f).checked });
    };
    const montar = () => {
      ler();
      return R.montarParecer(r, lista.filter(o => o.incluir).map(o => ({ documento: o.documento, texto: o.texto })), { saudacao: pr.saudacao, intro: pr.intro, observacoes: pr.observacoes, fechamento: pr.fechamento + (pr.assinatura ? '\n' + pr.assinatura : ''), extras: pr.extras, documentosAnalisados: rs.documentos || [] });
    };
    const ajusta = el => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 220) + 'px'; };
    const prev = () => { $('#pPrev', f).textContent = montar().texto; };
    setTimeout(() => $$('textarea', f).forEach(ajusta), 30);
    f.addEventListener('input', e => { if (e.target.tagName === 'TEXTAREA') ajusta(e.target); });
    f.addEventListener('input', prev);
    f.addEventListener('change', prev);
    f.addEventListener('click', e => {
      const add = e.target.closest('[data-add],[data-rap]');
      if (!add) return;
      const k = add.dataset.add || add.dataset.rap;
      const ex = $(`[data-sec="${k}"] .ex`, f);
      const d = document.createElement('div');
      d.className = 'li'; d.setAttribute('data-ex', '');
      d.innerHTML = `<input type="checkbox" checked><textarea class="in">${esc(add.dataset.t || '')}</textarea>`;
      ex.appendChild(d);
      $('textarea', d).focus();
      prev();
    });
    async function salvar(gerarPdf) {
      const par = montar();
      const mud = lista.filter(o => o.incluir !== o.original.incluir || o.texto !== (o.original.texto || ''));
      for (const o of mud) { await dados(sb.from('confere_ocorrencias').update({ incluir_pdf: o.incluir, texto_pdf: o.texto }).eq('id', o.id)); o.original = { incluir: o.incluir, texto: o.texto }; const oc = ocs.find(x => x.id === o.id); if (oc) { oc.incluir_pdf = o.incluir; oc.texto_pdf = o.texto; } }
      const parecer = { saudacao: pr.saudacao, intro: pr.intro, observacoes: pr.observacoes, fechamento: pr.fechamento, assinatura: pr.assinatura, extras: pr.extras, detalhamento: pr.detalhamento, secoes: par.secoes };
      await dados(sb.from('confere_analises').update({ parecer }).eq('id', a.id));
      a.parecer = parecer;
      if (!gerarPdf) return;
      const docRes = r.documentos || {};
      const inv = docRes.invoice || {};
      const sel = lista.filter(o => o.incluir);
      const ajustes = par.secoes.reduce((s, x) => s + x.itens.filter(t => !/^(Documento em conformidade|Todos os itens estão publicados)/.test(t)).length, 0);
      const nomesDocs = (rs.documentos || []).map(k => R.DOCS[k]).join(', ');
      const dadosPdf = {
        titulo: a.fase === 'pre_alerta' ? 'Análise prévia · pré-alerta' : 'Conferência para registro',
        subtitulo: `IP ${p.ref_cliente}${p.ref_agil ? ' · ' + p.ref_agil : ''} · Análise nº ${a.numero}`,
        refCurta: `IP ${p.ref_cliente} · nº ${a.numero}`,
        campos: [['Importador', IMP.nome], ['CNPJ', R.fmtCnpj(IMP.cnpj)], ['Exportador', inv.exportador || p.exportador || '—'], ['Ref. cliente (IP)', p.ref_cliente], ['Ref. Ágil', p.ref_agil || '—'], ['Invoice', inv.numero || p.invoice || '—'], ['Incoterm · moeda', [inv.incoterm, inv.moeda].filter(Boolean).join(' · ') || '—'], ['Data da análise', dataHora(a.criado_em)], ['Analista', a.analista_nome], ['Catálogo de produtos', rs.catalogo ? 'versão de ' + dataHora(rs.catalogo.geradoEm) : 'não utilizado'], ['Documentos analisados', nomesDocs || '—'], ['Itens conferidos', String(rs.itens || 0)]],
        totalAjustes: ajustes,
        resumoLinha: ajustes ? `Pontos de ajuste em: ${listaDocs(par.secoes.filter(s => s.itens.some(t => !/^(Documento em conformidade|Todos os itens)/.test(t))).map(s => R.DOCS[s.documento] || s.titulo))}.` : 'Documentos analisados sem pontos de ajuste.',
        saudacao: pr.saudacao, intro: pr.intro, secoes: par.secoes, observacoes: pr.observacoes, fechamento: pr.fechamento, assinatura: pr.assinatura,
        detalhes: pr.detalhamento ? sel.filter(o => o.item && (o.encontrado || o.esperado)).map(o => ({ item: o.item, documento: R.DOCS[o.documento] || o.documento, campo: o.campo || '', encontrado: o.encontrado || '', esperado: o.esperado || '' })) : []
      };
      const blob = await window.ConferePDF.gerar(dadosPdf);
      const nome = `Analise_documental_IP_${nomeSeguro(p.ref_cliente)}_n${a.numero}.pdf`;
      baixar(blob, nome);
      const caminho = `pdfs/${p.id}/${a.id}.pdf`;
      const up = await sb.storage.from('confere').upload(caminho, blob, { upsert: true, contentType: 'application/pdf' });
      if (up.error) { toast('PDF gerado, mas não foi salvo no sistema: ' + up.error.message, true); return; }
      await dados(sb.from('confere_analises').update({ pdf_path: caminho, pdf_emitido_por: EU.email, pdf_emitido_em: new Date().toISOString() }).eq('id', a.id));
      a.pdf_path = caminho;
      toast('PDF gerado e salvo no processo.');
    }
    prev();
  }

  /* ---------------- ocorrências (menu separado) ---------------- */
  async function vOcorrencias() {
    const [ocs, procs] = await Promise.all([
      todos(() => sb.from('confere_ocorrencias').select('*').in('status', ['aberta', 'tratada']).order('criado_em', { ascending: false })),
      dados(sb.from('confere_processos').select('id,ref_cliente,ref_agil,status').eq('importador_id', IMP.id))
    ]);
    const anals = await dados(sb.from('confere_analises').select('id,numero,fase').order('criado_em', { ascending: false }).limit(3000));
    const P = new Map(procs.map(p => [p.id, p])), A = new Map(anals.map(a => [a.id, a]));
    const f = { st: 'aberta', sev: 'pend', doc: '', q: '' };
    view().innerHTML = `<div class="top"><div><div class="eb">Tratamento</div><h1 class="tt">Ocorrências <span>em aberto</span></h1><div class="sub">Para cada divergência: escolha a ação (Ajuste Cliente, Ajuste Catálogo, Ajuste Documento ou Ciente e OK) e registre se o processo segue ou não.</div></div></div>
      <div class="card"><div class="acts"><input class="in" id="oQ" placeholder="Buscar processo, item ou texto" style="max-width:280px">
      <select class="in" id="oSt" style="max-width:170px"><option value="aberta">Sem decisão</option><option value="tratada">Tratadas</option><option value="">Todas</option></select>
      <select class="in" id="oSev" style="max-width:200px"><option value="pend">Bloqueantes e alertas</option><option value="bloqueante">Só bloqueantes</option><option value="alerta">Só alertas</option><option value="info">Informativos</option><option value="">Todas</option></select>
      <select class="in" id="oDoc" style="max-width:200px"><option value="">Todos os documentos</option>${R.SECOES.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></div></div><div id="oLista"></div>`;
    const desenhar = () => {
      const q = U.norm(f.q);
      const l = ocs.filter(o => (!f.st || o.status === f.st) && (f.sev === '' || (f.sev === 'pend' ? o.severidade !== 'info' : o.severidade === f.sev)) && (!f.doc || o.documento === f.doc) && (!q || U.norm([o.mensagem, o.item, (P.get(o.processo_id) || {}).ref_cliente, (P.get(o.processo_id) || {}).ref_agil].join(' ')).includes(q)));
      const porProc = new Map();
      l.forEach(o => { if (!porProc.has(o.processo_id)) porProc.set(o.processo_id, []); porProc.get(o.processo_id).push(o); });
      $('#oLista').innerHTML = porProc.size ? [...porProc.entries()].map(([pid, g]) => { const p = P.get(pid) || {}; return `<div class="grp-doc" style="cursor:pointer" data-p="${pid}">IP ${esc(p.ref_cliente || '?')} ${esc(p.ref_agil || '')} <span class="badge sev-info">${g.length}</span></div>` + g.slice(0, 200).map(o => { const an = A.get(o.analise_id); return cartaoOcorrencia(o, an ? `<a class="sm" href="#a-${an.id}">análise nº ${an.numero} · ${FASES[an.fase]}</a>` : ''); }).join(''); }).join('') : '<div class="card empty">Nenhuma ocorrência com estes filtros.</div>';
    };
    $('#oQ').oninput = e => { f.q = e.target.value; desenhar(); };
    $('#oSt').onchange = e => { f.st = e.target.value; desenhar(); };
    $('#oSev').onchange = e => { f.sev = e.target.value; desenhar(); };
    $('#oDoc').onchange = e => { f.doc = e.target.value; desenhar(); };
    $('#oLista').addEventListener('click', e => { const g = e.target.closest('[data-p]'); if (g) location.hash = 'p-' + g.dataset.p; });
    ligarControles($('#oLista'), ocs, () => {});
    desenhar();
  }

  /* ---------------- alertas ---------------- */
  async function vAlertas() {
    const [als, procs] = await Promise.all([
      dados(sb.from('confere_alertas').select('*').order('criado_em', { ascending: false }).limit(1000)),
      dados(sb.from('confere_processos').select('id,ref_cliente,ref_agil,status').eq('importador_id', IMP.id))
    ]);
    const P = new Map(procs.map(p => [p.id, p]));
    const abertos = als.filter(a => a.status === 'aberto'), resolvidos = als.filter(a => a.status !== 'aberto').slice(0, 50);
    const linha = a => {
      const p = P.get(a.processo_id) || {};
      const antes = a.antes || {}, depois = (a.depois || [])[0] || {};
      return `<tr><td><a href="#p-${a.processo_id}"><b>IP ${esc(p.ref_cliente || '?')}</b></a><div class="sm mut">${esc(p.ref_agil || '')}</div></td><td class="mono"><b>${esc(a.codigo_interno)}</b></td><td>${esc(ncmTexto(a.mensagem))}<div class="sm mut">Antes: produto ${esc(antes.produto || '—')} v${esc(antes.versao || '—')} · NCM ${U.fmtNcm(antes.ncm_catalogo)} → agora: ${depois.codigo ? `produto ${esc(depois.codigo)} v${esc(depois.versao)} · NCM ${U.fmtNcm(depois.ncm)}` : 'sem produto ativo'}</div></td><td>${dataHora(a.criado_em)}</td>
        <td>${a.status === 'aberto' ? `<div class="acts"><button class="bt2" data-nova="${a.processo_id}">Nova análise</button><button class="bt2" data-res="${a.id}">Resolver</button></div>` : `<span class="badge sev-ok">resolvido</span><div class="sm mut">${esc(nomeUsuario(a.resolvido_por))} · ${dataHora(a.resolvido_em)}${a.nota ? ' · ' + esc(a.nota) : ''}</div>`}</td></tr>`;
    };
    view().innerHTML = `<div class="top"><div><div class="eb">Monitoramento</div><h1 class="tt">Alertas de <span>catálogo</span></h1><div class="sub">Gerados quando uma nova versão do catálogo altera item já analisado em processo ainda não registrado.</div></div></div>
      <div class="banner al"><div><div class="t">O que revisar em cada alerta</div><div class="d">Numerário (NCM e alíquotas), relatório de itens, BL e CE Mercante (posições de NCM), planilha de diferimento de ICMS e rascunho da DUIMP. Depois, rode nova análise de pré-registro.</div></div></div>
      <div class="card"><h2>Em aberto (${abertos.length})</h2>${abertos.length ? `<div class="tbw"><table class="tb"><thead><tr><th>Processo</th><th>Código interno</th><th>Mudança</th><th>Gerado em</th><th></th></tr></thead><tbody>${abertos.map(linha).join('')}</tbody></table></div>` : '<div class="empty">Nenhum alerta em aberto.</div>'}</div>
      ${resolvidos.length ? `<div class="card"><h2>Resolvidos recentemente</h2><table class="tb"><thead><tr><th>Processo</th><th>Código interno</th><th>Mudança</th><th>Gerado em</th><th>Status</th></tr></thead><tbody>${resolvidos.map(linha).join('')}</tbody></table></div>` : ''}`;
    view().onclick = e => {
      const n = e.target.closest('[data-nova]'); if (n) { location.hash = 'nova-' + n.dataset.nova; return; }
      const r = e.target.closest('[data-res]');
      if (r) modal({ titulo: 'Resolver alerta', corpo: `<label class="f">O que foi feito</label><textarea class="in" id="aNota" placeholder="Ex.: numerário reemitido, CE retificado, nova análise nº 4"></textarea>`, botoes: [{ txt: 'Cancelar' }, { txt: 'Marcar como resolvido', cls: 'bt ok', acao: async f => { await dados(sb.from('confere_alertas').update({ status: 'resolvido', nota: $('#aNota', f).value.trim() || null, resolvido_por: EU.email, resolvido_em: new Date().toISOString() }).eq('id', r.dataset.res)); toast('Alerta resolvido.'); contadores(); rota(); } }] });
    };
  }

  /* ---------------- catálogo ---------------- */
  async function vCatalogo() {
    await carregarCatalogo(true);
    const versoes = await dados(sb.from('confere_catalogo_versoes').select('id,arquivo_nome,gerado_em,total,ativos,desativados,resumo,carregado_por,carregado_em,storage_path').eq('importador_id', IMP.id).order('gerado_em', { ascending: false, nullsFirst: false }).order('carregado_em', { ascending: false }).limit(100));
    const saude = CAT ? K.saudeCatalogo(CAT) : null;
    view().innerHTML = `<div class="top"><div><div class="eb">Base</div><h1 class="tt">Catálogo de produtos <span>Eletra</span></h1><div class="sub">Cada carga do JSON exportado do Portal Único vira uma versão. Nada é sobrescrito: o sistema compara com a versão anterior e gera alertas para processos em aberto.</div></div></div>
      <div class="card"><h2>Versão vigente</h2>${CAT ? `<dl class="kv"><dt>Arquivo</dt><dd>${esc(CAT.meta.arquivo)}</dd><dt>Gerado em</dt><dd>${dataHora(CAT.meta.geradoEm)}</dd><dt>Carregado</dt><dd>${dataHora(CAT.meta.carregadoEm)} por ${esc(nomeUsuario(CAT.meta.carregadoPor))}</dd><dt>Produtos</dt><dd>${CAT.meta.total} (${CAT.meta.ativos} ativos, ${CAT.meta.desativados} desativados)</dd></dl>
        <div class="acts" style="margin-top:12px"><button class="bt2" id="bMult">${saude.multiplos.length} códigos internos com mais de um produto ativo</button><button class="bt2" id="bPh">${saude.placeholders.length} produtos ativos com campos genéricos na descrição</button></div>` : '<div class="empty">Nenhum catálogo carregado ainda. Envie o JSON abaixo.</div>'}</div>
      <div class="card"><h2>Atualizar catálogo</h2><p class="cs">Exporte o catálogo no Portal Único (JSON) e arraste aqui. Antes de salvar, você vê o que mudou.</p>
      <div class="drop" id="cDrop"><h3>JSON do catálogo</h3><div class="hint">Arquivo CATALOGO_PRODUTOS_&lt;CNPJ&gt;_&lt;data&gt;.json</div><div><label class="bt2" style="cursor:pointer">Escolher arquivo<input type="file" hidden id="cIn" accept=".json"></label></div><div id="cPrev"></div></div></div>
      <div class="card"><h2>Consultar código interno</h2><div class="acts"><input class="in" id="cQ" placeholder="Ex.: MLT72R12023" style="max-width:300px"><button class="bt2" id="cB">Consultar</button></div><div id="cRes" style="margin-top:12px"></div></div>
      <div class="card"><h2>Versões carregadas</h2>${versoes.length ? `<table class="tb"><thead><tr><th>Gerado em</th><th>Arquivo</th><th>Carregado</th><th class="num">Ativos / total</th><th>Mudanças</th><th>Alertas</th></tr></thead><tbody>${versoes.map(v => `<tr><td>${dataHora(v.gerado_em)}</td><td>${esc(v.arquivo_nome)}</td><td>${dataHora(v.carregado_em)}<div class="sm mut">${esc(nomeUsuario(v.carregado_por))}</div></td><td class="num">${v.ativos} / ${v.total}</td><td>${v.resumo && v.resumo.anterior ? `${v.resumo.alterados || 0} alterados · ${v.resumo.novos || 0} novos · ${v.resumo.removidos || 0} removidos` : '<span class="mut">primeira versão</span>'}</td><td>${v.resumo && v.resumo.alertas ? `<span class="badge sev-alerta">${v.resumo.alertas}</span>` : '<span class="mut">—</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma versão.</div>'}</div>`;
    if (CAT) {
      $('#bMult').onclick = () => modal({ titulo: 'Códigos internos com mais de um produto ativo', largo: true, corpo: `<p class="sm mut">A DUIMP pode puxar o produto errado. Mantenha um único produto ativo por código interno.</p><table class="tb"><thead><tr><th>Código interno</th><th>Produtos ativos</th></tr></thead><tbody>${saude.multiplos.map(m => `<tr><td class="mono">${esc(m.codigoInterno)}</td><td>${m.produtos.map(p => `${esc(p.codigo)} v${esc(p.versao)} · ${U.fmtNcm(p.ncm)}`).join('<br>')}</td></tr>`).join('')}</tbody></table>`, botoes: [{ txt: 'Fechar' }] });
      $('#bPh').onclick = () => modal({ titulo: 'Descrições com campos genéricos', largo: true, corpo: `<p class="sm mut">Ex.: XXXX, MMMM. Os valores reais precisam constar na DUIMP.</p><table class="tb"><thead><tr><th>Produto</th><th>Código interno</th><th>Campos</th></tr></thead><tbody>${saude.placeholders.map(m => `<tr><td>${esc(m.codigo)}</td><td class="mono">${esc(m.codigosInterno.join(', '))}</td><td>${esc(m.campos.join(', '))}</td></tr>`).join('')}</tbody></table>`, botoes: [{ txt: 'Fechar' }] });
    }
    const consultar = async () => {
      const q = $('#cQ').value.trim();
      if (!q) return;
      const atual = CAT ? K.consultarCatalogo(CAT, q) : null;
      const hist = await dados(sb.from('confere_catalogo_produtos').select('versao_id,codigo,situacao,ncm,versao,descricao').ilike('codigo_interno', q).limit(200));
      const V = new Map(versoes.map(v => [v.id, v]));
      $('#cRes').innerHTML = `${atual ? `<p><b>Situação na versão vigente:</b> ${{ ativo: 'ativo', multiplos: 'mais de um produto ativo', desativado: 'só desativado', nao_encontrado: 'não cadastrado' }[atual.status]}</p>${[...atual.ativos, ...atual.inativos].map(p => `<div class="oc ${K.ehAtivo(p) ? '' : 'tratada'}"><div class="h"><b>Produto ${esc(p.codigo)} v${esc(p.versao)}</b><span class="badge ${K.ehAtivo(p) ? 'sev-ok' : 'sev-info'}">${esc(p.situacao)}</span><span>NCM ${U.fmtNcm(p.ncm)}</span></div><div class="m sm">${esc(p.descricao)}</div></div>`).join('')}` : ''}
        ${hist.length ? `<div class="sm b" style="margin-top:10px">Nas versões carregadas</div><table class="tb"><thead><tr><th>Versão do catálogo</th><th>Produto</th><th>Situação</th><th>NCM</th></tr></thead><tbody>${hist.sort((a, b) => String((V.get(b.versao_id) || {}).gerado_em).localeCompare(String((V.get(a.versao_id) || {}).gerado_em))).map(h => `<tr><td>${dataHora((V.get(h.versao_id) || {}).gerado_em)}</td><td>${esc(h.codigo)} v${esc(h.versao)}</td><td>${esc(h.situacao)}</td><td>${U.fmtNcm(h.ncm)}</td></tr>`).join('')}</tbody></table>` : ''}`;
    };
    $('#cB').onclick = consultar;
    $('#cQ').onkeydown = e => { if (e.key === 'Enter') consultar(); };
    const receber = async file => {
      const box = $('#cPrev');
      try {
        box.innerHTML = '<div class="prog">Lendo o catálogo…</div>';
        const buf = await file.arrayBuffer();
        const hash = await hashArquivo(buf);
        const json = JSON.parse(U.decodificar(buf));
        const novo = K.lerCatalogo(json, file.name);
        if (novo.meta.cnpjRaiz && novo.meta.cnpjRaiz !== String(IMP.cnpj).slice(0, 8)) throw new Error(`Este catálogo é do CNPJ raiz ${novo.meta.cnpjRaiz}, não da Eletra.`);
        const ja = await dados(sb.from('confere_catalogo_versoes').select('id,carregado_em').eq('importador_id', IMP.id).eq('arquivo_hash', hash));
        if (ja.length) { box.innerHTML = `<div class="warn">Este mesmo arquivo já foi carregado em ${dataHora(ja[0].carregado_em)}.</div>`; return; }
        const dif = K.diffCatalogos(CAT || null, novo);
        const lista = (t, l, f) => l.length ? `<div class="sm b" style="margin-top:8px">${t} (${l.length})</div><div class="sm">${l.slice(0, 40).map(f).join('<br>')}${l.length > 40 ? '<br>…' : ''}</div>` : '';
        const curto = x => x ? `${x.codigo} v${x.versao} · ${U.fmtNcm(x.ncm)}` : '—';
        box.innerHTML = `<div class="file"><b>${esc(file.name)}</b> · gerado em ${dataHora(novo.meta.geradoEm)} · ${novo.meta.total} produtos (${novo.meta.ativos} ativos)
          ${CAT ? `<div style="margin-top:6px">Comparado à versão vigente: <b>${dif.alterados.length}</b> alterados, <b>${dif.novos.length}</b> novos, <b>${dif.removidos.length}</b> removidos.</div>
          ${lista('Alterados', dif.alterados, a => `<span class="mono">${esc(a.codigoInterno)}</span>: ${esc(a.antes.map(curto).join(', ') || '—')} → ${esc(a.depois.map(curto).join(', ') || 'sem ativo')} <span class="mut">(${esc(a.mudancas.join(', '))})</span>`)}
          ${lista('Novos', dif.novos, a => `<span class="mono">${esc(a.codigoInterno)}</span>: ${esc(a.depois.map(curto).join(', ') || 'sem ativo')}`)}
          ${lista('Removidos', dif.removidos, a => `<span class="mono">${esc(a.codigoInterno)}</span>`)}` : '<div style="margin-top:6px">Primeira versão do catálogo no sistema.</div>'}
          <div class="acts" style="margin-top:12px"><button class="bt" id="cSalvar">Salvar nova versão</button><span class="prog" id="cProg"></span></div></div>`;
        $('#cSalvar').onclick = async () => {
          const bt = $('#cSalvar'), pg = $('#cProg');
          bt.disabled = true;
          try {
            pg.textContent = 'Criando a versão…';
            const [v] = await dados(sb.from('confere_catalogo_versoes').insert({ importador_id: IMP.id, arquivo_nome: file.name, arquivo_hash: hash, gerado_em: novo.meta.geradoEm, total: novo.meta.total, ativos: novo.meta.ativos, desativados: novo.meta.desativados }).select('id'));
            const linhas = [];
            const vistos = new Set();
            novo.produtos.forEach(p => (p.codigosInterno.length ? p.codigosInterno : [SEM_CI]).forEach(ci => {
              const k = p.codigo + '|' + ci;
              if (vistos.has(k)) return;
              vistos.add(k);
              linhas.push({ versao_id: v.id, codigo: p.codigo, codigo_interno: ci, seq: p.seq, situacao: p.situacao, ativo: K.ehAtivo(p), ncm: p.ncm, versao: p.versao, denominacao: p.denominacao, descricao: p.descricao, atributos: p.atributos, inicio_vigencia: p.inicioVigencia, fim_vigencia: p.fimVigencia, assinatura: p.assinatura });
            }));
            for (let k = 0; k < linhas.length; k += 400) { pg.textContent = `Gravando produtos ${Math.min(k + 400, linhas.length)}/${linhas.length}…`; await dados(sb.from('confere_catalogo_produtos').insert(linhas.slice(k, k + 400))); }
            pg.textContent = 'Guardando o arquivo original…';
            const caminho = `catalogos/${v.id}.json`;
            const up = await sb.storage.from('confere').upload(caminho, new Blob([buf], { type: 'application/json' }), { upsert: true });
            if (!up.error) await dados(sb.from('confere_catalogo_versoes').update({ storage_path: caminho }).eq('id', v.id));
            pg.textContent = 'Comparando com a versão anterior e gerando alertas…';
            const res = await dados(sb.rpc('confere_processar_catalogo', { p_versao: v.id }));
            CAT = null;
            toast(`Catálogo salvo. ${res.alterados || 0} alterações; ${res.alertas || 0} alerta(s) gerado(s) para processos em aberto.`);
            contadores();
            vCatalogo();
          } catch (e) { pg.textContent = ''; toast('Falha ao salvar o catálogo: ' + erroMsg(e), true); bt.disabled = false; }
        };
      } catch (e) { box.innerHTML = `<div class="err">${esc(erroMsg(e))}</div>`; }
    };
    $('#cIn').onchange = e => { if (e.target.files[0]) receber(e.target.files[0]); };
    const dz = $('#cDrop');
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('on'); };
    dz.ondragleave = () => dz.classList.remove('on');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('on'); if (e.dataTransfer.files[0]) receber(e.dataTransfer.files[0]); };
  }

  /* ---------------- histórico ---------------- */
  async function vHistorico() {
    const [anals, procs] = await Promise.all([
      dados(sb.from('confere_analises').select('id,processo_id,numero,fase,resumo,decisao,analista_nome,analista_email,criado_em,pdf_path').order('criado_em', { ascending: false }).limit(2000)),
      dados(sb.from('confere_processos').select('id,ref_cliente,ref_agil').eq('importador_id', IMP.id))
    ]);
    const P = new Map(procs.map(p => [p.id, p]));
    const analistas = [...new Set(anals.map(a => a.analista_nome))].sort();
    view().innerHTML = `<div class="top"><div><div class="eb">Base</div><h1 class="tt">Histórico de <span>análises</span></h1><div class="sub">Todas as análises, com o perfil de quem realizou, o resultado e a decisão.</div></div></div>
      <div class="card"><div class="acts" style="margin-bottom:12px"><select class="in" id="hAn" style="max-width:220px"><option value="">Todos os analistas</option>${analistas.map(n => `<option>${esc(n)}</option>`).join('')}</select><select class="in" id="hFa" style="max-width:200px"><option value="">Todas as fases</option><option value="pre_alerta">Pré-alerta</option><option value="pre_registro">Pré-registro</option></select><input class="in" id="hMes" type="month" style="max-width:180px"></div>
      <div class="tbw"><table class="tb"><thead><tr><th>Data</th><th>Processo</th><th>Fase</th><th>Nº</th><th>Analista</th><th>Resultado</th><th>Decisão</th><th>PDF</th></tr></thead><tbody id="hT"></tbody></table></div></div>`;
    const desenhar = () => {
      const an = $('#hAn').value, fa = $('#hFa').value, mes = $('#hMes').value;
      const l = anals.filter(a => (!an || a.analista_nome === an) && (!fa || a.fase === fa) && (!mes || a.criado_em.slice(0, 7) === mes));
      $('#hT').innerHTML = l.map(a => { const p = P.get(a.processo_id) || {}; return `<tr class="cl" data-a="${a.id}"><td>${dataHora(a.criado_em)}</td><td><b>IP ${esc(p.ref_cliente || '?')}</b><div class="sm mut">${esc(p.ref_agil || '')}</div></td><td>${FASES[a.fase]}</td><td>${a.numero}</td><td>${esc(a.analista_nome)}<div class="sm mut">${esc(a.analista_email)}</div></td><td>${chipsResumo(a.resumo)}</td><td>${a.decisao ? (a.decisao === 'seguir' ? '<span class="badge sev-ok">Seguir</span>' : '<span class="badge sev-bloqueante">Não seguir</span>') : '<span class="mut sm">pendente</span>'}</td><td>${a.pdf_path ? '<span class="badge sev-info">emitido</span>' : '<span class="mut sm">—</span>'}</td></tr>`; }).join('') || '<tr><td colspan="8"><div class="empty">Nenhuma análise.</div></td></tr>';
    };
    ['#hAn', '#hFa', '#hMes'].forEach(s => $(s).onchange = desenhar);
    $('#hT').onclick = e => { const tr = e.target.closest('tr[data-a]'); if (tr) location.hash = 'a-' + tr.dataset.a; };
    desenhar();
  }

  /* ---------------- regras ---------------- */
  async function vRegras() {
    const regs = await carregarRegras(true);
    const master = EU.papel === 'master';
    const porDoc = R.SECOES.map(([k, t]) => [t, regs.filter(r => r.documento === k)]).filter(g => g[1].length);
    view().innerHTML = `<div class="top"><div><div class="eb">Configuração</div><h1 class="tt">Matriz de <span>regras</span></h1><div class="sub">A leitura extrai os dados; a regra decide. ${master ? 'Como master, você pode desligar uma regra ou mudar a severidade padrão.' : 'Somente usuários master alteram as regras.'} Regras “internas” não vão para o parecer do cliente por padrão.</div></div></div>
      ${porDoc.map(([t, l]) => `<div class="card"><h2># ${esc(t)}</h2><table class="tb"><thead><tr><th>Código</th><th>Regra</th><th>Severidade</th><th>Base</th><th>Fases</th><th>Uso</th><th>Ativa</th></tr></thead><tbody>${l.map(r => `<tr data-r="${r.codigo}"><td class="mono">${esc(r.codigo)}</td><td>${esc(r.titulo)}</td><td>${master ? `<select class="in" data-k="severidade" style="max-width:150px">${['bloqueante', 'alerta', 'info'].map(s => `<option value="${s}" ${r.severidade === s ? 'selected' : ''}>${SEV_NOME[s]}</option>`).join('')}</select>` : sev(r.severidade)}</td><td class="sm">${esc(r.base_legal || '')}</td><td class="sm">${(r.fases || []).map(f => FASES[f]).join(', ')}</td><td class="sm">${r.interna ? 'interna' : 'cliente'}</td><td>${master ? `<input type="checkbox" data-k="ativa" ${r.ativa ? 'checked' : ''}>` : (r.ativa ? 'sim' : 'não')}</td></tr>`).join('')}</tbody></table></div>`).join('')}`;
    if (master) view().onchange = async e => {
      const tr = e.target.closest('tr[data-r]'); const k = e.target.dataset.k; if (!tr || !k) return;
      const v = k === 'ativa' ? e.target.checked : e.target.value;
      try { await dados(sb.from('confere_regras').update({ [k]: v, atualizado_por: EU.email, atualizado_em: new Date().toISOString() }).eq('codigo', tr.dataset.r)); REGRAS_DB = null; toast('Regra atualizada.'); } catch (er) { toast(erroMsg(er), true); }
    };
  }

  /* ---------------- usuários ---------------- */
  async function vUsuarios() {
    if (EU.papel !== 'master') { view().innerHTML = '<div class="card empty">Somente usuários master.</div>'; return; }
    ACESSO = await dados(sb.from('confere_acesso').select('*').order('nome'));
    view().innerHTML = `<div class="top"><div><div class="eb">Configuração</div><h1 class="tt">Usuários e <span>acessos</span></h1><div class="sub">Cada analista entra com o próprio e-mail: o histórico registra quem fez cada análise. Quem já usa o Ágil Desk ou o Ágil Simula mantém o mesmo login e senha.</div></div></div>
      <div class="card"><h2>Adicionar usuário</h2><div class="row r4"><div><label class="f">Nome</label><input class="in" id="uNo" placeholder="Juan Pablo"></div><div><label class="f">E-mail</label><input class="in" id="uEm" placeholder="operacional7@agiladuaneira.com.br"></div><div><label class="f">Papel</label><select class="in" id="uPa"><option value="analista">Analista</option><option value="master">Master</option></select></div><div><label class="f">Senha provisória</label><input class="in" id="uSe" placeholder="mín. 8 caracteres"></div></div><button class="bt" id="uAdd">Liberar acesso</button><span class="prog sm"> O usuário troca a senha no primeiro acesso.</span></div>
      <div class="card"><h2>Usuários</h2><table class="tb"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th><th></th></tr></thead><tbody>${ACESSO.map(u => `<tr data-u="${esc(u.email)}"><td><b>${esc(u.nome || '')}</b></td><td>${esc(u.email)}</td><td><select class="in" data-k="papel" style="max-width:150px"><option value="analista" ${u.papel === 'analista' ? 'selected' : ''}>Analista</option><option value="master" ${u.papel === 'master' ? 'selected' : ''}>Master</option></select></td><td><input type="checkbox" data-k="ativo" ${u.ativo ? 'checked' : ''}></td><td><button class="bt3" data-sen="${esc(u.email)}">Redefinir senha</button></td></tr>`).join('')}</tbody></table></div>`;
    const chamar = async corpo => {
      const { data, error } = await sb.functions.invoke('confere-usuarios', { body: corpo });
      if (error) { let m = error.message; try { const j = await error.context.json(); m = j.erro || m; } catch (x) { /* */ } throw new Error(m); }
      if (data && data.erro) throw new Error(data.erro);
      return data;
    };
    $('#uAdd').onclick = async () => {
      try {
        const r = await chamar({ acao: 'criar', nome: $('#uNo').value.trim(), email: $('#uEm').value.trim(), papel: $('#uPa').value, senha: $('#uSe').value });
        toast(r.contaExistente ? 'Acesso liberado (o login já existia; a senha não mudou).' : 'Usuário criado. Passe a senha provisória para a pessoa.');
        vUsuarios();
      } catch (e) { toast(erroMsg(e), true); }
    };
    view().onchange = async e => {
      const tr = e.target.closest('tr[data-u]'); const k = e.target.dataset.k; if (!tr || !k) return;
      const v = k === 'ativo' ? e.target.checked : e.target.value;
      if (tr.dataset.u === EU.email && (k === 'ativo' && !v || k === 'papel' && v !== 'master')) { toast('Você não pode remover o seu próprio acesso master.', true); e.target.checked = true; e.target.value = 'master'; return; }
      try { await dados(sb.from('confere_acesso').update({ [k]: v }).eq('email', tr.dataset.u)); toast('Acesso atualizado.'); } catch (er) { toast(erroMsg(er), true); }
    };
    view().onclick = e => {
      const b = e.target.closest('[data-sen]'); if (!b) return;
      modal({ titulo: 'Redefinir senha', corpo: `<p class="sm">Nova senha provisória para <b>${esc(b.dataset.sen)}</b> (a pessoa troca no próximo acesso).</p><input class="in" id="nsP" placeholder="mín. 8 caracteres">`, botoes: [{ txt: 'Cancelar' }, { txt: 'Redefinir', cls: 'bt', acao: async f => { await chamar({ acao: 'redefinir', email: b.dataset.sen, senha: $('#nsP', f).value }); toast('Senha redefinida.'); } }] });
    };
  }

  /* ---------------- início ---------------- */
  window.__confere = { sb, estado: () => ({ EU, IMP, CAT }) };
  sb.auth.getSession().then(({ data }) => data.session ? entrar(data.session) : telaLogin());
})();
