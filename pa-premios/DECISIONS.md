# DECISIONS.md

Registro de decisões tomadas onde a spec não define a regra.
Status: `PROPOSTA` (aguardando revisão) · `APROVADA` · `APROVADA (com ajuste)` · `VALIDADA` (comprovada por teste) · `REVISADA`.
Última revisão do usuário: 02/11/2026 (respostas Q1–Q10 + abrangência nacional, SPEC 2.1).

## Decisões de negócio (D-01 a D-20)

| ID | Tema | Decisão | Motivo | Configurável? | Status |
|---|---|---|---|---|---|
| D-01 | Unidade monetária | Valores em centavos inteiros. Preço da cota não aceita fração de centavo. | Elimina erro de arredondamento. | Não | APROVADA |
| D-02 | Cotas mínimas | `ceil(minOrderValue / preço)`. Ex.: 700 / 6 → 117 cotas = R$ 7,02. | SPEC 5. | Não | APROVADA |
| D-03 | Gatilho das travas | As travas (preço, total, regra de apuração, mínimo) entram na **1ª reserva**, não no 1º pagamento. | Quem reservou já viu as condições. | Não | APROVADA |
| D-04 | Estados extras | `GENERATING_NUMBERS` e `CANCELLED`. `CANCELLED` dispara o reembolso integral de todos os pedidos pagos (D-37). | Pool assíncrono; o regulamento prevê cancelamento. | Não | APROVADA |
| D-05 | Cotas da casa | Quantidade **absoluta**: o slider só calcula no momento de salvar; o sistema nunca bloqueia mais sozinho. Arredondamento do alvo: `ceil`. | "O percentual só muda quando o estoque muda." | Não | APROVADA |
| D-06 | Transparência da casa | Nota ao lado da barra, ligada por padrão, texto editável (texto default da SPEC 8.5). | Reduz risco de publicidade enganosa. | Sim | APROVADA |
| D-07 | Embaralhamento e sigilo da ordem do pool | `random()` (SPEC 6.3) + SHA-256 da lista ordenada (number, shuffle_rank) gravado ao concluir a geração (`orderingSha256`) e no audit log. **Ajuste:** (1) `pa_app` não lê `shuffle_rank`: só tem SELECT nas demais colunas de `tickets` e nenhuma escrita direta; alocação, liberação, confirmação e cotas da casa passam por funções `SECURITY DEFINER` (com `search_path` fixo) que devolvem só os números; (2) nenhum usuário humano lê `tickets` em production fora dessas funções; acesso emergencial só pelo dono do banco, com registro (pgaudit ou procedimento formal, e membros do projeto Supabase restritos, pois o Table Editor usa o dono); (3) teste: `pa_app` recebe *permission denied* em `SELECT shuffle_rank` (F1, junto com a tabela). | Quem conhece a ordem do pool sabe em que posição sai cada cota premiada e pode comprar no momento certo. | Não | APROVADA (com ajuste) |
| D-08 | Pagamento tardio | Realoca se a campanha estiver ativa e houver estoque; senão `REFUND_PENDING` (tipo `LATE_PAYMENT`) + alerta. | Regra da spec + conservadorismo no dinheiro. | Não | APROVADA |
| D-09 | Reembolso × números | Antes do encerramento, os números voltam ao estoque; depois, ficam não vendidos (fora da apuração). Detalhes em D-37. | Só número PAGO concorre. | Não | APROVADA |
| D-10 | Template do regulamento | Marcadores `[PREENCHER: …]`; `{max_number}` e `{max_per_cpf}` separados; item 5 conforme a `drawRule`; trava por regex `\[PREENCHER:`. | SPEC 12.3, 16 e 19.12. | Não | APROVADA |
| D-11 | Hash do regulamento | SHA-256 do markdown final normalizado (NFC, LF, sem espaço no fim da linha); o PDF tem hash próprio. | Reprodutível por terceiros. | Não | APROVADA |
| D-12 | Cadastro existente | O checkout público só completa campos vazios; alteração só pelo suporte, com audit log. | Evita sequestro de cadastro por quem conhece só o CPF. | Não | APROVADA |
| D-13 | Limite por CPF | `max_per_cpf = 20.000` no seed; cotas do bump contam nos dois limites (D-38). | Conservador. | Sim | APROVADA |
| D-14 | Cidade/UF do ganhador | Preenchidas pelo admin em "documentos validados"; sugestão = UF do IP do pedido (indicativa). | SPEC 12.6. | Não | APROVADA |
| D-15 | Dupla digitação | Production: dois usuários **distintos** com permissão de apuração (owner, operador ou financeiro), em qualquer ordem; o segundo não precisa ser o owner. Dev/staging: o mesmo usuário pode fazer as duas. | Quatro olhos sem travar o dia do sorteio (Q3). | Sim | APROVADA |
| D-16 | Retenção de dados | Sem expurgo automático por padrão; job pronto e desligado. | Obrigação legal a definir pelo jurídico. | Sim | APROVADA |
| D-17 | Máscara de nome | Público: "Jamilson V."; confirmação de CPF: "J***** V." + "(99) *****-3568". | SPEC 5 e 9. | Não | APROVADA |
| D-18 | Ranking: desempate | `reachedAt` = pagamento que levou ao total atual; dia pela data do pagamento em Fortaleza. Reembolso recalcula a partir dos pedidos pagos restantes (D-37). | "Quem atingiu o total primeiro." | Não | APROVADA |
| D-19 | Progresso exibido | Arredondado para baixo; nunca 100% enquanto houver cota disponível. | Não anunciar esgotado sem estar. | Parcial | APROVADA |
| D-20 | Storage | Supabase Storage, bucket privado, URL assinada curta, acesso no audit log. Vídeo da galeria: upload ou URL de embed. | SPEC 2 e 19.4. | Sim | APROVADA |

