# Guia para construir telas

Este guia vale para todas as 73 telas. Leia antes de criar ou editar uma tela.
Telas de referência: `src/pages/geral/Dashboard.tsx` (relatório) e
`src/pages/operacao/Saques.tsx` (listagem com decisão + configuração com simulador).

## Estrutura

```
src/
├── nav.ts                 # 10 módulos e 73 telas (rota, ícone, permissões). Não editar.
├── routes.tsx             # carregamento sob demanda de cada tela. Não editar.
├── pages/<modulo>/<Tela>.tsx   # uma tela por arquivo, export default
├── components/ui/         # biblioteca visual (import de '@/components/ui')
├── components/charts/     # gráficos (import de '@/components/charts')
├── domain/                # regras de negócio puras (sessão, cargos, saques, webhooks, sistema)
├── data/                  # dados de demonstração com semente + hooks de coleções
└── lib/                   # store (useDb/useCollection), format, csv, random, theme
```

## Regras obrigatórias

1. **Só tokens de tema.** Cores via classes `bg-surface`, `bg-surface-2`, `text-fg`, `text-fg-2`,
   `text-fg-3`, `border-line`, `bg-primary`, `text-primary-text`, `text-success`, `text-danger`,
   `text-warning`, `text-info` (com opacidade: `bg-success/10`). Nunca hex fixo nem `slate-*`,
   `gray-*`, `white`, `black` em superfícies e texto. Gráficos usam `var(--chart-1..8)`.
   Opacidades válidas: 5, 10, 15, 20, 25… (múltiplos de 5) ou arbitrária `/[0.03]`.
2. **pt-BR.** Moeda com `brl()`, números com `num()`, datas com `date()`/`dateTime()` de `@/lib/format`.
   Textos curtos, diretos, sem jargão. Botões com verbo ("Salvar regras", "Nova promoção").
3. **Ícones só da Lucide** (`lucide-react`), tamanho 14–18 em linha, 20–22 em destaque. Sem emoji.
   Marcas (Instagram, Facebook, YouTube, X...) não existem nesta versão da Lucide: use ícone genérico
   (`AtSign`, `Globe`, `MessageCircle`, `Send`, `Camera`, `Play`) ou um SVG simples desenhado na tela.
   Para conferir um nome: `ls node_modules/lucide-react/dist/esm/icons | grep <nome>`.
4. **Funcional de verdade.** Nada de botão morto. Toda ação muda estado persistido:
   - listas: `useCollection('<modulo>.<tela>', seed)` → `add`, `update`, `remove`;
   - configurações: `useSettingsForm(key, defaults, { entity, validate })` + `<SaveBar form={form} />`;
   - toda ação relevante chama `audit(acao, entidade, resumo)` (de `@/domain/session`; no modo API vale a
     regra 11);
   - retorno ao usuário com `toast.success/error/info/warning`;
   - ação destrutiva ou irreversível pede `confirm({...})` ou `confirmWithInput({...})`
     (excluir, banir, ligar modo de ataque, enviar disparo, pagar).
5. **Permissões.** `const { canEdit, can } = usePageAccess()`. Sem `canEdit`: botões de criar/editar/excluir
   desabilitados (com `title` explicando), formulário em `<FormFieldset readOnly={!canEdit}>`.
   Permissões especiais: `can('saques.aprovar')`, `can('antifraude.banir')` etc. (veja `extraPerms` em `nav.ts`).
6. **Dados sensíveis (LGPD).** CPF, celular, e-mail e PIX aparecem mascarados em listas
   (`maskCpf`, `maskPhone`, `maskEmail`). Revelar exige permissão; no modo API usa a rota de revelar do
   servidor (regra 11). Segredos: use `<SecretField>` (mascarado, só substitui).
7. **Acessibilidade.** Todo campo dentro de `<Field label htmlFor>`; botão só com ícone usa `<IconButton label>`;
   status nunca só por cor (badge com texto). Tabelas com `caption`.
8. **Responsivo.** Grades `sm:grid-cols-2 xl:grid-cols-4`; nada de largura fixa em px para containers.
   Tabelas largas rolam dentro do cartão (o `DataTable` já faz isso).
9. **Regras de negócio** que valeriam no servidor ficam em funções puras em `src/domain/<modulo>.ts`
   (validação, cálculo), chamadas pela tela. Regra que o servidor já aplica e está em `shared/` (permissões,
   auditoria, saques, jogadores, chaves de dados) é importada de lá (`@shared/...`), nunca copiada: ex.
   `canChangeStatus`, `checkAutoApproveCeiling`, `isGovernedRole`, `panelAuditDecision`.
10. **Sem arquivos compartilhados.** Não edite `components/ui`, `components/charts`, `nav.ts`, `routes.tsx`,
    `domain/session.tsx`, `domain/roles.ts`, `lib/*`. Se precisar de um componente novo, crie em
    `src/pages/<modulo>/_shared.tsx`. Dados novos em `src/data/<modulo>.ts` e regras em `src/domain/<modulo>.ts`.
