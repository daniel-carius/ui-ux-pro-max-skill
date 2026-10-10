# API do backoffice X2Win — contrato

Fonte de verdade para o servidor (`server/`) e para o painel em modo API. Os tipos TypeScript estão em
`shared/api.ts`; as regras compartilhadas, em `shared/*.ts` (permissões, auditoria, saques, chaves de dados,
jogadores). Tudo em pt-BR, valores em reais (number), datas ISO. Em caso de dúvida, vale o código da rota
(`server/src/modules/**`).

## Regras gerais

- **Base**: `/api`. JSON em UTF-8. Toda resposta sai com `Cache-Control: no-store` (a exportação CSV define o
  dela, também `no-store`).
- **Sessão**: cookie `x2w_sid` (`HttpOnly`, `SameSite=Strict`, `Secure` conforme `COOKIE_SECURE`). O token vai só
  no cookie; o banco guarda o hash SHA-256 dele.
- **HTTPS atrás do proxy**: com `TRUST_PROXY > 0` e `COOKIE_SECURE=true`, toda requisição (menos `/api/health`) que
  o proxy não marcou com `X-Forwarded-Proto: https` recebe 403 `https_obrigatorio`.
- **CSRF**: todo método que não seja GET/HEAD/OPTIONS exige o cabeçalho `X-Requested-With: x2w`. Sem ele: 403
  `requisicao_invalida`.
- **Lista de IPs**: se a lista do painel não estiver vazia, qualquer requisição a `/api/*` de um IP fora dela
  responde 403 `ip_nao_autorizado`, inclusive o login. Ficam de fora só `GET /api/health` e `POST /api/auth/logout`
  (quem ficou fora da lista ainda consegue sair; CSRF e HTTPS continuam valendo na saída).
- As checagens acima são decididas pela rota que o roteador escolheu (caminho já decodificado), nunca pelo texto
  cru da URL: `/%61pi/...` e caminhos sem rota passam por elas do mesmo jeito.
- **Escrita sem sessão**: POST/PUT/DELETE sem sessão válida recebe 401 `nao_autenticado` antes de o corpo ser
  lido, inclusive para rota inexistente. Exceções: `POST /api/auth/login`, `POST /api/auth/logout` e
  `POST /api/team/invites/accept`.
- **Guardas** (`server/src/http.ts`): `requireActive(req)` exige login completo; `requirePerm(req, ...perms)` exige
  uma das permissões. Permissões vêm do cargo no banco (`roles.permissions`), nunca do painel.
- **Auditoria**: toda escrita bem-sucedida grava em `audit_log` (quem, quando, IP, ação, entidade, resumo,
  origem). Quem, quando e IP vêm sempre do servidor.

### Limites de corpo

| Onde | Limite | Acima do limite |
| --- | --- | --- |
| Rotas em geral (sessão ativa) | 1 MiB | 413 `corpo_grande_demais` |
| `PUT /api/kv/:key`, `POST /api/kv/geral.jogadores/import`, `POST /api/kv/geral.transacoes/import` | 12 MiB | 413 `corpo_grande_demais` |
| `/api/auth/*` (qualquer etapa) | 16 KiB | 413 `corpo_grande_demais` |
| Sem sessão ativa (rotas públicas e etapas pendentes do login) | 16 KiB, com `Content-Length` | 413 `corpo_grande_demais`; corpo em partes: 411 `requisicao_invalida` |
| Valor de uma chave genérica (`/api/kv`) | 2 MiB; 12 MiB nas chaves de imagens e de registros (`maxBytes`) | 413 `dados_grandes_demais` (`details.bytes`, `details.max`) |

A recusa antes de ler o corpo fecha a conexão (`Connection: close`) quando o corpo nunca seria aceito. O nginx do
`deploy/` aplica `client_max_body_size 1m` em `/api/` e `12m` em `/api/kv/`, e devolve o mesmo JSON
`corpo_grande_demais`.

### Limites de taxa

| Rota | Limite | Chave |
| --- | --- | --- |
| `POST /api/auth/login`, `/2fa/verify`, `/2fa/setup`, `/2fa/enable`, `/password` | 10/min | IP |
| `POST /api/team/invites/accept` | 10/min | IP |
| `POST /api/audit/events` | 30/min por pessoa e 120 aceitos/min por IP | pessoa e IP |
| `GET /api/audit/export.csv` | 20/min | IP |
| `PUT /api/kv/:key` | 240/min por IP e 240/min por pessoa | IP e pessoa |
| `POST /api/withdrawals/:id/reveal-pix`, `POST /api/webhooks/destinations/:id/reveal` | 30/min | IP |
| `POST /api/webhooks/destinations/:id/test` | 10/min | IP |
| Demais rotas | 600/min | IP |

Acima do limite: 429 `muitas_tentativas`.

**Fila de senhas**: todo cálculo de senha (scrypt) passa por uma fila única do processo: no máximo
`min(4, UV_THREADPOOL_SIZE / 2)` ao mesmo tempo (pelo menos 1) e 16 esperando. Fila cheia: 503 `servidor_ocupado`
com `Retry-After: 2`, sem gravar nada. Vale para login, troca de senha, cadastro do 2FA com sessão ativa, criar
acesso direto e aceitar convite.

### Erros

Corpo: `{ "error": { "code": "...", "message": "...", "details"?: ... } }`. `message` é para a pessoa (pt-BR);
`code` é estável para o painel.

| HTTP | code | Quando |
| --- | --- | --- |
| 400 | `dados_invalidos` | corpo inválido (`details` com `path` e `message` de cada campo) ou regra de negócio violada (`details.field`/`details.id` quando a regra aponta um campo) |
| 400 | `chave_local` | chave que fica só no navegador |
| 400/415 | `requisicao_invalida` | JSON malformado e outros erros de protocolo |
| 401 | `nao_autenticado` | sem sessão válida (inclusive sessão encerrada por exigência de 2FA) |
| 401 | `credenciais_invalidas` | e-mail/senha, código do 2FA ou senha atual errados |
| 403 | `requisicao_invalida` | sem o cabeçalho `X-Requested-With: x2w` |
| 403 | `https_obrigatorio` | requisição que não chegou ao proxy por HTTPS |
| 403 | `ip_nao_autorizado` | IP fora da lista do painel |
| 403 | `etapa_pendente` | sessão existe mas o login não terminou (`details.stage`) |
| 403 | `sem_permissao` | cargo sem a permissão (a mensagem explica a regra, ex.: governança) |
| 403 | `campo_nao_permitido` | tentou alterar campo, incluir ou remover registro que o cargo não pode (`details.fields`) |
| 403 | `transicao_nao_permitida` | mudança de status que a regra não aceita (jogador, apuração de GGR, concessão de campanha) |
| 403 | `teto_excedido` | valor acima do teto de aprovação do cargo (`details.ceiling`, mais `amount` ou `autoApproveMax`) |
| 403 | `segregacao_funcoes` | quem lançou crédito manual ou estorno para o jogador não aprova o saque dele |
| 403 | `evento_nao_relatavel` | evento de auditoria que o painel não pode relatar (`details.reason`) |
| 404 | `nao_encontrado` | registro inexistente |
| 404 | `chave_desconhecida` | chave de dados sem registro |
| 404 | `sem_historico` | chave que não guarda histórico |
| 409 | `versao_desatualizada` | outra pessoa gravou antes (`details.version` = atual) ou duas gravações se cruzaram no banco (impasse ou falha de serialização: sem `details`, transação desfeita) |
| 409 | `ja_decidido` | saque (de jogador ou de afiliado) já decidido |
| 409 | `jogador_bloqueado` | pagamento segurado pelo anti-fraude (`details.reason`) |
| 409 | `fora_das_regras` | saque fora das regras em vigor (`details.rule`) |
| 409 | `pedido_invalido` | pedido de saque de afiliado com valor inválido |
| 409 | `email_em_uso` | e-mail já cadastrado na equipe |
| 409 | `nome_em_uso` | nome igual ou que se confunde com o de outra pessoa (`details.field = 'name'`) |
| 409 | `bloquearia_voce` | a lista de IPs deixaria o seu IP de fora |
| 409 | `ja_configurado` | 2FA já ligado |
| 411 | `requisicao_invalida` | corpo em partes sem `Content-Length` antes do login completo |
| 413 | `corpo_grande_demais` | corpo acima do limite da rota (API ou nginx) |
| 413 | `dados_grandes_demais` | valor acima do limite da chave |
| 423 | `conta_bloqueada` | muitas tentativas erradas (`details.until`) |
| 429 | `muitas_tentativas` | limite de taxa |
| 500 | `erro_interno` | erro inesperado (sem detalhes) |
| 501 | `nao_implementado` | chave de domínio sem módulo no servidor |
| 503 | `servidor_ocupado` | fila de senhas cheia (`Retry-After: 2`) |

