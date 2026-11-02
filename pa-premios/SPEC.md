# SPEC — Plataforma de campanhas de sorteio "P.A PRÊMIOS"

**Versão:** 2.0 (consolidada) — 02/11/2026. Substitui integralmente a versão 1.0 colada no chat.

## 0. COMO TRABALHAR (leia antes de tudo)

- Você é engenheiro full-stack sênior. Prioridades, nesta ordem:
  1. Correção: nunca vender o mesmo número duas vezes
  2. Compliance e integridade do sorteio
  3. Conversão mobile
  4. Performance
- Antes de escrever código de aplicação: mantenha `PLAN.md` coerente com esta spec (arquitetura, schema Prisma, rotas, permissões, riscos, perguntas). Aguarde aprovação.
- Implemente por FASES (seção 17). Ao fim de cada fase: testes passando, lint e typecheck limpos, commit `feat(fase-N): ...`, resumo do que foi feito e do que falta. PARE e aguarde aprovação.
- Não invente regra de negócio. Se faltar algo: pergunte, ou deixe configurável com default conservador e registre em `DECISIONS.md`.
- Mantenha `CLAUDE.md` atualizado com comandos, convenções e decisões.
- Nenhum texto de marca, telefone ou link hardcoded: tudo vem de settings.
- A seção 19 registra decisões já tomadas. Não reabra sem motivo técnico.

## 1. CONTEXTO

Plataforma web de campanhas de sorteio com apuração pela Loteria Federal, de um único operador (P.A PRÊMIOS), autorizado por loteria estadual. Mobile-first: a maior parte do tráfego vem de Instagram e WhatsApp no celular. Público popular, cota de centavos, picos de tráfego após stories e perto do sorteio. Benchmark já feito (Rifa Digital, DFC Prêmios, SAMU MDS). Não copie código nem layout de terceiros; os requisitos abaixo já consolidam o que adotar.

## 2. STACK E INFRAESTRUTURA

- Next.js 15 (App Router) + TypeScript strict + pnpm
- Hospedagem: Vercel Pro
- Banco: Supabase Postgres 16, região São Paulo
  - Aplicação conecta pelo pooler em modo transação. Toda trava usada pelo motor de números deve ser presa à transação (nada de advisory lock de sessão). Validar e documentar em DECISIONS.md.
  - Migrations e tarefas longas usam a conexão direta.
  - pg_cron para tarefas executadas dentro do banco (seção 6.3).
- ORM: Prisma
- Storage: Supabase Storage, bucket PRIVADO para documentos de ganhadores (URLs assinadas de curta duração, acesso registrado no audit log)
- Redis: Upstash (rate limit e cache)
- UI: Tailwind + shadcn/ui
- Zod em todas as bordas (API, forms, webhooks, env)
- Auth.js somente para o admin: e-mail + senha (argon2) + TOTP 2FA obrigatório
- E-mail transacional: Resend (adapter com mock no dev)
- Jobs da aplicação: Vercel Cron (1 min) chamando rotas protegidas por segredo
- Testes: Vitest (unit + integração com Postgres real via Docker) e Playwright (E2E em viewport 390x844)
- Docker Compose para dev (postgres, redis, mailpit)
- Sentry para erros
- Variável APP_ENV: development | staging | production

## 3. CONFIGURAÇÕES GLOBAIS (tabela settings, editável no admin)

- brand_name: "P.A PRÊMIOS"
- logo, cores primária e secundária
- support_whatsapp: 5598981729418 → botão flutuante "Suporte" (wa.me com mensagem pré-preenchida "Olá! Preciso de ajuda com minha compra na {brand_name}"). No mobile, botões flutuantes NÃO podem cobrir conteúdo nem a barra fixa de compra.
- whatsapp_group_url_default: grupo pós-compra (pode ser sobrescrito por campanha)
- timezone: America/Fortaleza
- Dados legais do operador: razão social, CNPJ, endereço, e-mail do SAC, encarregado LGPD (nome + e-mail). Exibidos no rodapé de TODAS as páginas. Podem ficar vazios em development/staging; em production a publicação exige todos preenchidos (seção 12.3).
- show_authorization_badge: false (default).
  - true: exibe o selo de autorização na campanha (seção 4.2, item 3) e os dados completos da autorização no item 2 do regulamento.
  - false: selo oculto; o item 2 do regulamento diz apenas "Documentação da autorização disponível mediante solicitação pelo e-mail {sac_email}".
  - O cadastro interno da autorização é obrigatório para publicar em production, independentemente desta flag.