11. **Modo API.** O mesmo código roda nos dois modos; o servidor é quem decide no modo API
    (`docs/API.md`). Toda tela nova segue:
    - **`isApiMode()`** (`@/lib/api`) separa o que só existe com o servidor (rotas próprias, revelar, campos
      que o servidor define). O modo demonstração continua completo e local: nunca tire uma função dele.
    - **Sem dados de demonstração no modo API.** Sem nada gravado no servidor (GET com `stored: false`), sem
      permissão ou com a leitura falhando, o store (`src/lib/store.ts`) mostra `[]` para lista de registros e o
      padrão da tela para objeto de configuração, nunca o seed. Gerador em `src/data` que precisa de outro valor
      registra o próprio com `demoRecords(seed)` (lista vazia, sem rodar o gerador) ou `apiValue(seed, padrao)`
      (`src/data/demo.ts`); na tela, `isApiMode() ? [] : seed`. Toda lista da tela tem um estado vazio limpo
      (`EmptyState`, sem autor nem data inventados). Chave nova precisa estar em `shared/kv-registry.ts` (senão
      404 `chave_desconhecida`), com leitura, gravação, `pii` e `secrets` certos.
    - **Ações do servidor pelas rotas dele.** Decidir saque, pagar ou recusar saque de afiliado, reconsultar
      depósito, revelar dado, criar acesso, convidar, testar webhook e importar base usam as rotas próprias;
      PUT numa chave do servidor responde 403. Campos que o servidor define (autor, datas, `createdAt`, `sold`,
      `participants`, `since`, `activatedBy`, `decidedBy`, saldo…) vêm da resposta: a tela não os calcula.
    - **Auditoria.** O servidor registra o que executa: toda gravação de chave ("Dados · <tela>"), as ações
      `aprovar`, `recusar`, `revelar`, `banir`, `creditar`, `estornar`, `desativar`, `convidar`, `revogar`,
      `login` e as telas Modo de ataque, Manutenção e Empresa. Não chame `audit()` para isso no modo API
      (`audit()` já descarta o que `panelAuditDecision` recusa). Entidade nova num `audit()` precisa de regra
      em `PANEL_EVENT_RULES` (`shared/audit.ts`), senão o servidor recusa com 403 `evento_nao_relatavel`.
      "Última mudança por", "ligado por" e contagens de ações sensíveis saem só de registros do servidor
      (`!isPanelReported(e)`) ou da resposta do PUT.
    - **Revelar** chama a rota do servidor (`reveal-pix`, `afiliados.saques/:id/reveal`,
      `crescimento.afiliados/:id/reveal`, `webhooks/destinations/:id/reveal`), mostra o dado na hora e nunca o
      guarda em estado persistido (nem no store). Dados de pagamento e contato de afiliado (PIX, banco, e-mail)
      só por `revealAffiliateWithdrawal` e `revealAffiliateContact` (`src/domain/afiliados.ts`): as listas vêm
      sempre mascaradas. Telas de campanha leem `geral.jogadores.audiencia` e `geral.jogadores.metricas`, não a
      base de jogadores.
    - **Links e imagens vindos de dados gravados** nunca vão direto para `href`, `src` ou `window.open`: use
      `safeLinkHref` e `safeImageSrc` (`src/domain/personalizacao-p1.ts`) ou `<SafeImage>`
      (`src/pages/personalizacao/_shared-p1.tsx`); links de markdown: `safeLinkHref` de
      `src/domain/config1-textos.ts`. Só passam `https://`, caminho interno (`/promocoes`) e, em imagens,
      `data:image`, `blob:` e arquivos do painel. A CSP de produção bloqueia imagem externa: `ImageUpload` mostra
      o estado vazio quando a prévia não carrega. Endereço montado pela tela com origem fixa (ex.:
      `referralLink(code)`) não precisa do filtro.
    - **Segredos**: `<SecretField>` com `saved` (a máscara recebida) e `secretFieldError` no `validate`. Quando um
      campo de destino da credencial muda (host, porta, TLS, usuário, URL, conta, ambiente, gateway, cliente),
      passe `requireNew`: o campo fica vazio até um segredo novo ser digitado. Nunca envie texto com `•` ou `***`
      que não seja a máscara exata recebida. Erro do servidor com `details.field` vai no `error` do campo.
    - **Erros do servidor**: mostre `error.message` do `ApiError` (já em pt-BR) e trate os códigos:
      - 409 `versao_desatualizada` (qualquer rota, às vezes sem `details.version`): avise e recarregue os dados
        (`isVersionConflict`);
      - 503 `servidor_ocupado`: espere `error.retryAfter` segundos e deixe tentar de novo (`isServerBusy`);
      - 400 `dados_invalidos` com `details.field` (ou 403 que aponta um campo, como `teto_excedido`): mostre ao
        lado do campo. Formulário: `useSettingsForm(key, padrao, { quiet })` e `form.error` (o rascunho fica na
        tela). Outra gravação: `dbSetAndWaitResult(key, next, seed, { quiet })`, que devolve o `ApiError`. Com
        `quiet`, o erro não vira o aviso "Alteração não salva". Credenciais: `saveKeyDirect`/`saveCredentialsDirect`
        (`dbSaveDirect`) e `isDestinationChanged` (`details.reason: 'destino_mudou'`);
      - 403 `sem_permissao`, `campo_nao_permitido`, `transicao_nao_permitida`, `teto_excedido`,
        `segregacao_funcoes`: a ação não foi feita; mostre o motivo;
      - 409 `ja_decidido`, `jogador_bloqueado`, `fora_das_regras`, `nome_em_uso`, `email_em_uso`,
        `bloquearia_voce`: mostre a mensagem (não são conflito de versão);
      - 413 `corpo_grande_demais` / `dados_grandes_demais`: dados grandes demais (imagens). Só o PUT de chave e as
        importações aceitam corpo acima de 1 MiB;
      - 429 `muitas_tentativas`: aguarde. 401 `nao_autenticado` é tratado pelo portão de login.