`409 versao_desatualizada` pode vir de qualquer rota que grava. O painel mostra a mensagem e recarrega os dados.

## Saúde — `GET /api/health`

Pública (fora da lista de IPs, do CSRF e do HTTPS obrigatório). `200 { ok: true, db }` só quando o banco responde
a `select 1` em até 2 s; senão `503 { ok: false, db, error: { code: 'banco_indisponivel', message } }`. É a sonda
do `HEALTHCHECK` do contêiner e da monitoração externa.

## Autenticação — `/api/auth`

Etapas (`stage`) de uma sessão: `password` → `2fa` | `enroll` → `active`. Só `active` acessa o resto da API.
Etapas pendentes valem 10 minutos; sessão ativa vale 12 h no máximo e cai após o tempo de inatividade configurado
em Segurança do painel (padrão 240 min, de 5 a 1440).

**Exigência de 2FA**: vale quando o cargo tem `require2fa` ou "2FA para todos" está ligado. É conferida em toda
requisição, não só no login: se ela passa a valer (troca de cargo, "Exigir 2FA" no cargo, "2FA para todos",
Superadmin forçado na subida) para uma sessão ativa de quem não tem 2FA, a sessão é encerrada (401
`nao_autenticado`). No próximo login, com a senha conferida de novo, a pessoa cai em `enroll`.

### `POST /api/auth/login` — `{ email, password }` → `{ stage }`
- E-mail comparado em minúsculas. Pessoa `desligado`/`convidado`, e-mail inexistente ou senha errada → 401
  `credenciais_invalidas`, com a mesma mensagem; o hash é sempre calculado (tempo de resposta parecido).
- **Freio por e-mail + origem**: 5 senhas erradas seguidas para o mesmo e-mail a partir da mesma faixa de IP
  (/24 no IPv4, /64 no IPv6) bloqueiam essa combinação por 15 min: 423 `conta_bloqueada` (`details.until`), mesmo
  com a senha certa. Vale igual para e-mail existente, inexistente, convidado ou desligado; outras origens
  continuam entrando. Os erros são esquecidos após 1 h sem erro novo. A contagem fica na memória do processo
  (cada instância da API conta à parte). Quando o bloqueio atinge uma pessoa ativa, a auditoria registra
  `bloquear` / `Acesso ao painel` (no máximo um por pessoa a cada 15 min).
- Conta bloqueada por erros depois da senha (veja abaixo): senha certa → 423 `conta_bloqueada`.
- Sucesso decide a etapa: `must_change_password` → `password`; senão 2FA ligado → `2fa`; senão exigência de 2FA →
  `enroll`; senão `active`. Sem 2FA, zera os erros da conta; com 2FA, só o código aceito zera.
- Revoga a sessão anterior do mesmo navegador (cookie presente), cria a nova e define o cookie.
- Ao chegar em `active`: grava `last_access_at`, `last_ip` e auditoria `login` / `Acesso ao painel`.
- 503 `servidor_ocupado` com a fila de senhas cheia.

### Bloqueio da conta (erros depois da senha)
`users.failed_logins` / `locked_until` contam só erros de quem já passou da senha ou tem sessão: código do 2FA
errado (`/2fa/verify`, `/2fa/enable`) e senha atual errada com sessão ativa (`/password`, `/2fa/setup`). Cada erro
vai para a auditoria (`recusar` / `Acesso ao painel`, com o motivo); o 5º bloqueia a conta por 15 min (`bloquear`)
e responde 423. Com sessão ativa, o erro que bloqueia também encerra a sessão. A contagem só volta a zero com um
acesso completo.

### `POST /api/auth/2fa/verify` — `{ code }` → `{ stage: 'active' }` (sessão em `2fa`)
- Aceita 6 dígitos do TOTP (janela de ±1 passo de 30 s) ou um código de recuperação.
- Recusa reutilizar o mesmo passo de tempo (`totp_last_counter`). Código de recuperação é de uso único.
- Erro → 401 `credenciais_invalidas` e conta para o bloqueio da conta.

**Códigos de recuperação**: 8 por cadastro, 20 caracteres Crockford base32 em 4 grupos de 5
(`XXXXX-XXXXX-XXXXX-XXXXX`, 100 bits). O servidor aceita minúsculas, espaços, sem hífens e as trocas O→0 e I/L→1.
No banco fica só `v2$` + HMAC-SHA256 com `APP_SECRET` e o id da pessoa: trocar o `APP_SECRET` invalida todos os
códigos. Códigos do formato antigo (10 caracteres) não são mais aceitos; o TOTP continua valendo e códigos novos
vêm com "Redefinir 2FA" e um novo cadastro.

### `POST /api/auth/2fa/setup` — `{ currentPassword? }` → `{ secret, otpauthUrl }` (sessão em `enroll` ou `active`)
- Com sessão `active`, `currentPassword` é obrigatório: ausente → 400 `Informe a senha atual.`; errado → 401
  (conta para o bloqueio); bloqueio → 423 e a sessão é encerrada. Na etapa `enroll` a senha acabou de ser digitada.
- Gera segredo novo e guarda cifrado como pendente. 2FA já ligado → 409 `ja_configurado`.

### `POST /api/auth/2fa/enable` — `{ code }` → `{ stage, recoveryCodes }` (sessão em `enroll` ou `active`)
- Confere com o segredo pendente (sem ele: 400). Código errado conta para o bloqueio da conta.
- Liga o 2FA, gera os 8 códigos de recuperação, encerra as outras sessões da pessoa e audita `ligar` / `2FA`.
  `enroll` → `active` (com auditoria `login`).