## Decisões técnicas (D-21 a D-36)

| ID | Tema | Decisão | Motivo / evidência | Status |
|---|---|---|---|---|
| D-21 | Pooler em modo transação × motor de números | Funciona, com as regras: (1) alocação dentro de **uma** transação interativa; (2) travas apenas de transação: `FOR UPDATE SKIP LOCKED`, `pg_advisory_xact_lock`, `SET LOCAL`; (3) proibido: `pg_advisory_lock` de sessão, `SET` sem `LOCAL`, tabelas temporárias, `LISTEN/NOTIFY`, prepared statements nomeados (`pgbouncer=true` obrigatório, validado pelo Zod); (4) `maxWait`/`timeout` explícitos na transação. | `tests/integration/pooler-transaction-mode.test.ts` com pgbouncer 1.24 em `pool_mode=transaction`: 200 transações concorrentes × 50 = 10.000 números, zero duplicados; lock de transação serializa entre conexões; rollback devolve tudo; 20.000 números em ~0,5s. **Repetir contra o pooler real do Supabase em staging antes de fechar a F1.** | VALIDADA (local) |
| D-22 | Versão do Postgres | Dev/CI em 16 com `PG_MAJOR` parametrizado; alinhar à major exibida no painel do Supabase. | Paridade dev × prod. | APROVADA |
| D-23 | Local do código até o repositório existir | `pa-premios/` na branch `claude/adoring-franklin-15l3wf`; migração com `git subtree split --prefix=pa-premios -b pa-premios-export` + push para `daniel-carius/pa-premios` `main`. | Repositório ainda não criado. | APROVADA |
| D-24 | Prisma 6.19 (não 7) | Linha 6.x; reavaliar após a F5. | Comportamento conhecido com `pgbouncer=true`. | APROVADA |
| D-25 | Role restrito `pa_app` | App como `pa_app` (não dono); migrations e seed como dono. Sem acesso a `_prisma_migrations`; só SELECT/INSERT no `audit_log`. | SPEC 15: travas e audit log não burláveis por SQL da aplicação. Coberto por teste. | APROVADA |
| D-26 | Conexões por instância na Vercel | `connection_limit=5` na `DATABASE_URL` de staging/production. **Ajuste:** no k6 da F5, conferir o limite de conexões de cliente do plano do Supabase contra (instâncias esperadas × 5). | Fluid Compute atende várias requisições por instância. | APROVADA (com ajuste) |
| D-27 | Data API do Supabase | Remover `public` dos schemas expostos (painel) + migration que revoga tudo de `anon`/`authenticated`. **Ajuste:** RLS habilitado em todas as tabelas de `public`, para que uma exposição futura acidental retorne vazio. Detalhe técnico em D-42. Coberto por `tests/integration/rls.test.ts` (toda tabela com RLS; role sem policy lê vazio mesmo com GRANT). | A chave anon é pública. | APROVADA (com ajuste) — **implementada na F0** |
| D-28 | Banco dos testes de integração | Banco descartável por execução + `prisma migrate deploy`; removido no final. | Isolamento; não apaga nada pré-existente. | APROVADA |
| D-29 | pg_cron no dev/CI | `cron.use_background_workers=on`; jobs em outros bancos via `cron.schedule_in_database`; a migration falha se o pg_cron não estiver carregado. | Espelha o Supabase. Coberto por teste. | APROVADA |
| D-30 | Versões fixadas | Next 15.5, React 19, TS 5.9, ESLint 9, Tailwind 4, Vitest 3.2, Playwright 1.63, Zod 4. | Compatibilidade com o Next 15. | APROVADA |
| D-31 | Tarefas pesadas no banco | Pool: uma instrução `INSERT … SELECT generate_series` numa função chamada pelo pg_cron. Casa: pg_cron a cada 2s, 1 lote de 10.000 por execução, checando cancelamento antes de cada lote. | SPEC 6.3 e 8.2. | APROVADA |
| D-32 | Fluxo do ganhador: estado inicial | `NEW` antes de "contatado". Acrescentado `REVOKED` para prêmio revogado (D-37). | Estado técnico. | APROVADA |
| D-33 | Dispositivo (antifraude) | Cookie first-party com ID aleatório, sem fingerprinting. | LGPD leve (Q10). | APROVADA |
| D-34 | Permissões | Matriz módulo × ação por papel, em código, coberta por teste. Apuração liberada para owner, operador e financeiro (D-15). | Auditável e testável. | APROVADA |
| D-35 | "Supabase local" | Docker Compose (Postgres + pg_cron + pgbouncer) em vez da Supabase CLI; storage com adapter em disco no dev. | Paridade do que importa para o motor. | APROVADA |
| D-36 | Origem do acesso por IP | Headers da Vercel (`x-vercel-ip-country`, `x-vercel-ip-country-region`), só para registro (SPEC 13A); header simulado no dev. **Limitação:** os headers não detectam VPN/datacenter. Interface `IpIntelligenceProvider` prevista para um provedor externo, se necessário. Medir em staging a precisão da UF (Wi-Fi × 4G) e registrar aqui, pois afeta o relatório por UF e a UF sugerida do ganhador. | Sem custo e sem enviar IP a terceiros. | APROVADA (com ajuste) |

