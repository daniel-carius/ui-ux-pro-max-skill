# Especificação funcional — Backoffice X2Win (Evox)

Oct 8, 2026 · @Daniel

Este documento descreve as 73 telas do backoffice e as regras de negócio que a recriação precisa reproduzir.

## Visão geral

O backoffice administra a operação X2Win, uma plataforma de cassino e apostas esportivas. São 73 telas em 10 módulos, usadas por superadministradores e por equipes com cargos restritos.

| Módulo | Telas | Função principal |
| --- | --- | --- |
| Geral | 4 | Painel de indicadores, jogadores, rankings e transações |
| Operação | 2 | Fila de saques e depósitos |
| Esportes | 1 | Apostas esportivas |
| Cassino | 4 | Catálogo de jogos, provedoras, vitrines e agregadores |
| Crescimento | 5 | GGR, afiliados, indicados, links e comissões |
| Programa de afiliados | 4 | Gerentes, comissões e saques de afiliados |
| Campanhas | 21 | Promoções, bônus, missões, disparos e jornadas |
| Personalização | 11 | Tema, home, banners, menus, rodapé e SEO |
| Segurança | 2 | Anti-fraude e modo de ataque |
| Configurações | 19 | Empresa, KYC, pagamentos, e-mail, equipe e auditoria |

A interface é em português (pt-BR), com moeda em reais (R$) e datas no formato dia/mês/ano. A navegação fica numa barra lateral com 10 grupos recolhíveis. A busca de páginas lista as 73 telas e serve de mapa rápido do sistema.

## Perfis e permissões

O acesso ao painel é definido por cargo. A operação tem 7 cargos e 5 pessoas na equipe. O cargo também define até quanto a pessoa pode aprovar em saques.

| Cargo | Permissões | Membros | 2FA | Teto de aprovação de saque |
| --- | --- | --- | --- | --- |
| Superadmin (sistema) | Acesso total, inclui conceder e retirar cargos | 1 | Opcional | Sem teto |
| Administrador (sistema) | Acesso total à operação | 0 | Opcional | Sem teto |
| Financeiro (sistema) | Depósitos, saques e gateways em leitura | 0 | Opcional | R$ 5.000,00 |
| Marketing oficial (sistema) | Campanhas, disparos, jornadas, torneios e personalização (21 permissões) | 1 | Exigido | Não aprova saques |
| Suporte (sistema) | Ficha do jogador, etiquetas e consulta de depósitos e saques | 0 | Opcional | Não aprova saques |
| ADM | 28 permissões | 2 | Opcional | Não aprova saques |
| marketing | 10 permissões | 1 | Opcional | Não aprova saques |

A tela de cargos mostra, para cada cargo, o que ele pode ver, editar e aprovar. O cargo Superadmin é o único que pode conceder e retirar outros cargos administrativos.

Regras e telas de acesso:

- Equipe: lista pessoa, cargo, status (Ativo ou Desligado), 2FA e último acesso. Permite criar acesso direto, convidar e filtrar por status.
- Desativar uma pessoa encerra as sessões na hora, e o histórico dela continua registrado.
- Segurança do painel: lista de IPs ou faixas permitidos. Sem lista configurada, a equipe entra de qualquer IP. A tela tem o atalho "Adicionar meu IP".
- IA no painel (MCP): cria chaves de API para ferramentas de IA. Cada chave age como quem a criou, com as permissões do cargo dessa pessoa.
- Auditoria: registra data e hora, quem fez, ação, entidade, resumo e IP. Filtra por período, pessoa e ação, mostra 50 linhas por página e exporta CSV.

A verificar: o 2FA aparece como "Opcional" na maioria dos cargos. Ainda não confirmei se o servidor aplica essa regra ou só a exibe.

## Módulo Geral

O módulo Geral mostra os indicadores da operação e dá acesso à lista de jogadores, aos rankings e às transações. Os números seguem o período escolhido no seletor.

**Dashboard** (`/dashboard`)

