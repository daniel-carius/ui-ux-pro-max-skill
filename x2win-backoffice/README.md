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
cp .env.example .env          # preencha APP_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL e ADMIN_PASSWORD
npm run seed                  # opcional: com DEMO_DATA=true grava dados de demonstração (fictícios)
npm run dev                   # http://localhost:3333

# 2. painel (outro terminal)
cd x2win-backoffice
cp .env.api.example .env.local
npm run dev                   # http://localhost:5173 (encaminha /api para o servidor)
```

- `npm run dev`, `seed` e `migrate` leem o `server/.env` quando ele existe (o que já estiver definido no terminal
  vale mais). Sem o arquivo, o Node avisa `.env not found. Continuing without it.` e valem só as variáveis do
  terminal. `npm start` (build) não lê o arquivo.
- `npm run dev` roda com `NODE_ENV=development`; `seed` e `migrate` usam o `NODE_ENV` do terminal ou
  `development` (o `NODE_ENV` do `.env` não vale para eles). Sem `NODE_ENV`, a API assume produção (cookie só por
  HTTPS).
- Em desenvolvimento o banco é um PostgreSQL embutido (PGlite) gravado em `server/data/` e a API aplica as
  migrações ao subir; não precisa instalar o Postgres. Em produção use `DATABASE_URL=postgres://...` com o usuário
  `x2win_app` e rode `npm run migrate` antes, com o dono das tabelas (veja Docker).
- A API cria os cargos e o Superadmin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) ao subir. Instalação nova exige 2FA do
  Superadmin: o primeiro login pede o cadastro do aplicativo autenticador.
- Com `DEMO_DATA=true`, o `seed` mostra as senhas temporárias da equipe de demonstração (troca no 1º acesso).
- Webhook para um receptor local (`http://localhost`): `WEBHOOK_ALLOW_LOCAL_TARGETS=true`, só em
  desenvolvimento. Sem isso, destino só `https://` público.

### Com Docker (Postgres + API + painel atrás do nginx com HTTPS)

```bash
cd x2win-backoffice
cp deploy/.env.example deploy/.env    # preencha as senhas do banco, APP_SECRET, ENCRYPTION_KEY, ADMIN_EMAIL e ADMIN_PASSWORD
# certificado do domínio do painel: deploy/certs/fullchain.pem e deploy/certs/privkey.pem
docker compose --env-file deploy/.env up -d --build
# painel em https://<seu-domínio> (a porta 80 só redireciona para a 443)
# opcional, dados de demonstração: docker compose --env-file deploy/.env exec -e DEMO_DATA=true api node dist/seed.js
```

- `POSTGRES_PASSWORD` (dono das tabelas) e `APP_DB_PASSWORD` em hexadecimal: `openssl rand -hex 32`.
- Na primeira subida do volume, `deploy/db-init` cria o usuário `x2win_app`, com que a API conecta: sem DDL e,
  na auditoria, só leitura e inclusão. O serviço `migrate` aplica as migrações com o dono das tabelas e a API só
  sobe depois que ele termina bem.
- Volume `pgdata` de uma versão anterior: dê login ao papel uma vez e suba de novo:
  `docker compose --env-file deploy/.env exec db psql -U x2win -d x2win -c "alter role x2win_app login password '<APP_DB_PASSWORD>'"`.
- Postgres gerenciado (dono das tabelas sem `CREATEROLE`): um administrador do banco cria `x2win_app` com o
  comando de `deploy/db-init/10-x2win-app-role.sh` e depois `npm run migrate` concede os privilégios (ele sai com
  erro enquanto o papel não existir, e concede de novo a cada execução).
- `db`, `api` e `web` têm `restart: unless-stopped` (deixe o Docker ligado no boot: `systemctl enable docker`).
  O Compose não reinicia contêiner `unhealthy`: monitore de fora `https://<painel>/api/health`, que responde 503
  quando a API não alcança o banco.
