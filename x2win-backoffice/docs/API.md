# API do backoffice X2Win — contrato

Fonte de verdade para o servidor (`server/`) e para o painel em modo API. Os tipos
TypeScript estão em `shared/api.ts`. Tudo em pt-BR, valores em reais (number), datas ISO.

## Regras gerais

- **Base**: `/api`. JSON em UTF-8.
- **Sessão**: cookie `x2w_sid` (httpOnly, SameSite=Strict, Secure em produção). O token vai só no cookie;
  o banco guarda o hash SHA-256 dele.
- **CSRF**: todo método que não seja GET/HEAD/OPTIONS exige o cabeçalho `X-Requested-With: x2w`. Sem ele: 403
  `requisicao_invalida`.
- **Lista de IPs**: se a lista do painel não estiver vazia, qualquer rota `/api/*` (exceto `/api/health`) de um IP
  fora dela responde 403 `ip_nao_autorizado`, inclusive o login.
- **Erros**: corpo `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. `message` é para a pessoa;
  `code` é estável para o painel.

| HTTP | code | Quando |
| --- | --- | --- |
| 400 | `dados_invalidos` | corpo inválido (zod) ou regra de negócio violada |
| 401 | `nao_autenticado` | sem sessão válida |
| 401 | `credenciais_invalidas` | e-mail/senha/código errado (mensagem igual exista ou não a pessoa) |
| 403 | `etapa_pendente` | sessão existe mas o login não terminou (`details.stage`) |
| 403 | `sem_permissao` | cargo não tem a permissão |
| 403 | `teto_excedido` | valor acima do teto de aprovação do cargo |
| 403 | `campo_nao_permitido` | tentou alterar campo que o cargo não pode (`details.fields`) |
| 404 | `nao_encontrado` | registro ou chave sem valor gravado |
| 409 | `ja_decidido` | saque já aprovado/recusado |
| 409 | `versao_desatualizada` | outra pessoa gravou a chave antes (`details.version` = atual) |
| 409 | `email_em_uso` | e-mail já cadastrado na equipe |
| 409 | `bloquearia_voce` | a lista de IPs deixaria o seu IP de fora |
| 423 | `conta_bloqueada` | muitas tentativas erradas (`details.until`) |
| 429 | `muitas_tentativas` | limite de taxa |

- **Auditoria**: toda escrita bem-sucedida grava em `audit_log` (quem, quando, IP, ação, entidade, resumo).
  Quem/quando/IP vêm sempre do servidor.
- **Guardas** (`server/src/http.ts`): `requireActive(req)` exige login completo; `requirePerm(req, ...perms)` exige
  uma das permissões. Permissões vêm do cargo no banco (`roles.permissions`), nunca do painel.

## Autenticação — `/api/auth`

Etapas (`stage`) de uma sessão: `password` → `enroll` | `2fa` → `active`. Só `active` acessa o resto da API.
Etapas pendentes valem 10 minutos; sessão ativa vale 12 h no máximo e cai após o tempo de inatividade configurado
em Segurança do painel (padrão 240 min).

### `POST /api/auth/login` — `{ email, password }` → `{ stage }`
- Limite: 10 por minuto por IP.
- E-mail comparado em minúsculas. Pessoa `desligado`/`convidado` ou senha errada → 401 `credenciais_invalidas`
  (mesma mensagem e tempo de resposta parecido; usar `verifyPassword` mesmo sem usuário).
- 5 erros seguidos bloqueiam por 15 min (`users.failed_logins`, `locked_until`) → 423 `conta_bloqueada`.
- Sucesso zera os erros e decide a etapa: `must_change_password` → `password`; senão `totp_enabled` → `2fa`;
  senão (cargo `require_2fa` ou `panel_security.enforce_2fa_all`) → `enroll`; senão `active`.
- Revoga a sessão anterior do mesmo navegador (cookie presente), cria a nova e define o cookie.
- Ao chegar em `active`: grava `last_access_at`, `last_ip` e auditoria `login` ("Login com senha" ou "Login com 2FA").

### `POST /api/auth/2fa/verify` — `{ code }` → `{ stage: 'active' }` (sessão em `2fa`)
- Aceita 6 dígitos do TOTP (janela ±1 passo) ou um código de recuperação `XXXXX-XXXXX` (uso único; remove o hash).
- Recusa reutilizar o mesmo passo de tempo (`totp_last_counter`).
- Erro conta como tentativa errada (mesmo bloqueio do login). Limite: 10/min por IP.

### `POST /api/auth/2fa/setup` → `{ secret, otpauthUrl }` (sessão em `enroll` ou `active`)
- Gera segredo novo, guarda cifrado em `totp_pending_enc`. Se o 2FA já está ligado → 409 `ja_configurado`.

### `POST /api/auth/2fa/enable` — `{ code }` → `{ stage, recoveryCodes }` (sessão em `enroll` ou `active`)
- Confere com o segredo pendente; liga o 2FA; gera 8 códigos de recuperação (guarda só o hash); promove a
  sessão `enroll` → `active`. Auditoria `ligar` / entidade `2FA`.

### `POST /api/auth/password` — `{ currentPassword?, newPassword }` → `{ stage }`
- Na etapa `password` a senha atual é dispensada; com sessão `active` é obrigatória.
- Regra: `passwordProblem` (≥ 10 caracteres, letras e números) e diferente da atual.
- Zera `must_change_password`, revoga as outras sessões da pessoa e calcula a próxima etapa.
  Auditoria `editar` / `Senha`.

### `POST /api/auth/logout` → 204
Revoga a sessão e apaga o cookie.

### `GET /api/auth/me` → `MeResponse`
Qualquer etapa. Sem sessão → 401. `role`, `permissions` e `sessionTimeoutMinutes` só com `stage: 'active'`.

## Dados por chave — `/api/kv/:key`

Cada tela guarda seus dados por chave (ex.: `campanhas.cupons`). As regras de cada chave estão em
`shared/kv-registry.ts` (`findKvRule`, `canReadKey`, `canWriteKey`).

- Chave sem regra → 404 `chave_desconhecida`. Chave local (`isLocalOnlyKey`) → 400 `chave_local`.
- **GET** → `{ key, value, version, updatedAt, stored }`. Sem permissão de leitura → 403. Nunca gravada → 200 com
  `stored: false`, `value: null` e `version: 0` (o painel usa o valor padrão dele).
- **PUT** `{ value, version? }` → mesmo formato da leitura, já mascarado.
  - Sem permissão de escrita (`writePermissions`) → 403. `write: 'servidor'` → 403 sempre.
  - Já existe valor e `version` diferente da atual (ou ausente) → 409 `versao_desatualizada` com `details.version`.
  - Grava com `version + 1`, `updated_by` = id da pessoa; auditoria `editar` com entidade "Dados · <título da tela>"
    e resumo do que mudou (campos de 1º nível alterados, ou itens incluídos/alterados/removidos em listas).
- **Chaves de domínio** (`rule.domain`) são delegadas ao manipulador do módulo (`server/src/kv/types.ts`).

### Segredos (`rule.secrets`)
- Em repouso: o JSON inteiro é cifrado (AES-256-GCM, `kv_store.value_enc`).
- Na leitura: todo campo string cujo nome casa com `SECRET_FIELD` sai como `"••••••••••" + últimos 4`.
- Na gravação: valor que contém `•` (máscara) num campo de segredo é trocado pelo valor gravado no mesmo caminho
  (objetos em listas casam por `id`; sem `id`, pela posição). Assim o painel nunca recebe nem apaga o segredo.

### Dados pessoais (`rule.pii`)
- Cifrados em repouso. Na leitura, quem não tem `rule.pii.revealPermission` recebe os campos que casam com
  `PII_FIELD` mascarados: e-mail `ab***@dominio`, CPF `123.***.***-09`, telefone `(11) 9****-1234`,
  outros `•••` + últimos 4. Na gravação, valores mascarados são restaurados do gravado (mesma regra dos segredos).

### Domínio `players` (`geral.jogadores`)
Lista de jogadores. Leitura com mascaramento de dados pessoais. Gravação compara com o gravado, por `id`:
- incluir ou remover jogador → 403 `campo_nao_permitido` (jogadores vêm da plataforma);
- `usuarios.editar` pode mudar: `tags`, `status`, `balanceReal`, `balanceBonus`, `coins`;
- `antifraude.banir` pode mudar: `status`;
- qualquer outro campo alterado → 403 `campo_nao_permitido` com `details.fields`;
- primeira gravação (nada gravado ainda) aceita a lista inteira como base.

### Domínio `transactions` (`geral.transacoes`)
Extrato só de inclusão: todo item gravado precisa voltar igual (por `id`); itens novos só dos tipos
`credito_manual`/`debito_manual` (`usuarios.editar`) e `estorno` (`transacoes.editar`). Fora disso → 403.

## Domínios com regra própria

### Saques — `operacao.saques` (leitura) e `/api/withdrawals`
Leitura via `GET /api/kv/operacao.saques` (perm. `saques.ver`): lista no formato do painel
(`src/data/finance.ts` › `Withdrawal`), mais recentes primeiro, `pixKey` **mascarada** conforme `pixKeyType`.
Gravação pela chave: 403 (só ações abaixo).

- `POST /api/withdrawals/:id/approve` → `{ ok, message, withdrawal }`
  - Exige `saques.aprovar` e cargo que aprova (`approvalCeiling !== 0`); valor acima do teto → 403 `teto_excedido`.
  - Transição atômica: `update ... where id = $1 and status in ('criado','pendente','em_analise') returning *`;
    nenhuma linha → 409 `ja_decidido`.
  - Na mesma transação: auditoria `aprovar` e enfileira o webhook `saque.pago`.
- `POST /api/withdrawals/:id/reject` — `{ reason }` (3–300 caracteres) → idem, status `recusado`, auditoria
  `recusar`, webhook `saque.rejeitado`.
- `POST /api/withdrawals/:id/reveal-pix` → `{ pixKey }`. Exige `saques.ver` e `usuarios.ver-dados`.
  Auditoria `revelar`.
- Regras: `operacao.saques.regras` (GET com `saques.ver`; PUT com `saques.editar`) guardadas na tabela `settings`,
  validadas por `validateWithdrawalRules` (shared). Padrão `DEFAULT_WITHDRAWAL_RULES` quando nunca gravadas
  (GET devolve o padrão com `version: 0`).

### Auditoria — `auditoria.registros` e `/api/audit`
- `GET /api/kv/auditoria.registros` → os 1000 registros mais recentes no formato `AuditEntry` (perm. de leitura da regra).
- `POST /api/audit/events` — `{ action, entity, summary }` → 201 `{ id }`. Sessão ativa. Ação precisa existir em
  `AUDIT_ACTIONS` e não pode ser `login`. Entidade ≤ 200, resumo ≤ 1000 caracteres. `source = 'painel'`.
  Limite 120/min por sessão.
- `GET /api/audit?from&to&actorId&action&page&pageSize` → `AuditListResponse` (perm. `auditoria.ver`;
  `pageSize` ≤ 200, padrão 50).
- `GET /api/audit/export.csv?...mesmos filtros` → CSV (`;`, BOM UTF-8). Perm. `auditoria.exportar`. Gera
  auditoria `exportar`.

### Webhooks — `campanhas.webhooks.*` e `/api/webhooks`
- Destinos (`webhook_destinations`): leitura e gravação pela chave `campanhas.webhooks.destinos` no formato do
  painel `{ id, event, url, active, secret, createdAt }`. O segredo é cifrado no banco, sai mascarado e, se vier
  mascarado na gravação, é preservado. URL: só `https://` em produção (`http://localhost`/`127.0.0.1` aceitos
  fora de produção, para testes). Evento ∈ `saque.solicitado|saque.pago|saque.rejeitado|saque.expirado|deposito.primeiro`.