## Decisões da revisão de 02/11/2026 (D-37 em diante)

| ID | Tema | Decisão | Origem | Status |
|---|---|---|---|---|
| D-37 | Reembolso | (1) Sempre devolução PIX para a mesma conta pagadora (vinculada ao `endToEndId`), nunca para outra conta. (2) Arrependimento: até 7 dias após a compra **e** antes do encerramento das vendas. (3) Após o encerramento: só cancelamento da campanha, duplicidade ou ordem legal. (4) Pedido com cota premiada contemplada não pode ser reembolsado por arrependimento; se o reembolso for obrigatório, o prêmio é revogado antes, com audit log. (5) Cotas reembolsadas saem do ranking (recalcular). (6) `CANCELLED` dispara o reembolso integral de todos os pedidos pagos. (7) Execução manual com alerta até a F4; automática na F5, com o `refund` do provider real testado. | Q1 | APROVADA |
| D-38 | Order bump × limites | O bump conta para `max_per_order` e `max_per_cpf`. Se aceitar o bump ultrapassaria qualquer limite, ele não é exibido. | Q2 | APROVADA |
| D-39 | Turnstile | Modo invisível, **ligado por padrão em production** na reserva (passo 4) e em "Meus números"; toggle no admin para desligar; desligado por padrão em dev/staging. Implementação: `settings.turnstile_enabled` (null = default do ambiente) + `effectiveTurnstileEnabled()` (F0 ✔). | Q4: o risco principal é o bloqueio de estoque por reservas em massa no pico. | APROVADA |
| D-40 | Abrangência nacional | `authorization_scope = NATIONAL` fixo; nenhum bloqueio geográfico; origem do acesso só registrada. `authorized_state`, `territorial_rule` e `geo_enforcement` removidos do schema (migration `20261102000400_national_scope`), do seed e da UI. Voltam quando o modo STATE sair do backlog. Respostas registradas para o modo STATE: decisão territorial pelo GPS no polígono da UF; bloqueio por IP só se o país ≠ BR; UF do IP ≠ UF do GPS gera sinal de fraude, sem bloqueio; no passo 4, bloqueia só se a nova leitura falhar no polígono ou a permissão for negada; deslocamento acima de max(5 km, 3 × precisão) gera sinal de fraude. Ver risco jurídico R-01 do PLAN. | SPEC 19.14; Q6/Q7 obsoletas | APROVADA |
| D-41 | Turnstile fora do ar | Fail-open: se a verificação do Turnstile falhar por indisponibilidade (não por token inválido), a reserva segue com rate limit reduzido pela metade, sinal de antifraude e alerta. | Parar todas as vendas no pico por falha de terceiro custa mais que o risco temporário. | PROPOSTA (N2) |
| D-42 | RLS com policies para `pa_app` | RLS em todas as tabelas, com policies **somente `TO pa_app`** (settings: tudo; audit_log: SELECT e INSERT). Sem `FORCE`, então o dono (migrations, seed, funções `SECURITY DEFINER`, pg_cron) não é afetado. | "RLS sem policies" bloquearia a própria aplicação, porque `pa_app` não é dono das tabelas. Com policies restritas a `pa_app`, qualquer outro role (anon, authenticated) continua lendo vazio, que é o objetivo da D-27. | PROPOSTA |
| D-43 | Cota premiada revogada | Antes do encerramento: o número volta ao estoque e o prêmio volta a "Disponível". Depois: o prêmio fica cancelado, com registro. | Default conservador até a resposta da N3. | PROPOSTA (N3) |
| D-44 | Origem do acesso no pedido | Colunas `ip`, `ip_country`, `ip_uf` em `orders` (timestamp = `created_at`), em vez de uma tabela separada. | Um registro por pedido basta para antifraude e relatório (SPEC 13A). | PROPOSTA |
| D-45 | Canal de alertas da equipe | E-mail (Resend) na F2; WhatsApp Cloud API na F5. | Q8 | APROVADA |
| D-46 | IR do ganhador | Só registro na F2: base, alíquota, valor, data e guia. Sem cálculo automático. | Q9 | APROVADA |