- Modalidades (lista configurável): nome, órgão, flag allows_cash_prize.
- Territorialidade (seção 13A):
  - authorized_state: UF da autorização (ex.: "MA")
  - territorial_rule: PHYSICAL_LOCATION | DOMICILE | PHYSICAL_OR_DOMICILE (default PHYSICAL_LOCATION)
  - geo_enforcement: on/off (sempre on em production; não pode ser desligado com APP_ENV=production)
- Banner antigolpe (ligado por padrão, texto editável): "Nunca pedimos PIX, senha ou código para liberar prêmio. Único canal oficial: {support}."
- Em staging: faixa fixa no topo "AMBIENTE DE HOMOLOGAÇÃO".

## 4. PÁGINAS PÚBLICAS

### 4.1 Home `/`

1. Hero da campanha principal com compra rápida (reusa o componente de compra)
2. Campanhas: abas Ativas / Encerradas
3. Ganhadores recentes (nome mascarado, prêmio, número, data, link do resultado)
4. Rodapé legal

### 4.2 Campanha `/c/[slug]` (ordem dos blocos no mobile)

1. Galeria (até 8 imagens + 1 vídeo opcional)
2. Título completo (nunca truncar) + selo de status
3. Selo de autorização: "{modalidade} — Autorização nº {numero}" + link. Exibido somente se show_authorization_badge = true.
4. Aviso territorial (sempre visível): "Venda permitida apenas para pessoas localizadas em {UF}." (texto ajustado conforme territorial_rule)
5. Preço da cota, total de cotas, data do sorteio, nº do concurso da Loteria Federal (quando definido)
6. Barra de progresso + nota de transparência (seção 8)
7. Seletor de quantidade: botões ADITIVOS configuráveis por campanha (default +50, +100 com selo "Mais popular", +200, +500), campo editável com − e +, aviso inline de mínimo e máximo com o motivo ("Compra mínima: R$ 7,00")
8. Barra fixa inferior: quantidade, total em R$ e CTA "Quero participar"
9. Ranking (seção 9)
10. Cotas premiadas (seção 10, feature flag)
11. Regulamento em acordeão (Markdown sanitizado e RENDERIZADO, nunca cru) + link para o PDF da versão vigente
12. Compartilhar (WhatsApp, Telegram, Facebook, copiar link) e "Meus números"

- Campanha com vendas pausadas: aviso no topo e CTA desabilitado.

### 4.3 Meus números `/meus-numeros`

- Consulta por CPF + data de nascimento (MVP). Backlog: OTP no WhatsApp.
- Rate limit: 5 tentativas a cada 15 min por IP e por CPF.
- Mostra pedidos, status e números (paginado; download CSV dos números).

### 4.4 Resultados `/resultados` e `/c/[slug]/resultado` (seção 11)

### 4.5 Termos de uso, Política de privacidade, FAQ

Conteúdo editável no admin (o jurídico fornece o texto). Seed com placeholders no padrão [PREENCHER: …].

## 5. CHECKOUT (bottom sheet no mobile)

**Passo 0 — Localização** (seção 13A). Sem validação aprovada, o checkout não avança.

**Passo 1 — CPF.** Validação de dígitos verificadores.

- CPF já cadastrado: mostrar só "Olá, J***** V." e telefone mascarado "(99) *****-3568" para confirmação. NUNCA exibir nome completo, e-mail ou telefone completos a partir de um CPF digitado.
- CPF bloqueado no admin: mensagem genérica e orientação para o suporte.

**Passo 2 — Dados** (CPF novo ou cadastro incompleto). Todos obrigatórios:

- Nome completo
- E-mail
- Celular com seletor de DDI (+55 padrão) + campo de confirmação
- Data de nascimento → bloquear menores de 18 com mensagem clara
- CEP: somente se territorial_rule aceitar domicílio

Checkboxes:

- [obrigatório] "Li e aceito o regulamento (versão N) e os termos de uso"
- [obrigatório] "Declaro ter 18 anos ou mais"
- [opcional, DESMARCADO] "Quero receber novidades e convite para o grupo VIP" (consentimento de marketing, revogável)

Registrar no aceite: versão e hash do regulamento, timestamp, IP, user agent.

**Passo 3 — Ofertas especiais (order bump)**