- Execuções: `campanhas.webhooks.execucoes` (leitura; as 1000 mais recentes).
- `POST /api/webhooks/destinations/:id/test` → `{ execution }` (perm. `webhooks.editar`). Envia de verdade um
  evento de teste (timeout 5 s) e registra a execução com `test = true`.
- Disparo: `enqueueWebhook(db, event, payload)` grava em `webhook_outbox` um item por destino ativo (dentro da
  transação da ação). O laço (`startWebhookDispatcher`) processa a cada 2 s até 20 itens vencidos:
  `POST` JSON `{ id, event, createdAt, data }` com cabeçalhos `content-type: application/json`,
  `user-agent: X2Win-Webhooks/1.0`, `x-x2w-event`, `x-x2w-delivery` (id do item), `x-x2w-timestamp` (segundos) e
  `x-x2w-signature: sha256=<HMAC-SHA256(segredo, "<timestamp>.<corpo>")>`. 2xx = entregue; senão nova tentativa em
  `30 s × 2^tentativas` (máx. 1 h); após 6 tentativas = `falhou`. Toda tentativa grava `webhook_executions`.

### Equipe — `equipe.membros` e `/api/team`
- Leitura `equipe.membros` (qualquer pessoa logada): `[{ id, name, email, roleId, status, twoFactor, lastAccess,
  lastIp, createdAt, activeSessions }]`. `lastIp` só para quem tem `equipe.ver`; nunca hashes nem segredos.