### `POST /api/auth/password` — `{ currentPassword?, newPassword }` → `{ stage }`
- Na etapa `password` a senha atual é dispensada; com sessão `active` é obrigatória e o erro conta para o bloqueio.
- Regra: ao menos 10 caracteres, letras e números, diferente da atual.
- Zera `must_change_password`, encerra as outras sessões e calcula a próxima etapa. Auditoria `editar` / `Senha`.

### `POST /api/auth/logout` → 204
Revoga a sessão do próprio cookie e apaga o cookie. Funciona fora da lista de IPs.

### `GET /api/auth/me` → `MeResponse`
Qualquer etapa. Sem sessão → 401. `role`, `permissions` e `sessionTimeoutMinutes` só com `stage: 'active'`.

## Dados por chave — `/api/kv/:key`

Cada tela guarda seus dados por chave (ex.: `campanhas.cupons`). As regras de cada chave estão em
`shared/kv-registry.ts` (`KV_RULES`, `findKvRule`, `canReadKey`, `canWriteKey`).

- **Chaves aceitas**: só as registradas e as filhas listadas em `children` da regra (ex.:
  `cassino.agregadores.testes`). Qualquer outra → 404 `chave_desconhecida`. Chave local (`isLocalOnlyKey`:
  preferências e rascunhos) → 400 `chave_local`.
- **GET** → `{ key, value, version, updatedAt, stored }`, já mascarado. Sem permissão de leitura → 403. Nunca
  gravada → 200 com `stored: false`, `value: null`, `version: 0`. O painel então mostra `[]` para lista de
  registros e o padrão da tela para objeto de configuração, nunca os dados de demonstração; um gerador de
  `src/data` (ou o padrão de uma tela com dado de demonstração: Empresa, Integrações, Suporte, Manutenção) registra o
  próprio valor do modo API com `apiValue()`/`demoRecords()` (`src/data/demo.ts`).
- **PUT** `{ value, version? }` → mesmo formato da leitura.
  - Sem permissão de escrita (`writePermissions`) → 403. Chave do servidor (`write: 'servidor'`) → 403
    `Estes dados são gravados só pelo servidor.`
  - Já existe valor e `version` diferente da atual (ou ausente) → 409 `versao_desatualizada` com `details.version`.
    Chave nunca gravada aceita a primeira gravação (o painel manda `version: 0`).
  - Valor precisa ser JSON gravável (até 64 níveis, números finitos, sem caractere nulo) e caber no limite da
    chave (413 `dados_grandes_demais`).
  - Grava com `version + 1` e audita `editar` em "Dados · <título da tela>" com o resumo do que mudou e as versões:
    `<chave> — <resumo> (vN→vM)`. Alguns validadores trocam ação e entidade (veja "Estado do site").
- **Leitura** (`read`): `'equipe'` = qualquer pessoa logada (configuração sem dado sensível); `'tela'` = quem vê a
  tela dona ou uma das `readPages`. Domínios (`domain`) têm módulo próprio no servidor.
- **Projeções mínimas** (`teamView`): quem lê uma chave `'equipe'` sem ver a tela dona recebe só os campos
  listados (o resto não sai, nem mascarado):
  - `config.integracoes` (sem `integracoes.ver`/`.editar`): `emailProvider`, `smtp.fromName`, `smtp.fromEmail`,
    `mailgun.connected`, `mailgun.domain`, `sendwork.connected`, `sendwork.smsSender`, `sendwork.rcsAgent`;
  - `config.manutencao` (sem `manutencao.ver`/`.editar`): `active`, `message`, `returnAt`, `since` (sem o link de
    testes `bypassToken`). Não grave de volta o valor projetado.
- **Chaves do servidor** (`write: 'servidor'`, PUT → 403): `geral.jogadores.pausas`, `geral.jogadores.audiencia`,
  `geral.jogadores.metricas`, `operacao.saques`, `operacao.depositos`, `esportes.apostas`, `afiliados.saques`,
  `campanhas.webhooks.execucoes`, `campanhas.roleta.giros`, `campanhas.cupons.resgates`, `auditoria.registros`.
- **Chaves validadas pelo servidor** (400 `dados_invalidos` com a mensagem do painel quando a regra não passa):
  - campanhas: `campanhas.cupons`, `.bonus-deposito`, `.cashback`, `.niveis`, `.missoes`, `.torneios`, `.roleta`,
    `.loja`, `.free-spins.concessoes` (o servidor monta a concessão manual; gravada só pode ser cancelada;
    mesmas recusas do painel: jogador autoexcluído, em pausa ou bloqueado, campanha com fim no passado e acima do
    `maxPerPlayer` da campanha, contando as concessões não canceladas) e `.loja.compras` (só
    `pendente → entregue/estornada` e `entregue → estornada`).
    Missões, torneios, roletas e itens da loja são listas de objetos com `id` único (até 64 caracteres, no máximo
    1000 itens). Campos do servidor, que ignoram o valor enviado: `missoes.started/completions/createdAt`,
    `torneios.participants/createdAt/closedAt/closedBy` (torneio encerrado não reabre), `roleta.createdAt`,
    `loja.sold/createdAt`;
  - reguladas: `config.jogo-responsavel`, `config.paises.bloqueados` (ISO de 2 letras; nunca `BR`),
    `seguranca.bloqueios` (bloqueio gravado não muda; autor e data do servidor), `config.dominios.verificacoes`
    (só inclui no início; id, data e autor do servidor) e `operacao.depositos.limites`;
  - conteúdo do site público: `personalizacao.*`, `campanhas.popups-inbox(.popups|.inbox)`,
    `campanhas.notificacoes(.historico)`, `campanhas.disparos(.historico)` e `config.textos-legais`. Links só
    caminho interno (`/promocoes`) ou `https://`; imagens só data URL de imagem (SVG estático); cores `#RRGGBB`;
    textos sem marcação HTML; redes sociais no domínio da rede; versão nova dos Termos ou da Política de jogo
    responsável com o aviso de maioridade (18) e a menção a jogo responsável;
  - `config.integracoes`: formato fechado (campo desconhecido → 400), porta 1–65535, segredo vazio ou com 8+
    caracteres.

### Histórico de versões
Chaves com `history: true` (configurações reguladas e de campanha: `campanhas.cupons`, `.cashback`, `.niveis`,
`config.jogo-responsavel`, `config.paises.bloqueados`, `seguranca.bloqueios`… veja o registro) guardam cada versão
substituída, na mesma transação, como linha `~hist:<chave>@<versão>` de `kv_store`. O banco recusa alterar ou
apagar essas linhas (gatilho `kv_history_no_change`).
- `GET /api/kv/:key/history` → `{ key, entries: [{ entry, version, updatedAt, updatedBy }] }` (até 200, mais
  recentes primeiro).
- `GET /api/kv/:key/history/:entry` → `{ key, entry, version, updatedAt, value }`, mascarado como na leitura.
- Exigem leitura da chave **e** `auditoria.ver` (senão 403). Chave sem histórico → 404 `sem_historico`; versão
  inexistente → 404 `nao_encontrado`.

### Segredos (`rule.secrets`)
- Em repouso: o JSON inteiro é cifrado (AES-256-GCM, `kv_store.value_enc`).
- Na leitura: todo campo cujo nome casa com `SECRET_FIELD` (e tudo dentro dele) sai mascarado: só pontos
  (`••••••••••`) para segredo com menos de 16 caracteres, número ou booleano; pontos + últimos 4 com 16+.