- Até 2 por campanha: "Deseja +X cotas por R$ Y?" com imagem do prêmio e "Economize R$ Z".
- Validação no admin: Y < X × preço da cota. Bloquear salvar se não for desconto real.

**Passo 4 — Concluir reserva**

- Revalida a localização (seção 13A).
- Cria o pedido e aloca os números (seção 6).
- Tela PIX: QR code, copia-e-cola, valor, timer de expiração (default 15 min, configurável), status por polling de 3s ou SSE.

**Passo 5 — Confirmação (após pagamento)**

- Lista de números (até 200 visíveis + "ver todos/baixar")
- Cotas premiadas encontradas, se houver
- Botão grande "Entrar no grupo do WhatsApp" (link da campanha ou global)
- Compartilhar
- E-mail de confirmação com os números

**Limites**

- Mínimo por pedido em R$ (min_order_value). Cotas mínimas = ceil(min_order_value / preço). Ex.: R$ 7,00 / R$ 0,06 = 117 cotas (R$ 7,02).
- Máximo de cotas por pedido (max_per_order) e por CPF por campanha (max_per_cpf), configuráveis.
- No máximo 1 reserva pendente por CPF por campanha (garantido também por índice único parcial no banco).

**Pagamento tardio** (chega depois da expiração): realocar novos números se houver estoque; se não houver, marcar o pedido para reembolso e alertar o admin.

## 6. MOTOR DE NÚMEROS (crítico)

### 6.1 Interface

- Todo acesso ao estoque passa pela interface `NumberAllocator` (allocate, release, confirm, blockHouse, releaseHouse, stats).
- Motivo: o edital da loteria pode impor numeração externa ou sistema certificado. A troca de implementação não pode afetar o resto da app.

### 6.2 Implementação padrão (Postgres)

- Universo: 0 a total−1, exibido com zeros à esquerda (6 dígitos para 1.000.000).
- Tabela `tickets(campaign_id, number, shuffle_rank, status [available|reserved|paid|house], order_id, reserved_until)`, índice em (campaign_id, status, shuffle_rank).
- Alocação aleatória: em transação curta, `SELECT ... WHERE status='available' ORDER BY shuffle_rank LIMIT :qty FOR UPDATE SKIP LOCKED` e depois UPDATE.
- Pagamento confirmado → paid. Expirado → available (job a cada minuto + verificação lazy na leitura).
- Contadores (pagos, reservados, casa, disponíveis) divididos em 16 partes (sharded counters), atualizados na mesma transação da alocação. A leitura soma as partes. Página pública nunca roda COUNT(*).

### 6.3 Geração do pool (assíncrona, dentro do banco)

- Estados da campanha incluem `gerando_numeros` entre rascunho e publicada.
- Ao publicar, a rota apenas registra um pedido de geração e muda a campanha para `gerando_numeros`. Não espera o término.
- Uma rotina no Postgres (pg_cron) processa os pedidos pendentes com `INSERT ... SELECT generate_series(...)` e `random()` para o shuffle_rank, cria os contadores e muda a campanha para publicada (ATIVA) ao terminar.
- Falha na geração: campanha volta para rascunho, erro registrado e alerta ao admin. Geração idempotente (pode ser repetida sem duplicar).
- Admin mostra o status da geração.

### 6.4 Metas

- Alocar 20.000 números em < 2s.
- 200 reservas concorrentes sem nenhum número duplicado.
- 50 reservas/s sustentadas (seção 14).

## 7. PAGAMENTO

- Interface `PaymentProvider { createPixCharge, getCharge, refund, verifyWebhook }`.
- MockProvider no dev e até a F4, com botão "simular pagamento".
- Provider real só na F5, depois de aceite por escrito da atividade pelo provedor (prever adapters para Efí, Asaas e Mercado Pago).
- Webhook: assinatura validada, idempotente (event id único), valor e txid conferidos. Nunca confiar no front.
- Reconciliação: job a cada 5 min consulta cobranças pendentes no provider.

## 8. BARRA DE PROGRESSO E COTAS DA CASA

### 8.1 Cálculo

- Percentual exibido = (cotas pagas + cotas da casa) / total.
- Rótulo: "X% esgotado" ou "Restam Y cotas". NUNCA usar a palavra "vendido".
- Não existe campo para digitar o percentual. O percentual só muda quando o estoque muda.

### 8.2 Cotas da casa (controle editável no admin)

