# X2Win Backoffice

Recriação do backoffice da operação X2Win (cassino + apostas esportivas): 73 telas em 10 módulos,
tema claro e escuro, ícones Lucide, interface em pt-BR. Baseado na especificação em
[`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md).

O painel roda de dois jeitos:

| Modo | Para quê | Login | Onde ficam os dados |
| --- | --- | --- | --- |
| **Demonstração** (padrão) | ver e testar as telas sem instalar nada | não tem | no navegador |
| **API** (`VITE_API_MODE=1`) | uso real | e-mail, senha e 2FA | no servidor (PostgreSQL) |

## Como rodar

### Só o painel (modo demonstração)

```bash
cd x2win-backoffice
npm install
npm run dev        # http://localhost:5173
```

### Painel + servidor (modo API)

```bash
# 1. servidor
cd x2win-backoffice/server
npm install
cp .env.example .env          # preencha APP_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed                  # opcional: dados de demonstração (a API já cria cargos e Superadmin ao subir)
npm run dev                   # http://localhost:3333

# 2. painel (outro terminal)
cd x2win-backoffice
cp .env.api.example .env.local
npm run dev                   # http://localhost:5173 (encaminha /api para o servidor)
```

Em desenvolvimento o banco é um PostgreSQL embutido (PGlite) gravado em `server/data/`; não precisa
instalar o Postgres. Em produção use `DATABASE_URL=postgres://...`.

### Com Docker (Postgres + API + painel atrás do nginx)

```bash
cd x2win-backoffice
cp deploy/.env.example deploy/.env    # preencha os segredos
docker compose --env-file deploy/.env up -d --build
# a API cria os cargos e o Superadmin (ADMIN_EMAIL/ADMIN_PASSWORD) ao subir pela primeira vez
# opcional, dados de demonstração: docker compose exec -e DEMO_DATA=true api node dist/seed.js
# painel em http://localhost:8080
```

Requisitos: Node 20+ (ou Docker).

## Segurança

O que o servidor garante (o painel só exibe):

- **Login**: senha com scrypt, bloqueio de 15 min após 5 erros, 2FA por aplicativo (TOTP) com códigos de
  recuperação de uso único, troca obrigatória da senha temporária, sessão com expiração absoluta (12 h) e por
  inatividade (configurável).
- **Permissões**: cada rota confere o cargo no banco. Teto de aprovação de saque por cargo; só o Superadmin
  concede ou retira cargos administrativos; ninguém desativa a si mesmo nem o último Superadmin.
- **Dados sensíveis**: CPF, celular, e-mail e chaves PIX saem mascarados para quem não tem a permissão de ver;
  revelar fica na auditoria. Segredos (gateways, agregadores, webhooks, integrações, 2FA) são cifrados com
  AES-256-GCM no banco e nunca voltam para a tela.
- **Auditoria**: somente inclusão (o banco recusa alterar ou apagar). Quem, quando e de que IP vêm sempre do
  servidor.
- **Rede**: cookie `HttpOnly` + `SameSite=Strict`, cabeçalho obrigatório contra CSRF, limite de taxa, lista de
  IPs permitidos do painel com trava para você não se bloquear, webhooks assinados com HMAC.

Detalhes de cada rota e regra: [`docs/API.md`](docs/API.md).

## Achados da auditoria já tratados na recriação

| # | Achado | Como ficou |
| --- | --- | --- |
| 1 | 2FA opcional em cargos com acesso amplo | O servidor exige 2FA dos cargos marcados (e de todos, se ligado em Segurança do painel); alerta em Cargos e Equipe com "Exigir 2FA" em um clique |
| 2 | Conta administrativa ativa sem 2FA | Aviso no sino do topo e em Equipe; no próximo login a pessoa é levada a cadastrar o 2FA quando o cargo exige |
| 3 | Painel aceita login de qualquer IP | Lista de IPs aplicada pelo servidor em toda a API (inclusive no login), com "Adicionar meu IP" e trava contra se bloquear |
| 4 | Chave MCP herda a fragilidade de quem criou | Na tela, criar chave exige 2FA e chaves de criador sem 2FA ficam marcadas, com revogação em lote (o servidor MCP em si ainda não faz parte desta versão) |
| 5 | CPF e PIX expostos em listas (LGPD) | Mascarados pelo servidor em listas e CSV; "Revelar" exige permissão e fica na auditoria |
| 6 | Segredos com os últimos 4 caracteres | Cifrados no banco; a tela só vê os 4 últimos e só pode substituir |
| 7 | Token no caminho da URL de webhook | Token mascarado e alerta recomendando a assinatura HMAC (que o servidor envia em todo webhook) |
| 8 | Idade mínima não verificada no cadastro | Data de nascimento obrigatória por padrão; desligar exige confirmação e deixa alerta vermelho |
| 9 | Cargos com nomes parecidos | Alerta com sugestão de renomear; o seletor de cargo mostra a descrição |
| 10 | Modo de ataque sem confirmação clara | Ligar exige digitar ATAQUE; desligar por botão ou sozinho após o tempo escolhido |

## O que ainda é simulado

- **Dados das telas sem integração**: jogadores, transações, jogos, apostas esportivas e campanhas usam dados de
  demonstração até serem ligados à plataforma de jogo. No modo API eles já são guardados no servidor, com
  permissão por cargo e mascaramento.
- **Integrações externas**: gateways PIX, agregadores, Betby, SendWork/Mailgun e pixels só simulam a resposta.
  Os webhooks de saque são enviados de verdade, assinados.
- **E-mails**: convite e senha temporária aparecem na tela para quem criou o acesso (não há envio de e-mail).

## Estrutura

```
x2win-backoffice/
├── shared/             # regras usadas pelo painel e pelo servidor (telas, permissões, saques, chaves de dados)
├── src/                # painel (React)
│   ├── nav.ts          # mapa das 73 telas com ícones
│   ├── pages/          # uma tela por arquivo; pages/auth = login, 2FA, convite
│   ├── components/     # biblioteca visual, gráficos e layout
│   ├── domain/         # regras do lado do painel (sessão, saques, estado do site)
│   ├── data/           # dados de demonstração
│   └── lib/            # store (demonstração ou API), cliente da API, formatação pt-BR
├── server/             # API (Fastify + PostgreSQL)
│   ├── src/modules/    # auth, team, roles, panel-security, withdrawals, audit, webhooks, kv
│   ├── src/db/         # conexão e migrações
│   └── test/           # testes (vitest, banco em memória)
├── docs/               # especificação, contrato da API e guia de telas
├── deploy/             # nginx e exemplo de .env de produção
└── docker-compose.yml
```

Para criar ou alterar uma tela, siga o [`docs/GUIA-TELAS.md`](docs/GUIA-TELAS.md).

## Verificações

```bash
npm run typecheck                 # painel
cd server && npm run typecheck && npm test && npm run build
```

O CI do GitHub (`.github/workflows/x2win-backoffice.yml`) roda tudo isso a cada push nesta pasta.

## Próximos passos para produção

1. **Integrações reais**: gateway PIX (depósitos e pagamento dos saques), agregadores de jogos e Betby. Os dados
   de jogadores e transações passam a vir da plataforma, com paginação no servidor.
2. **E-mail transacional** (SendWork ou Mailgun) para convites, senha e avisos.
3. **Infraestrutura**: HTTPS, backups do Postgres, monitoramento e alertas, rotação de `ENCRYPTION_KEY`.