- Seletor de período com intervalo de datas (7 dias, 30 dias ou 90 dias, além de datas livres).
- Indicadores: GGR (apostas menos vitórias), depósitos, saques, net (depósitos menos saques), usuários ativos, cadastros e saldo da carteira no início e no fim do período.
- Blocos: Fechamento do período (GGR de cassino e de esportes, NGR, bônus, free spins, creditações e subtrações, FTD, indicações), Funil de depósitos, Links que converteram, Top 5 jogos por GGR e Insights.
- Cada bloco tem o botão "Como é calculado", com a fórmula.
- Estado atual: na última visita, o painel mostrou "Métricas ainda não estão disponíveis" com o botão "Tentar novamente". Na revisita, os números voltaram a aparecer, então a integração de métricas está instável.

**Usuários** (`/dashboard/usuarios`)

- Lista de jogadores com ID, e-mail, apelido, celular, origem, cargo, saldo, data de entrada, último acesso e total depositado.
- Busca por e-mail, ID ou CPF. Filtros, escolha de colunas e exportação.
- Paginação de 10 linhas. Cada linha tem "Ver resumo do usuário", a ficha do jogador.

**Rankings** (`/dashboard/rankings`)

- Ranking de jogadores por seis critérios: mais apostou, mais apostas, mais ganhou, maior ganho único, melhor resultado e maior GGR para a casa.
- Exportação em CSV.

**Transações** (`/dashboard/transacoes`)

- Extrato com ID, data, usuário, tipo, valor, saldo anterior, saldo atual, jogo e provedor.
- Busca pelo ID da transação, filtro por tipo, escolha de colunas e exportação. Cada linha tem um menu de ações.

Não abri os filtros avançados nem a ficha do jogador. Esses pontos ficam para a revisita das telas de lacuna.

## Módulo Operação

O módulo Operação é a fila diária de saques e depósitos. A decisão de aprovar ou recusar um saque é tomada aqui, e as regras que definem quais saques entram na fila ficam na mesma tela.

**Saques** (`/system/saques`), aba Fila operacional

- Cards de resumo: aguardando decisão (valor e quantidade, com as solicitações em análise há mais de 24 horas), aprovado no período, recusado ou expirado, cancelado pelo jogador (com o valor devolvido ao saldo) e limite de aprovação automática.
- Filtro por status: criados, pendentes, em análise (+24h), aprovados, recusados, expirados e cancelados.
- Busca por ID, usuário ou e-mail.
- Colunas: solicitação (ID e tempo decorrido), usuário, valor, risco (nível e pontuação), referência, status, data de atualização e decisão.
- Decisão: botões "Aprovar" e "Recusar" em cada linha. Não testei se pedem confirmação. O teto de aprovação depende do cargo (ver Perfis e permissões).

**Saques**, aba Regras de saque

- Campos com os valores atuais: valor mínimo (R$ 20,00), valor máximo por solicitação (R$ 5.000,00), rollover exigido (0%), taxa fixa do saque (R$ 0,00), limite diário (2 saques por jogador por dia) e aprovação automática (máximo automático R$ 0,00, ou seja, desligada).
- Modo de contagem do rollover: acumulado (tudo o que o jogador apostou sobre tudo o que depositou) ou por depósito (cada depósito tem seu rollover, e só contam apostas feitas depois dele).
- Quais apostas contam: toda aposta (padrão), só apostas com saldo real, ou só a parte paga com bônus.
- Botão "Salvar regras".

**Depósitos** (`/system/deposits`)

- Abas: Depósitos, Campanhas e Limites e tela de depósito.
- Aba Depósitos: lista com ID, usuário, valor, referência, status e data de atualização. Busca por ID, usuário ou e-mail.
- As abas Campanhas e Limites não foram abertas nesta fase.

## Módulo Esportes

O módulo Esportes tem uma tela, de consulta de apostas esportivas. O visual padrão do sportsbook é o da Betby, e a configuração visual fica em Personalização.