- Controle tipo slider "Progresso alvo (%)". Ao salvar, o sistema:
  1. Calcula quantas cotas precisa bloquear para atingir o alvo.
  2. Mostra uma prévia: "Serão bloqueadas N cotas (P% do total). Receita máxima cai de R$ A para R$ B." Exige confirmação.
  3. Executa o bloqueio pelo NumberAllocator, de forma assíncrona, em lotes de 10.000 cotas por transação (FOR UPDATE SKIP LOCKED), com barra de progresso no admin e botão para cancelar a operação.
- Reduzir o alvo devolve cotas da casa ao estoque (status available), com o mesmo processo em lotes.
- Também permitir bloquear por quantidade exata, além do slider.
- Toda alteração vai para o audit log (quem, quando, antes, depois, cancelamentos).
- Limites: o alvo não pode ultrapassar 95% nem impedir a venda do mínimo por pedido.

### 8.3 Regras de integridade (obrigatórias, também no banco)

- Cotas da casa NÃO concorrem a nenhum prêmio: principal, cotas premiadas ou ranking.
- Na apuração, se o número sorteado for da casa, aplica-se a regra de aproximação até o próximo número PAGO por participante. A página de resultado mostra esse passo.
- Cotas premiadas (seção 10) nunca podem ser alocadas como cota da casa (constraint no banco).
- Ranking, "últimos compradores" e relatórios públicos nunca incluem a casa.
- Relatórios internos separam: vendidas, casa, reservadas, disponíveis.

### 8.4 Regulamento

- Se a campanha tiver cotas da casa, inserir automaticamente a cláusula: "O promotor pode reservar parte dos números, que não serão vendidos e não concorrem a prêmios. Caso um número reservado seja sorteado, será contemplado o próximo número pago por participante, conforme o item 5."

### 8.5 Exibição

- Config por campanha: exibir sim/não; exibir só a partir de X%; arredondamento para baixo (1, 5 ou 10%); exibir % e/ou cotas restantes.
- Nota de transparência ao lado da barra: configurável, LIGADA por padrão sempre que houver cotas da casa. Texto default editável: "Inclui números reservados pela organização, que não concorrem a prêmios."
- Mensagens automáticas por marco (textos editáveis): 25, 50, 75 e 90% ("Já passamos de 50% esgotado! 🔥"). Acima de 90%: "Últimas cotas!".
- Cache de 30s.

## 9. RANKING

- Top 1 geral da campanha + Top 3 do dia (dia em America/Fortaleza, zera às 00:00).
- Base: cotas PAGAS por participantes (casa excluída). Desempate: quem atingiu o total primeiro.
- Exibição: posição, nome mascarado ("Jamilson V."), quantidade de cotas. Nunca CPF ou telefone.
- Prêmio de ranking: opcional por campanha. Só pode ser ativado se o regulamento descrever o prêmio e a regra.
- Cache de 60s.

## 10. COTAS PREMIADAS (feature flag, DESLIGADA por padrão)

- Admin define números e prêmios antes de publicar. Após publicar, a lista fica congelada.
- Números exibidos publicamente com status "Disponível" ou "Ganho por Fulano X.".
- Ao pagar, se algum número do pedido for premiado: registrar ganhador, abrir o fluxo da seção 12.6, notificar o admin, exibir na confirmação.
- Números premiados nunca podem virar cota da casa.
- Só pode ser ativado se o regulamento prever.

## 11. APURAÇÃO E RESULTADOS

- Campanha tem: data do sorteio, nº do concurso da Loteria Federal e regra de apuração (enum):
  - DEFAULT_6 (escopo atual): 3 últimos algarismos do 1º prêmio + 3 últimos algarismos do 2º prêmio. Universo de 1.000.000. Teste: concurso 6111 (1º 68003, 2º 33062) → 003062.
  - DEFAULT_7 (BACKLOG, não implementar agora): 3 últimos algarismos do 1º prêmio + 3 últimos do 2º prêmio + algarismo central (3º de 5) do 3º prêmio, como último dígito. Universo de 10.000.000. Teste: concurso 6111 (68003, 33062, 34756) → 0030627.