- Na gravação: só a **máscara exata** que a leitura emitiu mantém o valor gravado no mesmo caminho (objetos em
  listas casam por `id`, sem `id` pela posição; cada item gravado serve a um só item enviado). Outro texto com `•`
  ou `***` → 400 (`details.path`). Máscara sem valor gravado correspondente → 400.
- Segredo mantido pela máscara fica preso ao destino: se o objeto que o guarda mudou um campo de destino (host,
  porta, TLS, URL, domínio, região, ambiente, gateway, cliente, conta, usuário, plataforma) → 400
  `O destino desta credencial mudou (<campo>): digite o segredo novamente.` (`details` = `{ path, field, reason: 'destino_mudou' }`;
  o painel reconhece o erro por `reason`).
- `config.gateways` só é lida por quem vê Gateways (`gateways.ver`/`.editar`).

### Dados pessoais (`rule.pii`)
- Cifrados em repouso. Campos pessoais: `PII_FIELD` (cpf, email, phone, pixKey, ip…), os mesmos nomes com prefixo
  (`playerEmail`, `player_email`, `lastIp`) e os extras da regra (`piiFields`, ex.: `agency`, `account`, `holder`).
- Quem não tem `rule.pii.revealPermission` recebe os campos mascarados: e-mail `ab***@dominio`, CPF
  `123.***.***-09`, telefone `(11) 9****-1234`, IPv4 `189.45.***.***`, IPv6 só os 2 primeiros grupos, agência
  `••34`, conta `•••65-4`, titular `J*** S***`, outros `•••` + últimos 4. Na gravação, valores mascarados são
  restaurados do gravado (mesma regra dos segredos).
- Leitura em claro (quem tem a permissão) vai para a auditoria do servidor: `revelar` em "Dados · <tela>", uma vez
  por sessão e chave a cada 10 minutos (também na resposta do PUT e na leitura de uma versão do histórico).
- `revealByRecord` (`afiliados.saques`, `crescimento.afiliados`): mascarados para **todos** na lista; o dado em
  claro sai um registro por vez, pelas rotas de revelar (veja "Afiliados").

### Endereços com token (`rule.urls`)
Em `campanhas.webhooks.destinos`, quem não tem `webhooks.editar` recebe a URL com os trechos de token mascarados
(segmentos com cara de token, todos os valores da query, usuário/senha e âncora). Quem tem `webhooks.editar` recebe
a URL completa (o formulário de edição precisa dela): a leitura não é auditada, e o painel mostra a URL mascarada
nas listas e na ficha. `campanhas.webhooks.execucoes` guarda a URL já mascarada: ela sai mascarada para todos,
inclusive para quem edita.

## Jogadores e extrato

### `geral.jogadores` (domínio `players`)
Leitura: Usuários e as telas que trabalham com jogadores individuais (`transacoes`, `antifraude`, `rankings`,
`indicados`, `links`, `ranking-afiliados`, `afiliados-gerentes`), com dados pessoais mascarados para quem não tem
`usuarios.ver-dados`. Gravação por diferença, comparando por `id`:
- incluir ou remover jogador → 403 `campo_nao_permitido` (jogadores vêm da plataforma; nada gravado = lista vazia);
- `usuarios.editar` muda `tags`, `status` e `coins`; `antifraude.banir` muda `status`; outro campo → 403
  `campo_nao_permitido` (`details.fields`);