**Apostas esportivas** (`/esportes/apostas`)

- Abas: Abertas, com a contagem de apostas em aberto, e Todas.
- Filtros: busca por evento, time ou mercado, ID do jogador, provedor, valor mínimo e valor máximo.
- Colunas: data, jogador, aposta, tipo, valor, odd, potencial de ganho, valor pago e status.
- Paginação de 25 linhas e botão "Atualizar".
- Consulta apenas. Não há ações de cancelamento ou ajuste nessa tela.

## Módulo Cassino

O módulo Cassino controla o catálogo de jogos, as provedoras, as vitrines da home e a integração com os agregadores que entregam o catálogo. A capa de cada jogo é trocada aqui.

**Jogos** (`/games/jogos`)

- Lista de jogos com busca por nome, filtro por provedora, ordenação (padrão: maior destaque) e botão "Limpar filtros".
- Cada jogo tem o botão "Trocar capa", que substitui a imagem do jogo.

**Provedoras** (`/games/provedoras`)

- Lista de provedoras de jogos com busca e filtros: todas, ativas e pausadas.
- Mostra as integrações do catálogo e tem o botão "Atualizar".

**Vitrines de jogos** (`/settings/game-preview`)

- Vitrines de jogos exibidas na home, com a ordem de exibição.
- Vitrines de exemplo: Top 10 da semana e Melhores ao vivo.
- Botões "Nova vitrine" e "Editar" por vitrine.

**Agregadores de jogos** (`/games/agregadores`)

- Um bloco de configuração por agregador. Hoje aparecem Metagrator, com ambientes de produção, staging e atual, e Skravion, em produção.
- Cada bloco mostra se o agregador está contratado e tem campos de ambiente, Platform ID, API secret e Webhook secret. A sportsbook tem campos próprios: Platform ID, Public API key, Private API key e Webhook secret.
- Os segredos aparecem mascarados, com só os últimos caracteres visíveis.
- Ações: "Salvar credenciais", "Testar conexão" e "Sincronizar catálogo". Não acionei nenhuma delas.
- Precedência por provedora: escolhe qual agregador tem prioridade para cada provedora.

As regras de cada agregador (quais jogos entram, como a sincronização trata duplicados) não foram verificadas. Vale confirmar com o time técnico antes de recriar.

## Módulo Crescimento

O módulo Crescimento mede o resultado da casa por provedora e acompanha o desempenho dos afiliados. Também define a comissão de cada tipo de afiliado.

**GGR** (`/dashboard/ggr`)

- Seletor de mês e atalhos de período de 7, 30 e 90 dias, além de datas livres.
- Abas: Resumo, Provedores, Jogos e Apurações.
- Aba Provedores: tabela com provedor, apostado, pago, receita bruta, RTP, taxa e GGR. Filtro por provedor.

**Ranking de afiliados** (`/dashboard/afiliados`)

- Ranking de afiliados por desempenho no período. Colunas: afiliado, indicados, quantos depositaram, valor depositado, CPA (valor fixo por jogador) e Rev Share (percentual sobre a receita).

**Indicados** (`/analysis/leads`)

- Lista de jogadores indicados, com jogador, quem indicou, nível, valor depositado, saldo e data de cadastro.
- Busca por nome ou e-mail, paginação e exportação em CSV.

**Links** (`/analysis/links`)

- Links de indicação ativos, um por afiliado, no formato de endereço do site com o código de referência.
- Colunas: afiliado, nível, link, cadastros, jogadores que depositaram e valor depositado.
- Filtro por afiliado.

**Comissões** (`/system/affiliates`)

- Um bloco por tipo de afiliado: Manager, Influencer e Organic.
- Cada bloco tem o modelo de comissão, fixo ou percentual, um campo de valor e um teto. O teto aparece como "sem teto" por padrão.
- Botão "Salvar" em cada bloco.

## Programa de afiliados