- Atrás de um balanceador ou terminador TLS: descomente o bloco `real_ip` de `deploy/nginx.conf`.
- Lista de IPs que deixou todo mundo de fora: descomente `PANEL_ALLOWLIST_RESET` em `deploy/.env` com um valor
  novo e recrie a API (`docker compose --env-file deploy/.env up -d api`). A lista é esvaziada uma vez por valor,
  com registro na auditoria; o login continua pedindo senha e 2FA. Depois comente a variável e refaça a lista
  pelo painel.

Requisitos: Node 22.9+ (ou Docker).

## Segurança

O que o servidor garante (o painel só exibe):

- **Login**: senha com scrypt; 5 senhas erradas para o mesmo e-mail a partir da mesma rede bloqueiam só aquela
  origem por 15 min (a resposta é igual exista ou não a pessoa); erros depois da senha (código do 2FA, senha
  atual) bloqueiam a conta por 15 min. 2FA por aplicativo (TOTP) com 8 códigos de recuperação de uso único,
  guardados só como HMAC. Troca obrigatória da senha temporária, sessão com expiração absoluta (12 h) e por
  inatividade (configurável).
- **2FA**: sempre exigido do Superadmin, sem como desligar. Instalação nova já exige de Superadmin, Administrador e
  Financeiro. Quando uma exigência passa a valer (troca de cargo, "Exigir 2FA", "2FA para todos"), a sessão aberta
  sem 2FA cai na hora. Cadastrar o 2FA com a sessão aberta pede a senha atual.
- **Permissões e governança**: cada rota confere o cargo no banco. Dar ou tirar permissões sensíveis
  (administrativas, aprovar saques de jogadores e de afiliados, jogo responsável, países bloqueados), mudar o teto
  de aprovação, pôr alguém num cargo com elas e mexer na lista de IPs: só quem pode conceder cargos (por padrão,
  o Superadmin).
  Ninguém desativa a si mesmo nem o último Superadmin; nomes da equipe não se repetem nem se confundem.
- **Saques**: teto de aprovação por cargo. Na aprovação, o servidor segura o pagamento de jogador banido pelo
  anti-fraude e confere as regras em vigor (máximo por saque e limite diário). Segregação de funções: quem lançou
  crédito manual ou estorno para o jogador nos últimos 30 dias não aprova o saque dele. Aprovação automática não
  passa do teto de quem configura.
- **Saldo e jogo responsável**: o saldo só muda por lançamento no extrato, com teto de R$ 5.000 por lançamento
  manual e de R$ 5.000 em créditos manuais por jogador em 24 h. Autoexclusão não muda pelo painel, pausa pedida
  pelo jogador só termina no prazo e autoexcluído não recebe crédito.
- **Dados sensíveis**: CPF, celular, e-mail, IP e PIX saem mascarados pelo servidor para quem não tem a permissão
  de ver; leitura em claro fica na auditoria. Telas de campanha leem só o público e contagens, sem dado pessoal.
  Dados de pagamento de afiliados saem mascarados para todos e são revelados um por vez, com auditoria.
- **Segredos**: gateways, agregadores, integrações, webhooks e 2FA cifrados com AES-256-GCM no banco; a tela vê só
  pontos (e os 4 últimos caracteres em segredos longos) e só substitui. Trocar o destino de uma credencial pede o
  segredo de novo. Endereços de webhook ficam cifrados.
- **Auditoria**: somente inclusão (o banco recusa alterar, apagar e TRUNCATE, e a API conecta com um usuário sem
  DDL). Quem, quando e de que IP vêm do servidor. O que o servidor executa ele mesmo registra; o painel só relata
  eventos de uma lista fechada, marcados como "relatado pelo painel (não verificado)". Quem não vê a Auditoria
  recebe só a fatia da própria tela (Modo de ataque, Segurança do painel, Equipe, Manutenção, Empresa). O CSV
  traz id e e-mail de quem fez.
- **Rede**: HTTPS no nginx (a API recusa o que não chegou por HTTPS), cookie `HttpOnly` + `SameSite=Strict` +
  `Secure`, cabeçalho obrigatório contra CSRF, CSP e cabeçalhos de segurança, limites de taxa e de tamanho,
  respostas sem cache, lista de IPs permitidos com trava para você não se bloquear.
