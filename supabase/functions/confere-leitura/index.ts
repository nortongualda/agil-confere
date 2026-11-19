// Ágil Confere · leitura de páginas escaneadas pela Claude API.
// O navegador envia a imagem de UMA página; esta função confere o acesso,
// confere o limite mensal de gasto, chama a IA, registra o consumo e devolve
// a transcrição estruturada (cabeçalho, itens, totais e dúvidas de leitura).
// A chave da Anthropic fica só aqui, no segredo ANTHROPIC_API_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// US$ por milhão de tokens (entrada, saída)
const PRECOS: Record<string, [number, number]> = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-opus-5-5': [5, 25]
};
const custo = (m: string, e: number, s: number) => { const p = PRECOS[m] || PRECOS['claude-sonnet-5-5']; return (e * p[0] + s * p[1]) / 1e6; };

const TXT = { type: 'string' };
const NTXT = { type: ['string', 'null'] };
const ITEM = {
  type: 'object',
  properties: {
    seq: NTXT, ncm: NTXT, codigo: NTXT, descricao: NTXT, qtd: NTXT, unidade: NTXT, preco: NTXT, total: NTXT,
    pesoLiq: NTXT, pesoBruto: NTXT, volumes: NTXT, cubagem: NTXT, po: NTXT,
    fabricante: NTXT, fabEndereco: NTXT, fabPais: NTXT
  },
  required: ['seq', 'codigo', 'descricao', 'qtd']
};
const FERRAMENTA = {
  name: 'registrar_pagina',
  description: 'Registra a transcrição fiel de uma página de documento de importação.',
  input_schema: {
    type: 'object',
    properties: {
      secoes: {
        type: 'array',
        description: 'Uma seção por documento presente na página (normalmente uma).',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['invoice', 'packing', 'bl', 'outro'] },
            continuacao: { type: 'boolean', description: 'true se a página continua uma tabela iniciada em página anterior, sem cabeçalho próprio.' },
            campos: {
              type: 'object',
              description: 'Campos do cabeçalho e do rodapé, copiados exatamente como impressos. null se não existir na página.',
              properties: {
                numero: NTXT, data: NTXT, ipRef: NTXT, poRef: NTXT, incoterm: NTXT, moeda: NTXT, pagamento: NTXT,
                paisOrigem: NTXT, paisAquisicao: NTXT, paisProcedencia: NTXT, portoOrigem: NTXT, portoDestino: NTXT,
                exportador: NTXT, importador: NTXT, frete: NTXT, seguro: NTXT, desconto: NTXT, extenso: NTXT,
                volumes: NTXT, cubagem: NTXT, marcas: NTXT, madeira: NTXT, container: NTXT, lacre: NTXT,
                shipper: NTXT, consignee: NTXT, notify: NTXT, localRecebimento: NTXT, portoEmbarque: NTXT, portoDescarga: NTXT,
                destinoFinal: NTXT, transbordo: NTXT, navio: NTXT, freteModalidade: NTXT, freeTime: NTXT, pesoBruto: NTXT,
                descricaoMercadoria: NTXT, agente: NTXT
              }
            },
            colunas: { type: 'array', items: TXT, description: 'Títulos das colunas da tabela de itens, como impressos, da esquerda para a direita.' },
            itens: { type: 'array', items: ITEM },
            totais: {
              type: 'object',
              properties: { qtd: NTXT, total: NTXT, pesoLiq: NTXT, pesoBruto: NTXT, volumes: NTXT, cubagem: NTXT }
            }
          },
          required: ['tipo', 'continuacao', 'campos', 'itens']
        }
      },
      duvidas: {
        type: 'array',
        description: 'Cada valor que não está perfeitamente legível na imagem.',
        items: { type: 'object', properties: { seq: NTXT, campo: TXT, lido: NTXT, motivo: TXT }, required: ['campo', 'motivo'] }
      },
      texto: { type: 'string', description: 'Texto da página fora da tabela de itens, em ordem de leitura, linha a linha.' }
    },
    required: ['secoes', 'duvidas', 'texto']
  }
};