O programa de afiliados é um módulo próprio, separado do Crescimento. Ele cuida dos gerentes de afiliados, do resultado de cada gerente, dos saques de comissão e das regras do programa.

**Visão geral** (`/system/programa-afiliados/visao-geral`)

- Atalhos de período: este mês, mês passado, 7 dias e 30 dias. Também há datas livres (de/até) e botão "Aplicar".
- Tabela por gerente, com cliques, cadastros, FTD, valor depositado, GGR, comissão, resultado e valor a pagar.

**Gerentes** (`/system/programa-afiliados/gerentes`)

- Lista com gerente, contratos, subafiliados, saldo e status.
- Busca por nome ou e-mail e botão "Novo gerente".

**Saques de afiliados** (`/system/programa-afiliados/saques`)

- Abas: pendentes, pagos, recusados e todos.
- Colunas: data do pedido, afiliado, valor, forma de pagamento, dados do PIX e status.
- A coluna de dados do PIX expõe dados bancários na listagem. Vale revisar a exibição.

**Configuração** (`/system/programa-afiliados/configuracao`)

- Bloco Programa: saque mínimo e máximo em reais, rollover do bônus em vezes (x), carteira do jogo e bônus com rollover.
- Bloco Saques das comissões: forma de pagamento (PIX, entre outras).
- Botão "Salvar alterações".

## Módulo Campanhas

O módulo Campanhas é o maior do painel, com 21 telas. Ele cria bônus, giros, missões, roletas, loja, moedas e comunicações com o jogador.

| Tela | Rota | Tipo | Função |
| --- | --- | --- | --- |
| Promoções | /campanhas/promocoes | Listagem | Cria e lista promoções |
| Templates | /campanhas/templates | Listagem | 30 templates de webhook, um por tipo de evento, com campos e status |
| Webhooks | /campanhas/webhooks | Configuração | Destinos HTTP por evento de saque e depósito |
| Free Spins | /campanhas/free-spins | Listagem | Campanhas de giros e concessões feitas |
| Bônus de depósito | /campanhas/bonus-deposito | Listagem | Campanhas de bônus sobre depósito |
| Saldo bônus | /campanhas/saldo-bonus | Configuração | Onde o saldo bônus vale e a ordem de uso |
| Rollover | /campanhas/rollover | Configuração | Peso de cada tipo de aposta no rollover |
| Moeda | /campanhas/moeda | Configuração | Moeda do site (Evox Coins, EVC) e como se ganha |
| Roleta | /campanhas/roleta | Listagem | Roletas de prêmios por grupo de jogadores |
| Loja | /campanhas/loja | Listagem | Itens comprados com moedas |
| Cupons | /campanhas/cupons | Listagem | Cupons e seus resgates |
| Indicação | /campanhas/indicacao | Configuração | Baús por número de indicados válidos |
| Missões | /campanhas/missoes | Listagem | Objetivos que dão recompensa |
| Torneios | /campanhas/torneios | Listagem | Competições por pontuação com ranking |
| Níveis e XP | /campanhas/niveis | Configuração | Trilha de níveis e regras de XP |
| Cashback e Rakeback | /campanhas/cashback | Configuração | Devolução de perda e de aposta |
| Notificações | /campanhas/notificacoes | Formulário | Mensagens no sino do jogador |
| Popups e Inbox | /campanhas/popups-inbox | Listagem | Modais no site e caixa de mensagens |
| Disparos | /campanhas/disparos | Formulário | E-mail, SMS e RCS para públicos |
| Jornadas | /campanhas/jornadas | Listagem | Automações por jogador, com gatilho e etapas |
| Estatísticas | /campanhas/estatisticas | Relatório | Execuções, taxa de sucesso e falhas de webhooks |

**Regras-chave**

