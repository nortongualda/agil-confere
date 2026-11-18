// Ágil Confere · gestão de acessos (apenas usuários master).
// Cria o login do analista com senha provisória (trocada no primeiro acesso)
// e libera o acesso ao Ágil Confere. Só aceita e-mails @agiladuaneira.com.br.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: u } = await comoUsuario.auth.getUser();
    if (!u || !u.user) return json({ erro: 'Sessão inválida. Entre novamente.' }, 401);
    const { data: ehMaster, error: eM } = await comoUsuario.rpc('confere_master');
    if (eM || !ehMaster) return json({ erro: 'Apenas usuários master podem gerenciar acessos.' }, 403);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@agiladuaneira\.com\.br$/.test(email)) return json({ erro: 'Use um e-mail @agiladuaneira.com.br.' }, 400);
    const admin = createClient(url, service, { auth: { persistSession: false } });

    let existente: any = null;
    for (let page = 1; page <= 10 && !existente; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ erro: error.message }, 500);
      existente = data.users.find((x: any) => String(x.email || '').toLowerCase() === email) || null;
      if (data.users.length < 200) break;
    }

    if (body.acao === 'criar') {
      const papel = body.papel === 'master' ? 'master' : 'analista';
      const nome = String(body.nome || '').trim() || null;
      if (!existente) {
        const senha = String(body.senha || '');
        if (senha.length < 8) return json({ erro: 'Informe uma senha provisória com pelo menos 8 caracteres.' }, 400);
        const { error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, trocar_senha: true } });
        if (error) return json({ erro: error.message }, 400);
      }
      const { error: e2 } = await admin.from('confere_acesso').upsert({ email, nome, papel, ativo: true });
      if (e2) return json({ erro: e2.message }, 400);
      return json({ ok: true, contaExistente: !!existente });
    }

    if (body.acao === 'redefinir') {
      if (!existente) return json({ erro: 'Este e-mail ainda não tem login.' }, 404);
      const senha = String(body.senha || '');
      if (senha.length < 8) return json({ erro: 'Informe uma senha provisória com pelo menos 8 caracteres.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(existente.id, { password: senha, user_metadata: { ...(existente.user_metadata || {}), trocar_senha: true } });
      if (error) return json({ erro: error.message }, 400);
      return json({ ok: true });
    }

    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