- Gravação por diferença (perm. `equipe.editar`), comparando por `id`. Aceita apenas: mudança de `roleId`, de
  `status` (`ativo` ↔ `desligado`) e de `name`. Incluir/remover pessoa pela chave → 403 (use as rotas abaixo).
  Outros campos alterados são ignorados (o servidor mantém os seus).
- Regras (valem para a chave e para as rotas):
  - não pode desativar a si mesmo nem mudar o próprio cargo;
  - não pode deixar o sistema sem Superadmin ativo;
  - dar, tirar ou mexer em pessoa com cargo de nível administrativo (`isAdminLevelRole`) exige `cargos.conceder`;
  - desativar encerra todas as sessões na hora (`revokeUserSessions`).
- Rotas (todas exigem `equipe.editar`, mais `cargos.conceder` quando envolvem cargo administrativo):
  - `POST /api/team/direct` `{ name, email, roleId }` → `{ member, temporaryPassword }` (pessoa ativa com
    `must_change_password = true`).
  - `POST /api/team/invite` `{ email, roleId, name? }` → `{ member, inviteUrl }` (status `convidado`, token de 72 h,
    guardado com hash; link `<origem do painel>/#/convite?token=...`).
  - `POST /api/team/:id/resend-invite` → `{ inviteUrl }` (invalida o anterior).
  - `POST /api/team/:id/deactivate` / `POST /api/team/:id/reactivate`.
  - `POST /api/team/:id/role` `{ roleId }`.
  - `POST /api/team/:id/reset-2fa` → desliga o 2FA da pessoa e encerra as sessões (ela cadastra de novo no
    próximo login se o cargo exigir).
  - `POST /api/team/invites/accept` `{ token, name, password }` → `{ ok: true }` (sem sessão; limite 10/min por IP).