- Saldo bônus: pode valer em todos os jogos, só nos selecionados ou em todos menos os selecionados. A ordem padrão gasta o bônus primeiro, e a aposta inteira conta para o rollover.
- Popups: aparece no máximo um popup por carregamento de página, o de maior prioridade.
- Indicação: o programa pode ser ligado ou desligado. Quando desligado, some do site e nenhum baú é aberto.
- Disparos: SMS e RCS dependem de uma conta do fornecedor SendWork. Sem essa conta, só o e-mail fica disponível.
- Estatísticas de webhooks: 134 execuções nos últimos 30 dias, com 100% de sucesso e zero falhas na última visita.
- Rollover: a tela mostrou erro numa visita e carregou na revisita. Pesos por tipo de jogo: 1x, 0,1x e 0x. Crash conta só se a rodada terminar em perda total ou com ganho de pelo menos X vezes o apostado. A regra vale para bônus, saque e indicação, e fica desligada até um dos rollovers ser ligado.

Não abri formulários de criação, como Nova promoção, Nova campanha e Nova jornada. Bônus de depósito tem uma campanha ativa: "Deposite 50 e ganhe o dobro", com bônus de 100%, mínimo de R$ 10,00, teto de R$ 500,00 e rollover de 10x, por jogador. Free Spins tem uma campanha ativa: 100 giros no 2º depósito, em Fortune Tiger, a R$ 0,40 por giro. Cupons e Jornadas estão vazios. Os campos dos formulários de criação ficam para a próxima passagem.

## Módulo Personalização

O módulo Personalização controla a aparência e o conteúdo que o jogador vê no site. São 11 telas, quase todas com um único botão "Salvar alterações".

- **Identidade e tema** (`/settings/theme`): logotipo de 200×100 px, ícone do navegador, cores e imagem de compartilhamento. Define a marca no cabeçalho, no rodapé, nas telas de entrada e na aba do navegador.
- **Sportsbook** (`/settings/sportsbook`): escolhe o visual claro ou escuro das apostas esportivas, a fonte e se usa as cores do site. Desligado, o sportsbook usa o visual padrão da Betby (escuro e azul).
- **Página inicial** (`/settings/home`): lista de blocos arrastável, com a ordem da home. Hoje 5 de 11 blocos estão ligados. Bloco desligado não é carregado.
- **Provedores na home** (`/settings/provedores-home`): liga a faixa de provedores, define quais aparecem, em que ordem e com que logotipo. Tem "Adicionar provedor" e "Restaurar padrão".
- **Banners** (`/settings/banners`): sete posições com tamanho fixo, como Banner Hero (1372×476), Login (320×480), Cadastro (320×480) e Banner Compacto (500×120). Mostra posições não usadas quando marcado.
- **Perfil e avatares** (`/settings/avatar`): define o avatar de cada jogador que aparece no site, como nos rankings de torneio e nos ganhadores ao vivo. Pode ser gerado ou próprio, e há um avatar por conquista (apostas, vitórias).
- **Menus do site** (`/settings/navigation`): itens do cabeçalho no computador e da barra do celular. Cada item tem link e "Adicionar item". O padrão da plataforma vem preenchido.
- **Carrosséis do jogo** (`/settings/game-showcase`): carrosséis na página de cada jogo, com "Maiores vitórias neste jogo" e "Jogos relacionados".
- **Rodapé e contato** (`/settings/footer`): dados da empresa (nome, descrição, termos) e canais de contato (telefone, e-mail, WhatsApp e outros). Canal em branco não aparece.
- **Redes sociais** (`/settings/social`): lista de redes com "Adicionar Rede Social". Hoje está vazia.
- **SEO avançado** (`/settings/seo`): endereço canônico, logotipo, ícone, imagem de compartilhamento, nome, título, descrição e palavras-chave. Mostra uma prévia de como o link aparece.

## Módulo Segurança

O módulo Segurança investiga contas ligadas entre si e tem uma defesa rápida contra ataques ao site. São 2 telas.

**Anti-fraude** (`/seguranca/antifraude`)