- Admin digita os 5 prêmios do concurso duas vezes (dupla digitação). O sistema calcula e mostra o passo a passo.
- Número não vendido OU cota da casa: vale o próximo número PAGO por participante imediatamente superior; ao passar do último, volta ao primeiro (circular). Regra definida antes da publicação e escrita no regulamento.
- Extração adiada ou cancelada: vale a próxima extração (regra do regulamento).
- Página de resultado: concurso, data, prêmios da Loteria, cálculo passo a passo, número sorteado, número contemplado (com explicação se houve aproximação), ganhador mascarado + cidade/UF (preenchidas na seção 12.6), link para o resultado oficial da Caixa, vídeo de entrega opcional.
- Após a apuração, a campanha fica imutável. Toda ação vai para o audit log.

## 12. ADMIN `/admin`

### 12.1 Acesso

- Papéis: owner, operador, financeiro, suporte. Permissões por módulo e ação (ver, editar, exportar, aprovar).
- 2FA TOTP obrigatório. Sessão expira em 8h. Toda ação sensível pede reconfirmação de senha (reembolso, exportação, cotas da casa, apuração, pausar vendas, revelar dados).
- Layout responsivo: Dashboard, Pedidos, Participante e Ganhadores totalmente usáveis no celular (390px).

### 12.2 Dashboard

- Por campanha e geral: receita, cotas pagas, cotas da casa, reservadas, disponíveis, ticket médio, conversão reserva→pago, pedidos pendentes.
- Gráfico de vendas por hora (hoje vs ontem).
- Top compradores (geral e do dia).
- Bloqueios por localização (volume e UF de origem).
- Alertas ativos (seção 12.10).

### 12.3 Campanhas

- Lista com filtros por estado. Criar e duplicar.
- Estados: rascunho → gerando_numeros → publicada ↔ vendas pausadas → vendas encerradas → apurada → finalizada.
- Abas da campanha:
  1. Dados: título, slug, galeria, descrição, preço, total, mínimo em R$, max_per_order, max_per_cpf, prazo de reserva, botões de quantidade, grupo de WhatsApp, data do sorteio, concurso, regra de apuração, regra de número não vendido, opção em dinheiro (cash_option_enabled + cash_value, só se a modalidade tiver allows_cash_prize = true).
  2. Autorização (cadastro interno): CNPJ do promotor, modalidade, órgão, nº e vigência, documento anexado (storage privado).
  3. Regulamento: editor Markdown com template, preview, versões, PDF, hash.
  4. Cotas da casa: seção 8.2.
  5. Ofertas (order bump): seção 5, passo 3.
  6. Cotas premiadas: seção 10.
  7. Ranking: exibir sim/não, prêmio opcional.
  8. Progresso: configurações da seção 8.5.
  9. Apuração: seção 11.
- Publicação em production BLOQUEADA sem: dados legais do operador, CNPJ do promotor, modalidade, órgão, nº e vigência da autorização, regulamento sem nenhum marcador [PREENCHER: …], data do sorteio, regras de apuração e de número não vendido, authorized_state configurado. A trava procura o padrão `[PREENCHER:` em regulamento, termos e política.
- Em development/staging: publicação permitida com aviso visível das pendências.
- Botão PAUSAR VENDAS (owner e operador): bloqueia novas reservas na hora, mantém o pagamento das reservas já criadas, mostra aviso na página pública e exige motivo (audit log). Retomar exige o mesmo.
- Travas pós-venda (também no banco): preço, total, mínimo e regra de apuração. Regulamento só por errata versionada.

### 12.4 Pedidos

- Busca por CPF, nome, telefone, e-mail, nº do pedido, txid ou número da cota.
- Filtros: status, campanha, período, valor.
- Detalhe: itens, números, PIX (txid, valor, horários), geolocalização, aceite (versão, IP, horário), histórico de status.
- Ações: reenviar e-mail, cancelar reserva pendente, reembolso (motivo + comprovante, aprovação do financeiro).

### 12.5 Participante (visão 360)

- Dados mascarados por padrão; botão "revelar" registra no audit log.
- Todos os pedidos e números em todas as campanhas, total gasto, aceites, consentimento de marketing, registros de geolocalização, sinais de fraude.
- Ações: bloquear CPF (com motivo), revogar consentimento, exportar dados do titular (pedido LGPD), anonimizar (respeitando a retenção legal).

### 12.6 Ganhadores e entrega

Fluxo por ganhador (prêmio principal, cota premiada e ranking): contatado → documentos recebidos → documentos validados → escolha do prêmio (bem ou dinheiro, se habilitado) → IR calculado/recolhido → entregue/pago → comprovante anexado → concluído.

