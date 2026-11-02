# DECISIONS.md

Registro de decisões tomadas onde a spec não define a regra. Cada decisão usa um **default conservador** e pode ser revista.
Status: `PROPOSTA` (aguardando aprovação do PLAN.md) · `APROVADA` · `REVISADA`.

| ID | Tema | Decisão (default) | Motivo | Configurável? | Status |
|---|---|---|---|---|---|
| D-01 | Unidade monetária | Valores em centavos inteiros. Preço da cota não aceita fração de centavo. | Elimina erro de arredondamento. | Não | PROPOSTA |
| D-02 | Cotas mínimas | `ceil(minOrderValue / preço)`. Ex.: 700 / 6 → 117 cotas = R$ 7,02. | Regra da spec; garante o valor mínimo. | Não | PROPOSTA |
| D-03 | Gatilho das travas | As travas (preço, total, regra de apuração, mínimo) entram na **1ª reserva**, não no 1º pagamento. | Quem reservou já viu as condições; mais conservador. | Não | PROPOSTA |
| D-04 | Estados extras | `POOL_GENERATING` (entre rascunho e publicada) e `CANCELLED` (campanha cancelada; o regulamento já prevê o caso). | A spec exige "só ATIVA com pool completo" e o regulamento cita cancelamento. | Não | PROPOSTA |
| D-05 | Cotas da casa | Quantidade **absoluta**: o slider só calcula a quantidade no momento de salvar. O sistema nunca bloqueia mais cotas sozinho conforme as vendas sobem. Arredondamento do alvo: `ceil`. | "O percentual só muda quando o estoque muda." | Não | PROPOSTA |
| D-06 | Transparência da casa | Nota ao lado da barra quando houver cotas da casa: "inclui números reservados pelo promotor, que não concorrem a prêmios". **Ligada por padrão**, texto editável. | Reduz o risco de publicidade enganosa (R-03). Depende da Q6. | Sim | PROPOSTA |
| D-07 | Embaralhamento auditável | `shuffle_rank` = permutação determinística (Feistel) com seed secreta por campanha. SHA-256 da seed publicado na publicação; seed revelada após a apuração. | Impede manipulação interna da ordem de saída das cotas premiadas (R-08). | Não | PROPOSTA |
| D-08 | Pagamento tardio | Realoca novos números se a campanha estiver `ACTIVE` e houver estoque; caso contrário `REFUND_PENDING` + alerta. Reembolso **manual** pelo financeiro até a Q7 ser respondida. | Regra da spec + conservadorismo no dinheiro. | Não | PROPOSTA |
| D-09 | Reembolso x números | Reembolso antes do encerramento devolve os números ao estoque; depois do encerramento o número fica não pago (fora da apuração). | Só número PAGO concorre. Depende da Q7. | Não | PROPOSTA |
| D-10 | Template do regulamento | Todos os campos pendentes viram `[PREENCHER: …]` (incluindo `[N]`, `[endereço]`, `[nome/e-mail]`). Variáveis renomeadas para `{max_numero}` e `{max_por_cpf}`. Item 5 gerado conforme a `drawRule`. Publicação em production bloqueada por regex `\[PREENCHER[^\]]*\]`. | No template original, alguns placeholders escapariam da trava e `{max}` tinha dois sentidos. | Não | PROPOSTA |
| D-11 | Hash do regulamento | SHA-256 do markdown final normalizado (Unicode NFC, quebras LF, sem espaço no fim da linha). O PDF tem hash próprio, também publicado. | Reprodutível por terceiros. | Não | PROPOSTA |
| D-12 | Cadastro existente | O checkout público só **completa campos vazios**; nunca altera nome, e-mail ou telefone já gravados. Alteração só pelo suporte (admin), com audit log. | Evita sequestro de cadastro por quem conhece só o CPF. | Não | PROPOSTA |
| D-13 | Limite por CPF | Seed: `maxTicketsPerCustomer = maxTicketsPerOrder = 20.000`. Cotas do order bump contam para os dois limites. | Default conservador. Depende da Q8. | Sim (por campanha) | PROPOSTA |
| D-14 | Cidade/UF do ganhador | Não é coletada no checkout; o admin preenche na validação do ganhador (com o documento). | Não adiciona fricção ao checkout; a spec exige o dado só no resultado. | Não | PROPOSTA |
| D-15 | Dupla digitação | Production: dois usuários diferentes (digitação + confirmação). Dev/staging: o mesmo usuário pode fazer as duas. | Controle de quatro olhos na etapa mais sensível. Depende da Q9. | Sim | PROPOSTA |
| D-16 | Retenção de dados | Sem expurgo automático por padrão (`dataRetentionDays = null`); job pronto, desligado. | Pode haver obrigação legal de guardar os registros do sorteio; o prazo fica para o jurídico. | Sim | PROPOSTA |
| D-17 | Máscara de nome | Público: "Primeiro nome + inicial do último sobrenome." ("Jamilson V."). Confirmação de CPF: "J***** V." + telefone "(99) *****-3568". | Spec seções 5 e 9. | Não | PROPOSTA |
| D-18 | Ranking: desempate | `reachedAt` = momento do pagamento que levou o participante ao total atual. Ranking do dia usa a data do pagamento em America/Fortaleza. | "Quem atingiu o total primeiro." | Não | PROPOSTA |
| D-19 | Progresso exibido | Arredondado **para baixo** no passo configurado (1, 5 ou 10%). Nunca exibe 100% enquanto houver cota disponível. | Evita anunciar "esgotado" sem estar. | Parcial | PROPOSTA |
| D-20 | Storage | Adapter S3-compatível (R2 ou S3 em prod, MinIO no dev). Vídeo da galeria: upload ou URL de embed (YouTube/Vimeo), à escolha do admin. | A spec não define storage. | Sim | PROPOSTA |