- Abas: Redes, IPs, Bloqueios e Contas dos últimos 30 dias.
- Mostra contas ligadas por mesmo IP, mesmo padrinho, mesmo e-mail, mesmo CPF ou mesmo celular. Para cada conta, mostra o que ela fez.
- Cards de resumo: IPs em uso agora e bloqueios ativos. Filtro de risco (por exemplo, alto).
- Ações: banir a rede inteira ou bloquear um IP no site. Não testei se pedem confirmação.

**Modo de ataque** (`/settings/modo-ataque`)

- Liga uma defesa rápida durante um ataque: limites mais baixos, cadastro fechado e verificação anti-robô.
- Depósitos, saques e jogos continuam funcionando.
- Mostra o tráfego do site na última hora e o estado atual da operação.
- Botões: "Atualizar" e "Ligar modo de ataque". Não acionei o modo. Não sei se pede confirmação nem como ele se desliga.

## Módulo Configurações

O módulo Configurações reúne os dados da empresa, as regras de cadastro, os pagamentos, o e-mail, a equipe e a auditoria. São 19 telas.

| Tela | Rota | Função |
| --- | --- | --- |
| Empresa e licença | /settings/empresa | Razão social, CNPJ e autorização de funcionamento. Aparece no rodapé e nos textos legais |
| Faturas | /faturas | Cobranças da plataforma: em aberto, vencidas, próximo vencimento e pagamento |
| Textos legais | /settings/textos-legais | Termos, política de privacidade e jogo responsável, com histórico de versões |
| Módulos do site | /settings/modulos | Liga e desliga áreas do site (menu, bloco e página) |
| Cadastro e KYC | /settings/cadastro | Tipo de cadastro (nome ou nick) e campos obrigatórios |
| Jogo responsável | /settings/jogo-responsavel | Limites de depósito e pausa do jogador |
| Suporte e contato | /settings/suporte | Canais de atendimento e chat ao vivo |
| Manutenção | /settings/manutencao | Fecha o site com aviso e previsão de volta, com link de acesso para testes |
| Domínios | /settings/dominios | Somente leitura: domínio principal e endereços de acesso |
| Países bloqueados | /settings/paises | Bloqueia países inteiros, somados à regra da plataforma |
| Pixels e tracking | /settings/tracking | Pixels de Meta, TikTok, Kwai e Analytics. Eventos: PageView por página, cadastro concluído, escolha do valor do depósito, início do PIX e depósito confirmado (compra) |
| Gateways | /settings/gateways | Contas de pagamento. Cada gateway aceita várias contas |
| Integrações | /settings/integracoes | E-mail pelo padrão da plataforma (SMTP), Mailgun ou SendWork, que são também os canais de SMS e RCS. Mailgun e SendWork estão sem conta. O e-mail atende redefinição de senha, convites, boas-vindas, avisos de depósito e saque, e os Disparos e Jornadas |
| Templates de e-mail | /settings/templates-email | Texto de cada e-mail transacional, como redefinição de senha e boas-vindas, e se ele é enviado |
| Equipe | /settings/equipe | Pessoas com acesso, cargo, status, 2FA e último acesso |
| Cargos e permissões | /settings/cargos | Permissões, membros, 2FA e teto de aprovação de saque por cargo |
| IA no painel (MCP) | /settings/mcp | Chaves de API para ferramentas de IA |
| Segurança do painel | /settings/seguranca | Lista de IPs ou faixas permitidos para a equipe |
| Auditoria | /settings/auditoria | Registro de ações com data, pessoa, ação, entidade, resumo e IP. Exporta CSV |

**Regras-chave**

- Gateways: a conta principal é a credencial do cadastro. As contas extras têm credencial e URL de callback próprias. Os segredos são cifrados e não são exibidos.
- Cadastro: sem a data de nascimento, a idade mínima de 18 anos não é verificada no cadastro.
- Equipe: desativar uma pessoa encerra as sessões na hora. O histórico continua na auditoria.
- Domínio: a compra e a ligação de um domínio novo são feitas pelo Superadmin, e não pelo painel.
- Faturas: na última visita, R$ 6.498,68 estavam em aberto, em uma fatura, com vencimento em 12/10/2026.
- Jogo responsável: a tela cita a Lei 14.790/2023 e as portarias da SPA/MF como base para as ferramentas de controle.