- `balanceReal` e `balanceBonus` são do servidor: o valor enviado é ignorado (a auditoria anota "saldo enviado
  ignorado"); o saldo só muda por lançamento no extrato;
- status (`shared/players.ts`, `STATUS_TRANSITIONS`): `ativo → pausa` e `pausa → ativo` (`usuarios.editar`);
  `ativo/pausa → bloqueado` e `bloqueado → ativo/pausa` (`usuarios.editar` ou `antifraude.banir`); `autoexcluido`
  nunca entra nem sai pelo painel. Pausa pedida pelo jogador (ou sem registro) só termina no prazo. Fora disso →
  403 `transicao_nao_permitida`. Jogador autoexcluído não recebe moedas.

`geral.usuarios.status` (domínio `player-status`, grava com `usuarios.editar`): histórico só de inclusão; o
servidor define `at`, `by`, `byId` e `byPlayer`; `pausar` precisa de `until` no futuro e no máximo 30 dias.
`geral.jogadores.pausas` é só do servidor.

### `geral.transacoes` (domínio `transactions`)
Extrato só de inclusão, cifrado e com dados pessoais mascarados. Todo item gravado precisa voltar igual (por
`id`); alterar ou remover → 403 `campo_nao_permitido`. Itens novos:
- só `credito_manual`/`debito_manual` (`usuarios.editar`) e `estorno` (`transacoes.editar`); outro tipo → 403
  `campo_nao_permitido`; sem a permissão do tipo → 403 `sem_permissao`; no máximo 50 por gravação;
- o jogador precisa existir em `geral.jogadores`; autoexcluído não recebe creditação; débito não passa do saldo;
  teto de R$ 5.000 por lançamento manual e soma das creditações manuais de um jogador até R$ 5.000 em 24 h;
  estorno referencia a original (`EST-<id>`), só de aposta ou subtração ainda não estornada, no prazo de 15 dias;
- o servidor define `at`, `by`, `byId`, `balanceBefore`, `balanceAfter`, `playerName`, `playerEmail` (e o jogo, no
  estorno); a lista gravada é itens novos + gravados. O saldo do jogador muda na mesma transação, sem mudar a
  versão de `geral.jogadores`. Cada lançamento vira um registro `creditar`/`estornar` na auditoria.

### Importação e correção de base (Superadmin com 2FA ativo; senão 403)
- `POST /api/kv/geral.jogadores/import` `{ players }` → `{ ok, imported, version }`. Até 5000 por vez; recusa ids
  repetidos ou já gravados e dados mascarados. Auditoria `criar`.
- `POST /api/kv/geral.jogadores/remove` `{ ids, reason }` (motivo de 3 a 300) → `{ ok, removed, version }`. Para
  dados gravados por engano ou pedido do titular (LGPD art. 18); o extrato não muda. Auditoria `excluir`.
- `POST /api/kv/geral.transacoes/import` `{ transactions }` → `{ ok, imported, version }`. Até 20.000 por vez;
  só ids novos, sem data no futuro; não mexe em saldo. Auditoria `criar`.

### Visões calculadas (domínio `player-projections`, só leitura)
Para as telas que não leem a base inteira. `version` e `updatedAt` são os de `geral.jogadores`; `stored` sempre
`true`; sem base, valor vazio. Sem histórico.
- `geral.jogadores.audiencia` (Promoções, Free spins, Torneios, Níveis, Disparos, Notificações, Popups/inbox):
  só jogadores `ativo`, `[{ id, nickname, level, xp, tags, createdAt, lastAccess, depositsCount, lastDepositAt }]`;
  `tags` só `VIP` e `Bônus abuser`.
- `geral.jogadores.metricas` (as mesmas telas mais Dashboard, Cadastro, Jogo responsável, Textos legais, Moeda e
  Cashback): `{ total, byStatus, kyc, newPlayers { today, last7Days, last30Days }, depositors,
  coins { circulation, holders }, referrals: [{ affiliateId, code, signups, depositors, deposited }] (top 50),
  referralsDeposited, cashback { diario|semanal|mensal: { active, eligible, total, capped } }, generatedAt }`.
  O cashback é a projeção do próximo crédito com as regras **gravadas** (`campanhas.cashback` e `campanhas.niveis`;
  padrão do painel quando nada gravado). Salvar essas regras muda os números sem mudar a versão: releia depois.

## Afiliados

### `crescimento.afiliados` (domínio `affiliates`)
Leitura: Afiliados e gerentes e as telas de afiliados (`AFFILIATE_READ_PAGES`), com e-mail e chave PIX
mascarados para todos. Gravação por diferença: `comissoes.editar` muda só `code`; `afiliados-gerentes.editar`
muda cadastro e contrato e inclui/remove afiliados; outro campo → 403 `campo_nao_permitido`. `balance` e
`createdAt` são do servidor. Código único (A–Z, 0–9), CPA de 0 a R$ 2.000, Rev Share de 0 a 60%, e-mail válido e
único, gerente existente.

`crescimento.comissoes` (regra por tipo, com histórico) e `crescimento.ggr.apuracoes` (`ggr.apurar`: ciclo
`aberta → fechada → paga`, nunca volta; fechar só depois do fim do mês; o servidor carimba quem fechou e pagou)
também são validadas pelo servidor.

### Saques de afiliados — `afiliados.saques` (só o servidor grava)
Os pedidos vêm da plataforma. Chave PIX, e-mail e dados bancários (agência, conta, titular) saem mascarados para
todos. Decisão pelas rotas (exigem `afiliados-saques.aprovar`, governada):
- `POST /api/kv/afiliados.saques/:id/pay` → `{ ok, message, withdrawal, version }`. Só pedido `pendente` (senão
  409 `ja_decidido`; inexistente 404). Cargo com teto > 0 não paga acima dele (403 `teto_excedido`). O servidor
  define `decidedBy`, `decidedById`, `decidedAt` e a referência interna (`PIX-…`, `TED-…`, `CRED-…`; não é o
  identificador do banco). Auditoria `aprovar` / `Saque de afiliado #<id>`. **Só registra a decisão**: não há
  gateway integrado nem webhook; o PIX, a TED ou o crédito no saldo do jogo são feitos pelo financeiro fora do painel
  (a `message` avisa).
- `POST /api/kv/afiliados.saques/:id/reject` `{ reason }` (3–300) → idem; o valor volta para o saldo de comissão
  do afiliado na mesma transação. Auditoria `recusar`.
- `POST /api/kv/afiliados.saques/:id/reveal` (sem corpo) → `{ ok, id, affiliateId, affiliateEmail, method,
  pixKeyType, pixKey, bank: { bank, agency, account, holder } | null }`.
- `POST /api/kv/crescimento.afiliados/:id/reveal` → `{ ok, id, email, pixKey }`.

As duas rotas de revelar exigem `afiliados-saques.ver-pix` **e** leitura da chave; 404 sem o registro. Cada
chamada grava `revelar` (`Saque de afiliado #<id>` / `Afiliado #<id>`) com os campos vistos, nunca os valores. O
painel mostra o dado na hora e não o guarda.

## Depósitos — `operacao.depositos` (só o servidor grava)
`POST /api/kv/operacao.depositos/recheck` `{ ids }` (1 a 500; `depositos.editar`) →
`{ ok, expired, unchanged, missing, version }`. Cada depósito `pendente` com o prazo do PIX vencido (prazo de
`operacao.depositos.limites`, padrão 30 min) vira `expirado`; nada é incluído ou removido. Cada baixa audita
`sincronizar` / `Depósito #<id>`. Releia a chave depois.

## Saques — `operacao.saques` (leitura) e `/api/withdrawals`
Leitura via `GET /api/kv/operacao.saques` (`saques.ver`): todos os saques em aberto mais os 5000 mais recentes,
no formato do painel (`src/data/finance.ts` › `Withdrawal`). `pixKey` sempre mascarada conforme `pixKeyType`;
`playerEmail` mascarado sem `usuarios.ver-dados`; `decidedBy` (nome), `decidedById` e `decidedByEmail` (e-mail
atual da equipe). Gravação pela chave: 403.

- `POST /api/withdrawals/:id/approve` → `{ ok, message, queuedDeliveries, withdrawal }`
  - Exige `saques.aprovar` e cargo que aprova (teto ≠ 0); senão 403 `sem_permissao`.
  - Aprovações do mesmo jogador são feitas uma de cada vez. Ordem dos erros: 404; 409 `ja_decidido`; 403
    `teto_excedido` (`details { ceiling, amount }`); 409 `jogador_bloqueado` (jogador `bloqueado` ou conta de rede
    banida em `seguranca.bloqueios`; `details.reason`); 409 `fora_das_regras` (`details { rule: 'maxPerRequest',
    limit, amount }` ou `{ rule: 'dailyLimit', limit, count }`, contando os saques `aprovado` do jogador nas
    últimas 24 h); 403 `segregacao_funcoes` (quem pede lançou `credito_manual` ou `estorno` para o jogador nos
    últimos 30 dias).
  - Na mesma transação: status `aprovado`, auditoria `aprovar` / `Saque #<id>` e o webhook `saque.pago` na fila.
  - A aprovação não paga o PIX: `saque.pago` é um aviso aos sistemas da operação (não há gateway integrado).
    `queuedDeliveries` = avisos postos na fila (um por destino ativo); com 0, a mensagem avisa que o pagamento
    precisa ser feito pelo financeiro no gateway.
- `POST /api/withdrawals/:id/reject` — `{ reason }` (3–300) → `{ ok, message, withdrawal }`, status `recusado`,
  auditoria `recusar`, webhook `saque.rejeitado`.
- `POST /api/withdrawals/:id/reveal-pix` → `{ pixKey }`. Exige `saques.ver` e `usuarios.ver-dados`. Auditoria
  `revelar`.
- Regras: `operacao.saques.regras` (GET com `saques.ver` ou `rollover.ver`; PUT com `saques.editar`), validadas por
  `validateWithdrawalRules` (valores positivos, no máximo 2 casas decimais, aprovação automática até o máximo por
  saque…). Ligar ou mudar a aprovação automática (`autoApproveMax`) para um valor acima do teto de quem grava, ou
  sem poder decidir saques → 403 `teto_excedido` (`details { ceiling, autoApproveMax }`, `ceiling` 0 para quem
  não decide); manter o valor gravado ou pôr 0 é sempre aceito (`checkAutoApproveCeiling`). Nunca gravadas: GET
  devolve `DEFAULT_WITHDRAWAL_RULES` com `version: 0`.

## Auditoria — `auditoria.registros` e `/api/audit`

### Leitura pela chave `auditoria.registros`
Os 1000 registros mais recentes do servidor mais os 200 mais recentes relatados pelo painel, juntos, do mais novo
para o mais antigo (`AuditEntry` com `source`). `version` = maior id gravado. A trilha inteira só com
`auditoria.ver`. Sem ela, quem lê pela tela recebe só a fatia dela, filtrada no banco antes dos limites:
- Modo de ataque: entidade `Modo de ataque`;
- Segurança do painel: `Segurança do painel`, `2FA`, `2FA · *` e os `login` em `Acesso ao painel`;
- Equipe: `Equipe`, `Equipe · *`, `Dados · Equipe` e `2FA · *`;
- Manutenção: `Manutenção` (quem fechou o site);
- Empresa e licença: `Empresa e licença` (e `Dados · Empresa e licença`, das gravações antigas).

Nas fatias, `ip` vem vazio nos registros de outras pessoas.

### `POST /api/audit/events` — `{ action, entity, summary }` → 201 `{ id }`
Eventos que a tela relata (`source = 'painel'`, "relatado pelo painel (não verificado)"). Sessão ativa. Regra em
`shared/audit.ts` › `panelAuditDecision`:
- ações só do servidor: `login`, `aprovar`, `recusar`, `revelar`, `banir`, `creditar`, `estornar`, `desativar`,
  `convidar`, `revogar`;
- entidades só do servidor: `Dados · *`, `Acesso ao painel`, `2FA`, `2FA · *`, `Senha`, `Saque #*`,
  `Modo de ataque`, `Manutenção`, `Empresa e licença`;
- a entidade precisa estar em `PANEL_EVENT_RULES` (ou ser o título exato de uma tela); entidade desconhecida é
  recusada;
- permissão: `exportar` exige `<tela>.exportar` (se existir) ou ver a tela; as demais, `<tela>.editar` (ver, se a
  tela não tem edição; ou a permissão própria da regra, ex.: `ggr.apurar`, `antifraude.banir`).

Recusa: 403 `evento_nao_relatavel` (`details.reason`: `acao_do_servidor`, `entidade_do_servidor`,
`evento_desconhecido`) ou 403 `sem_permissao`. Entidade ≤ 200 e resumo ≤ 1000 caracteres. Limites: 30/min por
pessoa e 120 aceitos/min por IP.

### `GET /api/audit?from&to&actorId&action&page&pageSize` → `AuditListResponse`
Perm. `auditoria.ver`. `from`/`to` aceitam data (`AAAA-MM-DD`, dia inteiro em UTC) ou data e hora ISO;
`pageSize` ≤ 200, padrão 50.

### `GET /api/audit/export.csv?...mesmos filtros` → CSV
Perm. `auditoria.exportar`. Até 50.000 registros (os mais recentes), `;` como separador, BOM UTF-8, horário de
Brasília, fórmulas neutralizadas (`=`, `+`, `-`, `@` no início). Colunas: `Data e hora;Quem fez;ID de quem fez;
E-mail de quem fez;Ação;Entidade;Resumo;IP;Origem`. O e-mail é o atual da pessoa; id e e-mail vêm vazios nos
registros do sistema. Origem: `servidor` ou `relatado pelo painel (não verificado)`. Gera auditoria `exportar` /
`Auditoria`.

### Imutabilidade
O banco recusa `UPDATE`, `DELETE` e `TRUNCATE` em `audit_log`, e a API conecta com um papel que só tem `SELECT` e
`INSERT` nela (veja "Banco e migrações").

## Webhooks — `campanhas.webhooks.*` e `/api/webhooks`

### Destinos — `campanhas.webhooks.destinos`
Formato do painel `{ id, event, url, active, secret, createdAt }`. Leitura por Webhooks, Templates e
Estatísticas; gravação com `webhooks.editar` (permissão administrativa, veja "Governança"). Evento ∈
`saque.solicitado | saque.pago | saque.rejeitado | saque.expirado | deposito.primeiro`.
- No banco, a URL fica cifrada (`url_enc`, AES-256-GCM) e só o host em claro; o segredo também é cifrado. Linhas
  antigas são cifradas na subida da API.
- Leitura e versão saem de uma foto só do banco. Quem não tem `webhooks.editar` recebe a URL com os tokens
  mascarados.
- PUT exige `version`, também na primeira gravação (0); sem ela → 409 antes de qualquer validação.
- URL: modo estrito por padrão, qualquer que seja o `NODE_ENV`: só `https://`, host público, sem usuário/senha nem
  âncora. `http://localhost`/`127.0.0.1` só com `NODE_ENV=test` ou `WEBHOOK_ALLOW_LOCAL_TARGETS=true`.
- Hosts de demonstração (`hooks.x2win-crm.com`, `api.leadflow.app` e subdomínios) são recusados em destino novo ou
  com endereço trocado, assim como segredo novo `DEMO-hmac-*`. Destino de demonstração já gravado nunca recebe
  evento.
- Segredo: vazio ou **exatamente** a máscara da leitura mantém o gravado; outro texto com `***` ou `•` → 400
  (`details { id, field: 'secret' }`); segredo novo com pelo menos 8 caracteres; destino novo sem segredo ganha um
  gerado pelo servidor. Mudou a origem (esquema, host, porta) ou o evento com o segredo mantido → 400
  `O destino mudou: digite um novo segredo.` (`details { id, field: 'secret' }`).
- Mudou URL ou evento: as entregas pendentes daquele destino viram `falhou` (`Destino alterado`). Destino
  removido: as pendentes viram `falhou` (`Destino removido`) e ficam na fila sem destino.
- Auditoria `editar` em "Dados · Webhooks" com o que mudou (host e evento antes → depois e entregas canceladas).

### Execuções — `campanhas.webhooks.execucoes`
Leitura das 1000 mais recentes. A URL é gravada já mascarada.

### `POST /api/webhooks/destinations/:id/test` → `{ execution }`
Perm. `webhooks.editar`. Envia de verdade um POST assinado com o segredo do destino, com o evento próprio
`webhook.teste` (cabeçalho `x-x2w-event` e corpo `{ id, event: 'webhook.teste', createdAt, test: true,
data: { destinationId, destinationEvent } }`). A execução fica no evento do destino, com `test: true`. Auditoria
`testar`.

### `POST /api/webhooks/destinations/:id/reveal` → `{ url }`
Perm. `webhooks.editar`. URL completa do destino; 404 sem destino; 500 se não der para decifrar. Auditoria
`revelar` / `Webhook <evento>`. Quem edita já recebe a URL completa na leitura da chave: esta rota é o "Revelar" e o
"Copiar endereço completo" da ficha, que deixam registro de quem viu.

### Disparo
`enqueueWebhook` grava em `webhook_outbox` um item por destino ativo, dentro da transação da ação (hoje:
`saque.pago` na aprovação e `saque.rejeitado` na recusa). O laço processa a cada 2 s até 20 itens vencidos:
`POST` JSON `{ id, event, createdAt, data }` com `content-type: application/json`,
`user-agent: X2Win-Webhooks/1.0`, `x-x2w-event`, `x-x2w-delivery`, `x-x2w-timestamp` (segundos) e
`x-x2w-signature: sha256=<HMAC-SHA256(segredo, "<timestamp>.<corpo>")>`. 2xx = entregue; senão nova tentativa em
`30 s × 2^tentativas` (máx. 1 h); após 6 tentativas = `falhou`. Toda tentativa grava `webhook_executions`.
- Proteção contra SSRF: o nome é resolvido uma vez no DNS público (`resolve4`/`resolve6`, sem `/etc/hosts`), a
  conexão usa exatamente os endereços conferidos, endereço interno bloqueia o envio, redirecionamento não é
  seguido e um prazo único de 5 s cobre DNS, conexão, TLS e resposta.
- Mensagens de falha genéricas (`Falha de conexão com o destino.`, `Sem resposta do destino em 5 s.`,
  `O endereço do destino aponta para rede interna; envio bloqueado.`): o detalhe de rede fica só no log.

## Equipe — `equipe.membros` e `/api/team`
- Leitura `equipe.membros` (qualquer pessoa logada; versão e lista de uma foto só): `[{ id, name, email, roleId,
  status, twoFactor, lastAccess, lastIp, createdAt, activeSessions }]`. `lastIp` só para quem tem `equipe.ver`.
- Gravação por diferença (perm. `equipe.editar`), comparando por `id`. Aceita apenas `name`, `roleId` e `status`
  (`ativo` ↔ `desligado`). Incluir/remover pela chave → 403 `campo_nao_permitido`; outra mudança de status → 400;
  outros campos são ignorados.
- Regras (valem para a chave e para as rotas):
  - ninguém desativa a si mesmo, muda o próprio cargo nem redefine o próprio 2FA;
  - não pode deixar o sistema sem Superadmin ativo;
  - mexer em pessoa com cargo administrativo (`isAdminLevelRole`) exige `cargos.conceder`;
  - pôr alguém num cargo com permissão de governança (`isGovernedRole`) exige `cargos.conceder`: troca de cargo,
    criar acesso, convidar, reenviar convite e reativar (403 `sem_permissao`);
  - nome normalizado (NFKC, espaços colapsados), de 2 a 100 caracteres, só letras latinas, números, espaço, ponto,
    hífen e apóstrofo, começando com letra (senão 400); igual ou fácil de confundir com o de outra pessoa (em
    qualquer status) ou com rótulos da auditoria como `Sistema` → 409 `nome_em_uso`;
  - desativar encerra todas as sessões na hora e invalida convites pendentes.
- Rotas (todas exigem `equipe.editar`, menos o aceite do convite):
  - `POST /api/team/direct` `{ name, email, roleId }` → `{ member, temporaryPassword }` (pessoa ativa com troca de
    senha obrigatória). Pode responder 503 `servidor_ocupado`.
  - `POST /api/team/invite` `{ email, roleId, name? }` → `{ member, inviteUrl }` (status `convidado`, token de 72 h
    guardado com hash; link `<origem do painel>/#/convite?token=...`; sem nome, ele é montado a partir do e-mail).
  - `POST /api/team/:id/resend-invite` → `{ inviteUrl }` (invalida o anterior).
  - `POST /api/team/:id/deactivate` / `POST /api/team/:id/reactivate` (quem nunca definiu senha volta como
    convidado).
  - `POST /api/team/:id/role` `{ roleId }`.
  - `POST /api/team/:id/reset-2fa` → desliga o 2FA da pessoa e encerra as sessões.
  - `POST /api/team/invites/accept` `{ token, password }` → `{ ok: true }` (sem sessão; 10/min por IP; `name`
    enviado é ignorado: vale o nome registrado por quem convidou). Pode responder 503 `servidor_ocupado`; o convite
    continua válido.
- Gravação simultânea que se cruza no banco → 409 `versao_desatualizada` com `details.version`.

## Cargos — `cargos.lista`
- Leitura: qualquer pessoa logada (`Role[]`, teto em reais).
- Gravação por diferença (perm. `cargos.editar`):
  - Superadmin não muda, e o 2FA dele é sempre exigido (desligar → 400 com `details.field = 'require2fa'`).
  - Cargos do sistema não podem ser renomeados nem excluídos. Nome de 3 a 40 caracteres, sem repetir; até 100
    cargos.
  - Permissões novas precisam existir no catálogo (`PERMISSION_BY_KEY`); desconhecida → 400.
  - `approvalCeiling`: `null` (sem teto), `0` (não aprova) ou > 0.
  - Excluir cargo personalizado só sem pessoas ativas ou convidadas; as desligadas passam para o cargo do sistema
    mais restrito sem permissão de governança.
  - Governança: veja abaixo (403 `sem_permissao`).
  - Auditoria com o resumo do que mudou por cargo.
- **Subida da API** (`bootstrap`): cargos do sistema entram em toda subida (conflito de nome é pulado com aviso);
  os personalizados de exemplo (`adm`, `marketing`) só na instalação nova; o Superadmin sempre tem todas as
  permissões, sem teto, e `require_2fa` ligado (mudança auditada). Na instalação nova, o primeiro Superadmin vem de
  `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` (senha e nome validados; inválidos impedem a subida) e Superadmin,
  Administrador e Financeiro já nascem exigindo 2FA. Mudança feita na subida avança a versão de `cargos.lista`.

## Governança (`shared/permissions.ts`)
- **Permissões administrativas** (`ADMIN_LEVEL_PERMISSIONS`): `cargos.conceder`, `cargos.editar`, `equipe.editar`,
  `seguranca-painel.editar`, `mcp.editar`, `webhooks.editar`. Criar, alterar ou excluir cargo que tenha (antes ou
  depois) alguma delas, ou mexer em pessoa com esse cargo, exige `cargos.conceder`.
- **Permissões de governança** (`GOVERNED_PERMISSIONS`): as administrativas mais `saques.aprovar`,
  `afiliados-saques.aprovar`, `jogo-responsavel.editar` e `paises.editar`. Só quem tem `cargos.conceder`:
  dá ou tira alguma delas de um cargo; cria ou exclui cargo com alguma delas ou com teto ≠ 0; muda o teto de
  aprovação (`isGovernedChange`, teto comparado em centavos); põe alguém em cargo com alguma delas
  (`isGovernedRole`).
- Só o Superadmin tem `cargos.conceder` entre os cargos do sistema.

## Segurança do painel — `config.seguranca-painel`
- Formato: `{ allowlist: [{ id, value, label, createdAt, createdBy }], enforce2faForAll, sessionTimeoutMinutes }`.
- Leitura: quem vê Segurança do painel ou Equipe. Gravação com `seguranca-painel.editar`:
  - incluir, retirar ou trocar IPs/faixas exige também `cargos.conceder` (403); descrição, "2FA para todos" e tempo
    de inatividade não;
  - cada `value` é IPv4 ou faixa CIDR IPv4, sem repetir; até 100 itens; `label` ≤ 60; `createdAt`/`createdBy`
    são carimbados pelo servidor;
  - se a lista nova não for vazia e o IP de quem grava não estiver nela → 409 `bloquearia_voce`;
  - ligar "2FA para todos" sem ter 2FA → 400 (`details.field = 'enforce2faForAll'`): a própria sessão cairia;
  - `sessionTimeoutMinutes` entre 5 e 1440;
  - a lista nova vale na requisição seguinte; auditoria `editar` / `Segurança do painel`.
- **Recuperação de acesso** (lista que deixou todos de fora): `PANEL_ALLOWLIST_RESET=<valor novo>` no ambiente da
  API esvazia a lista na subida, uma vez por valor (só o hash do valor fica em
  `settings['config.seguranca-painel.recuperacao']`), com auditoria `desbloquear` por "Recuperação de acesso
  (servidor)". O login continua exigindo senha e 2FA. Depois, retire a variável e refaça a lista pelo painel.

## Estado do site — modo de ataque, manutenção e empresa
Chaves genéricas cuja auditoria é feita pelo servidor (o painel não relata estas entidades):
- `seguranca.modo-ataque`: valor objeto com `active` booleano (senão 400). Ao ligar, o servidor define `since`
  (agora) e `activatedBy` (quem gravou); ao desligar, os dois viram `null`; nas outras gravações ficam como estão
  gravados. O que o painel manda nesses campos é ignorado; a resposta traz os valores do servidor. Auditoria
  `ligar` | `desligar` | `editar` em `Modo de ataque`.
  - **Desligamento automático**: com `autoOffMinutes` > 0, o servidor confere a cada 30 s e, passado
    `since + autoOffMinutes`, grava `active: false` (`since` e `activatedBy` nulos; versão + 1) com auditoria
    `desligar` em `Modo de ataque` por "Sistema": `Desligado automaticamente após <tempo> (ligado por <nome>)`. Não
    depende de alguém com o painel aberto; o painel só relê a chave depois do prazo. Gravação feita sobre a versão
    anterior recebe 409 `versao_desatualizada`.
- `config.manutencao`: mesma regra, só com `since`. Auditoria em `Manutenção` (o resumo nunca traz o
  `bypassToken`). Leitura projetada para quem não vê a tela (veja "Projeções mínimas"). Link de testes
  (`bypassToken`) ausente, igual ao da demonstração (`teste-9f3a1c`, público no código do painel) ou fora de
  `[A-Za-z0-9_-]{20,200}` não é gravado: o servidor grava um novo, que volta na resposta. Sem nada gravado, o painel
  mostra a tela sem link e gera um (16 bytes aleatórios) na primeira gravação.
- `config.empresa`: auditoria `editar` em `Empresa e licença`.

## Configuração do servidor (ambiente)

| Variável | Padrão | Uso |
| --- | --- | --- |
| `NODE_ENV` | `production` | `development` \| `test` \| `production`. Esquecer a variável nunca afrouxa cookie nem webhooks |
| `PORT` / `HOST` | `3333` / `0.0.0.0` | |
| `DATABASE_URL` | `pglite://./data/pglite` | `postgres://…` (produção), `pglite://…` (arquivo) ou `memory://` (testes) |
| `APP_SECRET` | — | ≥ 32 caracteres. Chave dos HMAC (códigos de recuperação, freio do login): trocar invalida os códigos de recuperação |
| `ENCRYPTION_KEY` | — | 32 bytes em base64 (AES-256-GCM). Não há rotação automática |
| `CORS_ORIGIN` | vazio | origens do painel (vazio = mesma origem); a primeira também monta o link do convite |
| `COOKIE_SECURE` | `true` em produção | `false` com `NODE_ENV=production` impede a subida |
| `TRUST_PROXY` | `0` | proxies confiáveis à frente; com `COOKIE_SECURE`, exige HTTPS (`https_obrigatorio`) |
| `ADMIN_NAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `Superadmin` / — / — | primeiro Superadmin (só com a tabela de pessoas vazia) |
| `DEMO_DATA` | `false` | `npm run seed` grava os dados de demonstração |
| `WEBHOOK_ALLOW_LOCAL_TARGETS` | `false` | libera destino http/rede interna (só desenvolvimento); `true` com produção impede a subida |
| `WEBHOOK_DISPATCHER` | `on` | `off` desliga o envio em segundo plano (testes) |
| `PANEL_ALLOWLIST_RESET` | — | recuperação da lista de IPs na subida |
| `UV_THREADPOOL_SIZE` | 4 (16 na imagem Docker) | a fila de senhas usa metade dele, até 4 |

Valor inválido para uma variável impede a subida. Se a API não sobe, ela escreve
`[x2win] A API não subiu: <motivo>` no stderr e sai com código 1; `npm run migrate` escreve só a mensagem do erro e
sai com 1.

## Banco e migrações
- `server/src/db/migrations/index.ts`: `001_init` (tabelas), `002_audit_append_only` (gatilho que recusa
  `TRUNCATE` na auditoria, além de `UPDATE`/`DELETE` da 001; cria o papel `x2win_app` sem login se ele não existir
  e houver permissão), `003_ops_integrity` (gatilho `kv_history_no_change` nas linhas de histórico, índice da
  auditoria por origem, URL de webhook cifrada com `url_enc` e `host`, fila de webhooks com `ON DELETE SET NULL`).
- `npm run migrate` roda com o dono das tabelas: aplica as pendentes e, em toda execução, concede de novo os
  privilégios do papel de execução `x2win_app` (uso do schema, leitura e escrita nas tabelas de operação;
  `audit_log` só `SELECT` e `INSERT`; `schema_migrations` só `SELECT`). Sem o papel (ou sem acesso), aplica as
  migrações e sai com erro dizendo como criá-lo (`deploy/db-init/10-x2win-app-role.sh`).
- A API conecta com `x2win_app` (sem DDL; não apaga nem altera a auditoria). Ao subir, ela também aplica migrações
  pendentes (só funciona com o dono) e avisa no log se estiver conectada como dono ou superusuário. No PGlite
  (desenvolvimento) ela faz `SET ROLE x2win_app` depois das migrações.
- Tabela nova só de inclusão (ou só leitura): faça o `REVOKE` na migração que a cria **e** inclua-a em
  `RUNTIME_TABLE_LIMITS`; o passo de privilégios nunca alarga uma tabela em que o papel já tem algum privilégio.
- Chave com histórico que ganhar `pii`/`secrets` precisa de uma migração nova que recrie a função do gatilho
  (`kvHistoryImmutableSql`) e atualize `KV_HISTORY_ENCRYPTED_KEYS`.
- Banco de desenvolvimento ou teste que aplicou uma versão anterior (não publicada) da 003 fica com a função antiga
  do gatilho: recrie o banco ou rode `kvHistoryImmutableSql([])` uma vez com o dono das tabelas.

## Painel em modo API

Ligado com `VITE_API_MODE=1` (o Vite encaminha `/api` para `http://localhost:3333`). `isApiMode()`
(`src/lib/api.ts`) separa o que só existe com o servidor.

- **Login**: sem sessão, o painel mostra a tela de entrada; depois as etapas `password`, `enroll` (QR code +
  códigos de recuperação) e `2fa`. Convite: rota pública `#/convite?token=...`.
- **Dados**: `useDb`/`useCollection` buscam `GET /api/kv/:key` na primeira leitura (a tela espera com o esqueleto
  de carregamento). O painel nunca mostra os próprios dados de demonstração como se fossem do servidor: chave
  nunca gravada, sem permissão ou que falhou vira lista vazia (ou o padrão da configuração). Chave nunca gravada
  guarda a versão 0 e a primeira gravação a envia. Leitura que falhou deixa a chave só para leitura até carregar
  de novo. Gravações são otimistas com `PUT` + `version`; erro desfaz e mostra a mensagem; 409 recarrega a chave e
  avisa.
- **Ações de domínio**: aprovar/recusar saque, revelar PIX, pagar/recusar/revelar saque de afiliado, reconsultar
  depósitos, criar acesso/convidar, testar e revelar webhook usam as rotas próprias. `audit()` do painel vira
  `POST /api/audit/events`, só para os eventos que `panelAuditDecision` aceita (o resto o servidor já registra).
- **Modo demonstração** (sem `VITE_API_MODE`) continua igual: dados no navegador, sem login.