- Upload de documentos (RG, CPF, comprovante de residência) no bucket privado, com acesso registrado.
- Na etapa "documentos validados", o admin preenche cidade e UF do ganhador. A UF da geolocalização do pedido vem como valor sugerido.
- Registro do IR: base, alíquota, valor, data do recolhimento, guia anexada.
- Prazo de reclamação com contagem regressiva e alerta.
- Publicação na página de resultados só após "entregue" (opcional: vídeo de entrega).

### 12.7 Financeiro

- Conciliação pedidos x provider: pagos sem pedido, pedidos sem pagamento, valor divergente, pagamento tardio.
- Reembolsos pendentes e concluídos.
- Fechamento por campanha: receita bruta, taxas do gateway, prêmios, IR, resultado.
- Exportação CSV/XLSX.

### 12.8 Relatórios e exportações

- Por campanha: vendas, participantes, números, ganhadores, apuração, geolocalização, bloqueios.
- Modelo de exportação configurável para prestação de contas à loteria.
- Toda exportação registrada (quem, quando, filtro).

### 12.9 Antifraude

- Sinais: mesmo telefone, e-mail, IP ou dispositivo em vários CPFs; muitas reservas expiradas; divergência GPS x IP; picos de compra de um CPF.
- Fila de revisão com ações: liberar, bloquear CPF, cancelar pedido pendente.

### 12.10 Alertas (no painel + e-mail/WhatsApp para a equipe)

- Pagamento divergente ou webhook falhando.
- Cota premiada encontrada.
- Venda parada (sem pagamento por X minutos em horário de pico, configurável).
- Pico de bloqueios geográficos.
- Prazo de reclamação de prêmio perto do fim.
- Erro no job de expiração, reconciliação ou geração do pool.

### 12.11 Templates de mensagens

- Textos editáveis com variáveis reais: {campanha}, {percentual_esgotado}, {cotas_restantes}, {top_dia}, {link}, {data_sorteio}.
- Botão "copiar" para colar no grupo de WhatsApp ou nos stories.
- Variáveis sempre preenchidas com dados reais (seção 8).

### 12.12 Configurações

- Globais (seção 3), modalidades, territorialidade, termos de uso, política de privacidade, FAQ, usuários e papéis.

### 12.13 Audit log

- Append-only, sem edição nem exclusão (garantido no banco). Filtros por usuário, ação, campanha e período. Exportável.

## 13. SEGURANÇA, LGPD E JOGO RESPONSÁVEL

- Páginas públicas nunca exibem CPF, e-mail ou telefone completos. Nomes sempre como "Primeiro nome + inicial".
- CPF criptografado em repouso + hash para busca.
- Logs sem PII.
- Rate limit em reservas, consultas e login. Honeypot nos formulários. Bloqueio de CPF no admin.
- Headers de segurança, CSRF, Markdown sanitizado.
- Consentimento de marketing separado e revogável.
- Retenção de dados configurável.
- Aviso fixo "Proibido para menores de 18 anos. Participe com responsabilidade."

## 13A. TERRITORIALIDADE E GEOLOCALIZAÇÃO (obrigatório em production)

**Regra.** Venda permitida somente a quem atende territorial_rule em relação ao authorized_state (seção 3).

**Checkout**

- Passo 0, antes do CPF: solicitar localização pelo navegador (Geolocation API, alta precisão).
- Validar as coordenadas contra o polígono oficial da UF (GeoJSON do IBGE versionado no repo; point-in-polygon no servidor, nunca só no front).
- Sinal secundário: geolocalização por IP. Divergência forte entre GPS e IP (ex.: outra UF distante) → bloquear e registrar.
- Se territorial_rule aceitar domicílio: pedir CEP e validar a UF via consulta de CEP.
- Permissão negada ou fora da UF: bloquear a compra com mensagem clara ("Esta campanha só pode ser adquirida por pessoas localizadas em {UF}"). Nunca liberar a compra sem validação.
- Revalidar a localização no passo 4 (reserva), não só no início.

**Registro (prova de compliance)**

- Por pedido: latitude, longitude, precisão, resultado da validação, UF por IP, timestamp.
- Finalidade LGPD: cumprimento de obrigação legal. Retenção conforme o termo de autorização. Informar na Política de Privacidade.

**Admin**

- Relatório de bloqueios por localização (volume, UF de origem).
- Exportação dos registros de geolocalização para fiscalização.