### Cargos — `cargos.lista`
- Leitura: qualquer pessoa logada (`Role[]`, teto em reais).
- Gravação por diferença (perm. `cargos.editar`):
  - Superadmin não muda. Cargos do sistema não podem ser renomeados nem excluídos.
  - Permissões precisam existir no catálogo (`PERMISSION_BY_KEY`); desconhecida → 400.
  - `approvalCeiling`: `null` (sem teto), `0` (não aprova) ou > 0.
  - Criar cargo (id novo, `system: false`) e excluir cargo personalizado sem pessoas ativas/convidadas.
  - Qualquer cargo que já é ou passa a ser de nível administrativo exige `cargos.conceder`.
  - Auditoria com o resumo do que mudou por cargo.

### Segurança do painel — `config.seguranca-painel`
- Formato do painel: `{ allowlist: [{ id, value, label, createdAt, createdBy }], enforce2faForAll, sessionTimeoutMinutes }`.
- Leitura conforme a regra; gravação com `seguranca-painel.editar`:
  - cada `value` precisa passar em `isIpOrCidr`; até 100 itens; `label` ≤ 60;
  - se a lista nova não for vazia e o IP de quem grava não estiver nela → 409 `bloquearia_voce`;
  - `sessionTimeoutMinutes` entre 5 e 1440;
  - limpa o cache da lista (`invalidateAllowlistCache`) e audita.

## Painel em modo API

Ligado com `VITE_API_MODE=1` (o Vite encaminha `/api` para `http://localhost:3333`).

- **Login**: sem sessão, o painel mostra a tela de entrada; depois as etapas `password`, `enroll` (QR code +
  códigos de recuperação) e `2fa`. Convite: rota pública `#/convite?token=...`.
- **Dados**: `useDb`/`useCollection` buscam `GET /api/kv/:key` na primeira leitura (a tela espera com o esqueleto
  de carregamento), usam o padrão local se vier 404, lista vazia se vier 403. Gravações são otimistas com
  `PUT` + `version`; erro desfaz e mostra o motivo; 409 recarrega a chave e avisa.
- **Ações de domínio**: aprovar/recusar saque, revelar PIX, criar acesso/convidar, testar webhook usam as rotas
  próprias. `audit()` do painel vira `POST /api/audit/events`.
- **Modo demonstração** (sem `VITE_API_MODE`) continua igual: dados no navegador, sem login.