- **Webhooks**: assinados com HMAC; só `https://` para host público, com o DNS conferido na própria conexão;
  envio de teste com evento próprio (`webhook.teste`); trocar ou remover um destino cancela as entregas pendentes.

Detalhes de cada rota e regra: [`docs/API.md`](docs/API.md).

## Achados da auditoria já tratados na recriação

| # | Achado | Como ficou |
| --- | --- | --- |
| 1 | 2FA opcional em cargos com acesso amplo | O servidor exige 2FA dos cargos marcados (e de todos, se ligado em Segurança do painel). Superadmin sempre exige; instalação nova exige também de Administrador e Financeiro. Alerta em Cargos e Equipe com "Exigir 2FA" em um clique |
| 2 | Conta administrativa ativa sem 2FA | Aviso no sino do topo e em Equipe. Quando o cargo passa a exigir 2FA, a sessão aberta sem 2FA cai na hora e o próximo login leva ao cadastro |
| 3 | Painel aceita login de qualquer IP | Lista de IPs aplicada pelo servidor em toda a API, inclusive no login (só a saída e `/api/health` ficam de fora), com "Adicionar meu IP", trava contra se bloquear e recuperação por `PANEL_ALLOWLIST_RESET`. Só quem concede cargos muda a lista |
| 4 | Chave MCP herda a fragilidade de quem criou | Na tela, criar chave exige 2FA e chaves de criador sem 2FA ficam marcadas, com revogação em lote (o servidor MCP em si ainda não faz parte desta versão) |
| 5 | CPF e PIX expostos em listas (LGPD) | Mascarados pelo servidor em listas e CSV. "Revelar" exige permissão, busca um registro por vez e fica na auditoria |
| 6 | Segredos com os últimos 4 caracteres | Cifrados no banco; a tela vê só pontos (os 4 últimos só em segredos de 16+ caracteres) e só pode substituir |
| 7 | Token no caminho da URL de webhook | Endereço cifrado no banco, token mascarado para quem não edita webhooks e no histórico de envios. Quem edita vê o endereço completo (para poder editá-lo); "Revelar" e "Copiar" na ficha do destino ficam na auditoria. Assinatura HMAC em todo webhook |
| 8 | Idade mínima não verificada no cadastro | Data de nascimento obrigatória por padrão; desligar exige confirmação e deixa alerta vermelho |
| 9 | Cargos com nomes parecidos | Alerta com sugestão de renomear; o seletor de cargo mostra a descrição |
| 10 | Modo de ataque sem confirmação clara | Ligar exige digitar ATAQUE; desligar por botão ou sozinho após o tempo escolhido (o servidor desliga no prazo, em nome de "Sistema", mesmo sem ninguém com o painel aberto). Quem ligou e quando vêm do servidor e ficam na auditoria |

## Revisão de segurança

A API e o painel passaram por uma revisão adversarial em 3 rodadas: 82 achados levantados, 79 confirmados e
corrigidos com testes de regressão (1 crítico, 16 altos, 44 médios e 18 baixos) e 3 refutados. Principais classes
corrigidas:

1. Lista de IPs e CSRF contornados com caminho codificado (`/%61pi/...`): as checagens usam a rota escolhida.
2. Login e 2FA: bloqueio por e-mail + origem, erros depois da senha contados, códigos de recuperação de 100 bits
   com HMAC, exigência de 2FA aplicada às sessões abertas.
3. Governança: concessões sensíveis, teto de aprovação e lista de IPs só com "Conceder cargos"; Superadmin com
   2FA travado.
4. Dinheiro: saldo só pelo extrato, teto de crédito manual por jogador, aprovação de saque com anti-fraude, regras
   em vigor e segregação de funções.
5. Jogo responsável: autoexclusão e pausa pedida pelo jogador fora do alcance do painel.
6. Dados pessoais: máscaras no servidor (IPv6, e-mails com prefixo, dados bancários), base de jogadores só para as
   telas que precisam, revelar por registro com auditoria.
