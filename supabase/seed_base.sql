insert into public.confere_importadores (nome, cnpj) values ('ELETRA INDUSTRIA E COMERCIO DE MEDIDORES ELETRICOS LTDA', '12115480000115') on conflict (cnpj) do nothing;
-- primeiro acesso master; os demais usuários são liberados pela tela Usuários
insert into public.confere_acesso (email, nome, papel) values ('nortongualda@agiladuaneira.com.br', 'Norton Gualda', 'master') on conflict (email) do nothing;