## Regras de negócio transversais

As regras abaixo valem em mais de uma tela. A recriação precisa reproduzi-las no servidor, e não só na interface.

- **Moeda**: todos os valores são em reais (R$), com vírgula decimal. O saldo do jogador tem parte real e parte bônus.
- **Ordem de uso do saldo**: por padrão, o bônus é gasto primeiro e o saldo real só entra quando o bônus acaba. A configuração pode inverter essa ordem.
- **Rollover**: o valor de cada aposta conta conforme o tipo de jogo. Pesos observados: 1x (valor inteiro), 0,1x (10%), 0,5x e 0x (não conta). O modo pode ser acumulado ou por depósito.
- **Saques**: passam por valor mínimo (R$ 20,00), valor máximo (R$ 5.000,00), limite diário de 2 por jogador, rollover exigido e taxa. A aprovação automática está desligada.
- **Teto de aprovação**: cada cargo aprova saques até um valor. Financeiro tem teto de R$ 5.000,00, e Superadmin não tem teto.
- **Países bloqueados**: um país bloqueado barra cadastro, login, depósito, jogo e saque. O visitante vê "não disponível no seu país".
- **Módulo desligado**: desligar uma área remove, de uma vez, a entrada no menu, o bloco da página e a página.
- **Manutenção e modo de ataque**: a manutenção fecha o site para todos, com aviso. O modo de ataque mantém depósitos, saques e jogos funcionando.
- **Webhooks**: disparam a cada evento de saque (solicitado, pago, rejeitado, expirado) e no primeiro depósito.
- **Auditoria**: toda ação no painel é registrada com pessoa, data, hora e IP.
- **Segredos**: credenciais de gateway e de agregador são cifradas e mascaradas na tela.
- **Regulação**: a tela de jogo responsável cita a Lei 14.790/2023 e as portarias da SPA/MF, que exigem ferramentas de controle para o apostador.

## Achados para a auditoria

Os achados abaixo vieram de leitura da interface, e não de teste do servidor. Antes de tratar um item como falha, é preciso confirmar se a regra é aplicada no back-end.

| # | Tela | Evidência observada | Risco |
| --- | --- | --- | --- |
| 1 | Cargos | 2FA é opcional para Superadmin, Administrador, Financeiro, ADM e Suporte. Só Marketing oficial exige | Alto |
| 2 | Equipe | Conta de Superadmin antiga está ativa com 2FA desligado e acesso recente. A leitura foi feita pela posição das colunas | Alto |
| 3 | Segurança do painel | Texto da tela: "Nenhuma restrição: a equipe entra de qualquer IP" | Alto |
| 4 | IA no painel (MCP) | Chave age como o criador, com as permissões do cargo dele. Se o criador não tem 2FA, a chave herda a fragilidade | Alto |
| 5 | Usuários, Saques de afiliados, Leads, Auditoria | Busca por CPF e exportação de dados; PIX exibido na listagem de saques de afiliados | Alto (LGPD) |
| 6 | Agregadores | Segredos mostrados com os últimos 4 caracteres | Médio |
| 7 | Webhooks | Destino com segmento de cara de token no caminho da URL. O valor não foi reproduzido | Médio |
| 8 | Cadastro e KYC | Sem data de nascimento, a idade mínima de 18 anos não é verificada | Alto (regulatório) |
| 9 | Cargos | Nomes parecidos: "Marketing oficial" e "marketing", "ADM" e "Administrador". Risco de atribuir permissão errada | Baixo |
| 10 | Modo de ataque | Ativação e desativação não testadas. Confirmar se pede confirmação e como desliga | Não testado |

Além disso, o dashboard mostrou "Métricas ainda não estão disponíveis" numa visita. Isso afeta a confiabilidade dos indicadores de gestão.