const INSTRUCOES = `Você transcreve documentos de importação (commercial invoice, packing list, bill of lading) escaneados ou fotografados para conferência aduaneira. Cada número será comparado com outros documentos, então a fidelidade é absoluta.

Regras:
1. Copie cada valor EXATAMENTE como impresso: mesmos dígitos, separadores de milhar e decimais ("1,234.50" continua "1,234.50"; "1.234,50" continua "1.234,50"). Não arredonde, não converta, não complete, não corrija erros do documento.
2. Nunca invente. Campo ausente na página = null. Se um valor está ilegível, borrado, cortado ou ambíguo (ex.: 8 ou 3, 0 ou O, 1 ou 7), registre sua melhor leitura e inclua uma entrada em "duvidas" com o seq do item, o campo e o motivo.
3. Tabela de itens: uma entrada por linha de item, na ordem do documento, sem pular nenhuma. Descrição em várias linhas vira um único texto (junte com espaço). Não inclua a linha de total como item; ela vai em "totais".
4. Campos do item: seq (nº da linha/item), ncm (HS code/NCM), codigo (part no./código do produto/model), descricao, qtd, unidade, preco (preço unitário), total (valor total da linha), pesoLiq (N.W.), pesoBruto (G.W.), volumes (pacotes/caixas da linha), cubagem, po (pedido), fabricante, fabEndereco (endereço do fabricante), fabPais (país do fabricante). Use null para colunas que não existem.
5. Campos de cabeçalho/rodapé: exportador, importador, shipper, consignee e notify recebem o bloco completo (nome, endereço, CNPJ/tax ID, contatos) com quebras de linha. incoterm recebe o texto completo (ex.: "FOB NINGBO"). frete/seguro/desconto: valor com o rótulo se houver. volumes: texto completo (ex.: "52 PALLETS"). marcas: shipping marks completas. madeira: a declaração sobre embalagem de madeira. Para BL: descricaoMercadoria recebe o texto completo da descrição das mercadorias (inclui NCMs, referências, cláusulas de frete e free time).
6. "continuacao" = true quando a página só continua a tabela de uma página anterior.
7. "texto" recebe o texto da página fora da tabela de itens (cabeçalho, blocos, rodapé, cláusulas), linha a linha, em ordem de leitura, com os valores exatos. Não repita ali as linhas de itens.
Responda apenas chamando a ferramenta registrar_pagina.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const chave = Deno.env.get('ANTHROPIC_API_KEY') || '';
  try {
    const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: u } = await comoUsuario.auth.getUser();
    if (!u || !u.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401);
    const { data: ok } = await comoUsuario.rpc('confere_usuario');
    if (!ok) return json({ erro: 'Sem acesso ao Ágil Confere.' }, 403);
    const email = String(u.user.email || '').toLowerCase();
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: cfgRow } = await admin.from('confere_config').select('valor').eq('chave', 'leitura_ia').maybeSingle();
    const cfg = Object.assign({ ativa: true, limite_mensal_usd: 15, modelo: 'claude-sonnet-5-5' }, (cfgRow && cfgRow.valor) || {});
    const { data: gasto, error: eGasto } = await admin.rpc('confere_ia_gasto_mes');
    const gastoMes = Number(gasto || 0);
    const body = await req.json().catch(() => ({}));
    // sem o controle de gasto no banco, nada de leitura paga
    if (eGasto && body.acao !== 'status') return json({ erro: 'Controle de gasto da leitura por IA indisponível no banco.', codigo: 'desligada' }, 503);

    if (body.acao === 'status') return json({ configurada: !!chave && !eGasto, ativa: !!cfg.ativa, limite: Number(cfg.limite_mensal_usd), gasto: gastoMes, modelo: cfg.modelo });
    if (!chave) return json({ erro: 'A leitura por IA ainda não foi configurada (falta a chave da API).', codigo: 'sem_chave' }, 503);
    if (!cfg.ativa) return json({ erro: 'A leitura por IA está desligada.', codigo: 'desligada' }, 503);
    const estimativa = Number(body.estimativa || 0.08);
    if (gastoMes + estimativa > Number(cfg.limite_mensal_usd)) return json({ erro: `Limite mensal da leitura por IA atingido (US$ ${gastoMes.toFixed(2)} de US$ ${Number(cfg.limite_mensal_usd).toFixed(2)}).`, codigo: 'limite', gasto: gastoMes }, 402);

    const imagem = String(body.imagem || '');
    const tipoImg = /^image\/(jpeg|png|webp)$/.test(body.tipo) ? body.tipo : 'image/jpeg';
    if (!imagem || imagem.length > 9_500_000) return json({ erro: 'Imagem da página ausente ou grande demais.' }, 400);
    const modelo = PRECOS[body.modelo] ? body.modelo : cfg.modelo;
    const dica = String(body.dica || '').slice(0, 2000);
    const etapa = body.etapa === 'releitura' ? 'releitura' : 'leitura';

    // mantém a conexão viva enquanto a IA trabalha (espaços antes do JSON final não atrapalham o JSON.parse)
    const enc = new TextEncoder();
    const corpo = new ReadableStream({
      async start(ctrl) {
        const pulso = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch (_) { /* fechado */ } }, 8000);
        let resp: any = null, erro: string | null = null, tIn = 0, tOut = 0;
        try {
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: modelo,
              max_tokens: 16000,
              system: INSTRUCOES,
              tools: [FERRAMENTA],
              tool_choice: { type: 'tool', name: 'registrar_pagina' },
              messages: [{
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: tipoImg, data: imagem } },
                  { type: 'text', text: `Arquivo: ${String(body.arquivo || '').slice(0, 200)} · página ${Number(body.pagina) || 1}.${dica ? '\n' + dica : ''}\nTranscreva esta página.` }
                ]
              }]
            })
          });
          const j = await r.json();
          if (!r.ok) erro = (j && j.error && j.error.message) || `Erro ${r.status} da API`;
          else {
            tIn = (j.usage && (j.usage.input_tokens + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0))) || 0;
            tOut = (j.usage && j.usage.output_tokens) || 0;
            const uso = (j.content || []).find((c: any) => c.type === 'tool_use');
            if (!uso) erro = 'A IA não devolveu a transcrição.';
            else resp = { ok: true, pagina: uso.input, parou: j.stop_reason };
            if (j.stop_reason === 'max_tokens') erro = 'Página longa demais para uma leitura (resposta cortada).';
          }
        } catch (e) { erro = String((e && (e as Error).message) || e); }
        const c = custo(modelo, tIn, tOut);
        await admin.from('confere_ia_uso').insert({ usuario: email, arquivo: String(body.arquivo || '').slice(0, 300), pagina: Number(body.pagina) || null, etapa, modelo, tokens_entrada: tIn, tokens_saida: tOut, custo_usd: c, ok: !erro, erro });
        clearInterval(pulso);
        ctrl.enqueue(enc.encode(JSON.stringify(erro ? { erro, custo: c } : Object.assign(resp, { custo: c, tokens: { entrada: tIn, saida: tOut }, modelo }))));
        ctrl.close();
      }
    });
    return new Response(corpo, { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return json({ erro: String((e && (e as Error).message) || e) }, 500);
  }
});
