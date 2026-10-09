# X2Win Backoffice

Recriação do backoffice da operação X2Win (cassino + apostas esportivas): 73 telas em 10 módulos,
tema claro e escuro, ícones Lucide, interface em pt-BR. Baseado na especificação em
[`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md).

## Como rodar

```bash
cd x2win-backoffice
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/ (abre de qualquer pasta ou hospedagem estática)
npm run typecheck
```

Requisitos: Node 20+.

## O que já funciona

- **73 telas navegáveis** pela barra lateral (10 grupos recolhíveis) e pela busca de páginas (`Ctrl + K`).
- **Tema claro, escuro ou do sistema**, escolhido no topo e lembrado no navegador.
- **Cargos e permissões**: menu, telas e botões seguem o cargo. No menu do usuário, "Ver painel como cargo"
  simula Financeiro, Suporte, Marketing etc. O teto de aprovação de saque é aplicado (Financeiro até R$ 5.000,00).
- **Auditoria**: toda ação (aprovar, recusar, salvar, exportar, revelar dado sensível, banir) entra no registro com
  pessoa, data, hora e IP, visível em Configurações › Auditoria.
- **Dados persistidos no navegador**: criar, editar e excluir funcionam e continuam depois de recarregar.
  "Restaurar dados de demonstração" (menu do usuário) volta ao estado inicial.
- **Webhooks simulados**: aprovar ou recusar um saque gera a execução do webhook, que aparece em Estatísticas.
- **Telas conversam entre si**: banir uma rede no Anti-fraude bloqueia os jogadores em Usuários; o tema salvo em
  Identidade e tema aparece nas prévias das outras telas; conectar o SendWork em Integrações libera SMS e RCS em
  Disparos e Jornadas; ligar o modo de ataque ou a manutenção muda o status no topo do painel.

## Achados da auditoria já tratados na recriação

| # | Achado | Como ficou |
| --- | --- | --- |
| 1 | 2FA opcional em cargos com acesso amplo | Alerta em Cargos e Equipe com "Exigir 2FA" em um clique; cargos novos já nascem exigindo 2FA |
| 2 | Conta administrativa ativa sem 2FA | Aviso no sino do topo e em Equipe, com "Pedir ativação do 2FA" |
| 3 | Painel aceita login de qualquer IP | Aviso fixo em Segurança do painel e no topo; "Adicionar meu IP"; trava contra se bloquear |
| 4 | Chave MCP herda a fragilidade de quem criou | Criar chave exige 2FA; chaves de criador sem 2FA ficam marcadas, com revogação em lote |
| 5 | CPF e PIX expostos em listas (LGPD) | Dados mascarados em listas e CSV; "Revelar" exige permissão e fica na auditoria |
| 6 | Segredos com os últimos 4 caracteres | Nunca revelados; só "Substituir", registrado sem o valor |
| 7 | Token no caminho da URL de webhook | Token mascarado e alerta recomendando assinatura HMAC |
| 8 | Idade mínima não verificada no cadastro | Data de nascimento obrigatória por padrão; desligar exige confirmação e deixa alerta vermelho |
| 9 | Cargos com nomes parecidos | Alerta com sugestão de renomear; o seletor de cargo mostra a descrição |
| 10 | Modo de ataque sem confirmação clara | Ligar exige digitar ATAQUE; desligar por botão ou sozinho após o tempo escolhido |

## O que é simulado

Não há servidor. Os dados são de demonstração (gerados com semente fixa) e ficam no `localStorage`.
Integrações externas (gateways, agregadores, SendWork, Mailgun, pixels) só simulam a resposta, assim como o
tráfego do Modo de ataque, a saúde dos gateways e as métricas de envio dos disparos.
Segredos de exemplo têm o prefixo `DEMO-`.

## Estrutura

```
src/
├── nav.ts              # mapa das 73 telas: rota, ícone, módulo e permissões
├── routes.tsx          # carregamento sob demanda de cada tela
├── pages/<módulo>/     # uma tela por arquivo
├── components/ui/      # biblioteca visual (tabela, formulários, modais, KPIs...)
├── components/charts/  # gráficos (Recharts) com paleta validada para daltonismo
├── components/layout/  # barra lateral, topo, busca de páginas, controle de acesso
├── domain/             # regras de negócio puras (cargos, saques, webhooks, estado do site)
├── data/               # dados de demonstração e hooks de coleções
└── lib/                # store, formatação pt-BR, CSV, tema
```

Para criar ou alterar uma tela, siga o [`docs/GUIA-TELAS.md`](docs/GUIA-TELAS.md).

## Caminho para produção

1. **Back-end**: trocar `lib/store.ts` (useDb/useCollection) por chamadas a uma API. As telas não mudam.
2. **Regras no servidor**: as funções de `src/domain/` (teto por cargo, regras de saque, rollover, validações)
   precisam rodar também no servidor. A interface só exibe; quem decide é o back-end.
3. **Autenticação**: login com 2FA, sessão com expiração, lista de IPs permitidos aplicada no servidor.
4. **Integrações reais**: gateways PIX, agregadores de jogos, Betby, SendWork/Mailgun e pixels.