## 14. PERFORMANCE

- Página de campanha e dados vivos (progresso, ranking) em cache de CDN por 30–60s. O banco recebe essencialmente as reservas.
- Meta: 300 req/s na página de campanha e 50 reservas/s sem erro (teste com k6 na fase 5).
- LCP < 2,5s em 4G no mobile.

## 15. TESTES OBRIGATÓRIOS (além dos critérios de cada fase)

- 200 reservas concorrentes sem número duplicado.
- Índice único impede 2 reservas pendentes do mesmo CPF na mesma campanha.
- Geração do pool idempotente; falha devolve a campanha para rascunho.
- Cotas da casa: alvo de 50% bloqueia exatamente a quantidade calculada, em lotes, sem colidir com reservas em andamento; cancelamento no meio deixa estado consistente.
- Número da casa sorteado → aproximação para o próximo número pago.
- Número não vendido sorteado → aproximação circular.
- Cota da casa nunca aparece em ranking nem como cota premiada.
- Apuração DEFAULT_6 com o concurso 6111 → 003062.
- Ranking do dia zera às 00:00 de America/Fortaleza.
- Order bump acima do preço linear é rejeitado.
- Menor de 18 bloqueado no checkout.
- Digitar um CPF existente nunca expõe nome completo, e-mail ou telefone.
- Geolocalização: dentro da UF permite; fora bloqueia; permissão negada bloqueia; GPS na UF + IP de UF distante bloqueia e registra; localização alterada entre passo 0 e passo 4 bloqueia.
- Publicação em production bloqueada com qualquer marcador [PREENCHER: …].
- Travas pós-venda e audit log não podem ser burlados por SQL da aplicação.

## 16. SEED

- Usuário owner do admin.
- Modalidade "Loteria estadual — [PREENCHER: órgão]" com allows_cash_prize = true.
- authorized_state: "MA" (confirmar com o termo de autorização).
- Campanha exemplo (rascunho): "iPhone 18 Pro Max Bordô 256GB", cota R$ 0,06, 1.000.000 de cotas, mínimo R$ 7,00, max_per_order 20.000, max_per_cpf 20.000, prazo de reserva 15 min, sorteio 18/11/2026, regra DEFAULT_6, opção em dinheiro R$ 8.000 (cash_option_enabled = true), order bumps desligados, cotas premiadas desligadas, cotas da casa em 0.
- Regulamento modelo. Todo marcador no padrão [PREENCHER: …] bloqueia a publicação em production. Variáveis entre chaves são preenchidas pelo sistema.

```
REGULAMENTO — {titulo}

1. PROMOTOR: [PREENCHER: razão social], CNPJ [PREENCHER: CNPJ], [PREENCHER: endereço completo].
2. AUTORIZAÇÃO: {SE show_authorization_badge = true: "Loteria estadual — {orgao_autorizador}, termo nº {numero_autorizacao}, vigência {vigencia_autorizacao}."} {SE show_authorization_badge = false: "Documentação da autorização disponível mediante solicitação pelo e-mail {sac_email}."} Participação permitida somente a pessoas {texto_territorial} do Estado de {authorized_state_nome}, verificado por geolocalização no momento da compra.
3. PRÊMIO: {descricao}. Valor da cota: R$ {preco}. Total: {total} números ({min_number} a {max_number}). 1 ganhador. {SE cash_option_enabled: "O ganhador poderá optar por R$ {cash_value} via PIX em conta de sua titularidade."}
4. PARTICIPAÇÃO: maiores de 18 anos, com CPF válido. Compra mínima de R$ {min_order_value}. Limite de {max_per_cpf} cotas por CPF nesta campanha. Compras somente pelos canais oficiais.
5. APURAÇÃO: Loteria Federal, concurso nº {concurso} de {data_sorteio}. Número contemplado = 3 últimos algarismos do 1º prêmio + 3 últimos algarismos do 2º prêmio. Exemplo: 1º prêmio 68003 e 2º prêmio 33062 → 003062. Se o número não tiver sido vendido e pago a um participante, será contemplado o próximo número pago imediatamente superior; após o último número, a contagem recomeça do primeiro. Se a extração for adiada ou cancelada, vale a extração seguinte. {SE houver cotas da casa: cláusula da seção 8.4}
6. ENTREGA: em até [PREENCHER: número] dias úteis após a validação dos documentos. São Luís/MA: entrega presencial. Demais localidades: Correios, frete por conta do promotor.
7. RECLAMAÇÃO DO PRÊMIO: prazo de [PREENCHER: número] dias com documento de identidade e CPF. Destino do prêmio não reclamado: [PREENCHER: regra conforme a modalidade].
8. CANCELAMENTO E REEMBOLSO: [PREENCHER: campanha cancelada, pagamento em duplicidade, direito de arrependimento conforme a legislação aplicável].
9. TRIBUTOS: [PREENCHER: responsabilidade pelo IR sobre o prêmio].
10. DADOS PESSOAIS: tratados conforme a Política de Privacidade. Encarregado: [PREENCHER: nome e e-mail do encarregado].
11. DISPOSIÇÕES GERAIS: ao participar, o comprador declara ter lido e aceito este regulamento. Proibido para menores de 18 anos.
```