7. Segredos: só a máscara exata mantém o segredo, destino trocado pede o segredo de novo, URLs de webhook cifradas.
8. Webhooks: SSRF fechado (DNS fixado na conexão, sem redirecionamento), evento de teste separado, entregas
   pendentes canceladas na troca de destino, destinos e segredos de demonstração recusados.
9. Auditoria: eventos do painel limitados e marcados, fatias por tela, CSV com identidade, imutável no banco e API
   sem privilégio de apagar.
10. Recursos e implantação: limites de corpo antes de ler, fila de senhas (503), leituras consistentes e impasses
    viram 409, queda do Postgres não derruba a API, conteúdo do site público validado, HTTPS e CSP no nginx.

Decisões ainda em aberto:

- **Aprovação × PIX real**: aprovar um saque registra a decisão e põe na fila o webhook `saque.pago`, que é só um
  aviso aos sistemas da operação; não há integração com gateway de pagamento. Sem destino `saque.pago` ativo, o
  financeiro paga no gateway (a mensagem da aprovação avisa). Pagar um saque de afiliado também só registra a
  decisão (sem webhook): o financeiro faz o PIX ou a TED.
- **Estorno de moedas na loja**: devolver moedas ao estornar uma compra precisa de um extrato de moedas.
- **Créditos manuais**: teto diário por pessoa que lança e segunda aprovação ainda não definidos (hoje o teto é
  por jogador).
- **Auditoria fora do banco**: cadeia de hash ou cópia em armazenamento WORM não implementadas.
- **Chaves**: trocar o `APP_SECRET` invalida os códigos de recuperação do 2FA; a rotação da `ENCRYPTION_KEY` não é
  automática.

## O que ainda é simulado

- **Dados das telas sem integração**: jogadores, transações, depósitos, jogos, apostas esportivas e afiliados vêm
  da plataforma de jogo, que ainda não está ligada. No modo API o painel não mostra mais os próprios dados de
  demonstração: as telas mostram o que está no servidor, com permissão por cargo e mascaramento. Servidor sem
  `DEMO_DATA` começa com essas listas vazias (bases entram pela importação do Superadmin com 2FA); com
  `DEMO_DATA=true`, o `seed` grava bases fictícias. As telas de campanha começam vazias no modo API.
- **Integrações externas**: gateways PIX, agregadores, Betby, SendWork/Mailgun e pixels só simulam a resposta.
  Os webhooks de saque são enviados de verdade, assinados; o pagamento do saque depende de quem recebe
  `saque.pago`.
- **E-mails**: convite e senha temporária aparecem na tela para quem criou o acesso (não há envio de e-mail).

## Estrutura

```
x2win-backoffice/
├── shared/             # regras do painel e do servidor (telas, permissões, auditoria, saques, jogadores, chaves de dados)
├── src/                # painel (React)
│   ├── nav.ts          # mapa das 73 telas com ícones
│   ├── pages/          # uma tela por arquivo; pages/auth = login, 2FA, convite
│   ├── components/     # biblioteca visual, gráficos e layout
│   ├── domain/         # regras do lado do painel (sessão, saques, estado do site)
│   ├── data/           # dados de demonstração (também usados pelo seed do servidor)
│   └── lib/            # store (demonstração ou API), cliente da API, formatação pt-BR
├── server/             # API (Fastify + PostgreSQL)
│   ├── src/modules/    # auth, team, roles, panel-security, withdrawals, audit, webhooks, kv
│   ├── src/db/         # conexão e migrações
│   └── test/           # testes (vitest, banco em memória)
├── docs/               # especificação, contrato da API e guia de telas
├── deploy/             # nginx (HTTPS), cabeçalhos de segurança, criação do usuário do banco, certificados e .env de produção
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
3. **Infraestrutura**: backups do Postgres, monitoramento de `/api/health` com alertas, rotação da
   `ENCRYPTION_KEY` e cópia da auditoria fora do banco.
4. **Decisões em aberto** da revisão de segurança (acima).