## Esqueleto de cada tipo de tela

### Listagem

```tsx
export default function Promocoes() {
  const { canEdit } = usePageAccess()
  const promos = useCollection<Promo>('campanhas.promocoes', seedPromos)
  const [editing, setEditing] = useState<Promo | null>(null)
  const columns: Column<Promo>[] = [ /* id, header, cell, sortValue, align */ ]
  return (
    <>
      <PageHeader actions={<Button variant="primary" icon={Plus} disabled={!canEdit} onClick={...}>Nova promoção</Button>} />
      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{/* KpiCard */}</section>
      <DataTable rows={...} columns={columns} rowKey={(r) => r.id} searchText={(r) => r.name}
        exportName="promocoes" onExport={(n) => audit('exportar', 'Promoções', `${n} linhas`)}
        rowActions={(r) => [{ label: 'Editar', icon: Pencil, onSelect: ... }, { divider: true }, { label: 'Excluir', icon: Trash2, danger: true, onSelect: ... }]}
        empty={{ title: 'Nenhuma promoção', description: '...', action: <Button .../> }} />
      <Drawer open={!!editing} ...>{/* formulário com Field */}</Drawer>
    </>
  )
}
```

### Configuração

```tsx
export default function SaldoBonus() {
  const form = useSettingsForm<Config>('campanhas.saldo-bonus', DEFAULTS, { entity: 'Saldo bônus', validate })
  return (
    <>
      <PageHeader />
      <FormFieldset readOnly={form.readOnly}>
        <SettingsSection title="..." description="...">
          <Field label="..." htmlFor="x" hint="..."><Input id="x" .../></Field>
          <Switch label="..." description="..." checked={...} onChange={...} />
          <RadioCards value={...} onChange={...} options={[...]} />
        </SettingsSection>
      </FormFieldset>
      <SaveBar form={form} />
    </>
  )
}
```

### Relatório

`PageHeader` com `DateRangePicker` nas ações → `KpiCard` (com `formula`) → gráficos
(`TrendChart`, `BarsChart`, `DonutChart`, `FunnelChart`, `Sparkline`) dentro de `Card` + `CardHeader` → tabela.

## Componentes disponíveis (`@/components/ui`)

| Grupo | Componentes |
| --- | --- |
| Página | `PageHeader`, `SettingsSection`, `FormGrid`, `FormFieldset`, `SaveBar`, `useSettingsForm`, `KpiCard`, `Formula`, `TextLink` |
| Ações | `Button` (primary, secondary, outline, ghost, danger, success, soft), `IconButton`, `Menu`, `Popover`, `Tooltip` |
| Formulário | `Field`, `Input`, `Textarea`, `Select`, `MoneyInput`, `NumberInput`, `Switch`, `Checkbox`, `RadioCards`, `Segmented`, `ChipFilter`, `ColorInput`, `TagInput`, `SecretField`, `ImageUpload`, `DateRangePicker` |
| Dados | `DataTable`, `Pagination`, `Badge`, `StatusBadge`, `Delta`, `DescriptionList`, `PersonCell`, `Avatar`, `Mono`, `Progress`, `SortableList`, `CopyButton` |
| Estrutura | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `Tabs` + `useTabParam`, `Modal`, `Drawer` |
| Estados | `EmptyState`, `Skeleton`, `Alert` |
| Retorno | `toast`, `confirm`, `confirmWithInput` |

## Dados compartilhados (`@/data/hooks`)

`usePlayers`, `useTransactions`, `useDeposits`, `useWithdrawals`, `useSportsBets`, `useGames`,
`useProviders`, `useAggregators`, `useAffiliates`, `useWebhookDestinations`, `useWebhookExecutions`
(no modo API, lista vazia quando o servidor não tem nada gravado).
Sessão e equipe: `useSession`, `useTeam`, `useRoles`, `useAudit` (`@/domain/session`).
Estado do site: `useAttackMode`, `useMaintenance`, `usePanelSecurity`, `OPEN_INVOICE` (`@/domain/system`).
Métricas diárias: `getDailySeries`, `sumSeries`, `gameStatsForPeriod` (`@/data/metrics`).