## 17. FASES E CRITÉRIOS DE ACEITE

**F0 — Setup:** repositório pa-premios, Docker Compose, Prisma, Supabase (local e projeto SP), CI (lint, typecheck, test), CLAUDE.md, PLAN.md, DECISIONS.md, APP_ENV, pg_cron habilitado.
Aceite: `pnpm dev` sobe e o CI está verde.

**F1 — Núcleo de venda:** página da campanha, seletor, geolocalização, checkout completo (CPF, dados, e-mail, aceites, 18+), NumberAllocator, geração do pool via pg_cron, PIX mock, expiração, confirmação, e-mail, botão do grupo de WhatsApp, botão de suporte, banner antigolpe, Meus números.
Aceite:
- E2E mobile de compra completa
- Testes da seção 15 sobre concorrência, pool, limites, 18+, CPF e geolocalização

**F2 — Admin:** seção 12 completa.
Aceite:
- Publicação bloqueada em production com pendências; permitida em staging com aviso
- Pausar vendas bloqueia novas reservas em < 5s e registra o motivo
- Fluxo do ganhador completo até "concluído", com documentos e IR
- Revelar dado de participante gera registro no audit log
- Dashboard, Pedidos, Participante e Ganhadores usáveis em 390px
- Travas pós-venda funcionando
- Opção em dinheiro não liga em modalidade sem allows_cash_prize

**F3 — Conversão:** barra de progresso com cotas da casa (seção 8), nota de transparência, ranking geral e do dia, order bump com validação, compartilhamento, templates de mensagens.
Aceite: testes da seção 15 sobre cotas da casa, ranking e order bump.

**F4 — Apuração e resultados:** entrada do concurso, cálculo DEFAULT_6, aproximação (não vendido e casa), página de resultado, ganhadores.
Aceite: testes da seção 15 sobre apuração.

**F5 — Produção:** provider PIX real (com aceite formal), webhooks, reconciliação, rate limit, Sentry, backups, teste de carga k6.
Aceite: metas da seção 14 atingidas.

## 18. FORA DE ESCOPO AGORA

Escolha manual de números (grade), DEFAULT_7, OTP no WhatsApp, afiliados, roleta, raspadinha, caixa surpresa, app nativo, white-label para outros operadores.

## 19. DECISÕES JÁ TOMADAS

1. Repositório: privado `pa-premios`, com SPEC.md, PLAN.md e DECISIONS.md na raiz.
2. Modalidade: loteria estadual autorizada, prêmio em dinheiro permitido. A plataforma numera os títulos via NumberAllocator (implementação trocável se o edital exigir).
3. PIX: MockProvider até a F4. Provider real na F5, somente com aceite formal da atividade.
4. Infra: Vercel Pro + Supabase SP (pooler em modo transação, pg_cron, storage privado) + Upstash.
5. Contadores divididos em 16 partes.
6. Cache de CDN de 30–60s para página e dados vivos.
7. Regras críticas também no banco: cota premiada ≠ casa, travas pós-venda, audit log append-only, 1 reserva pendente por CPF.
8. Geração do pool assíncrona via pg_cron.
9. Cotas da casa em lotes de 10.000, assíncronas, canceláveis.
10. Nota de transparência das cotas da casa ligada por padrão.
11. Selo de autorização oculto por padrão (show_authorization_badge); cadastro interno obrigatório para publicar em production.
12. Placeholders no padrão [PREENCHER: …]; variáveis {max_number} e {max_per_cpf} separadas.
13. DEFAULT_7 no backlog.
