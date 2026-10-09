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
   - toda ação relevante chama `audit(acao, entidade, resumo)` (de `@/domain/session`);
   - retorno ao usuário com `toast.success/error/info/warning`;
   - ação destrutiva ou irreversível pede `confirm({...})` ou `confirmWithInput({...})`
     (excluir, banir, ligar modo de ataque, enviar disparo, pagar).
5. **Permissões.** `const { canEdit, can } = usePageAccess()`. Sem `canEdit`: botões de criar/editar/excluir
   desabilitados (com `title` explicando), formulário em `<FormFieldset readOnly={!canEdit}>`.
   Permissões especiais: `can('saques.aprovar')`, `can('antifraude.banir')` etc. (veja `extraPerms` em `nav.ts`).
6. **Dados sensíveis (LGPD).** CPF, celular, e-mail e PIX aparecem mascarados em listas
   (`maskCpf`, `maskPhone`, `maskEmail`). Revelar exige permissão e registra `audit('revelar', ...)`.
   Segredos: use `<SecretField>` (mascarado, só substitui).
7. **Acessibilidade.** Todo campo dentro de `<Field label htmlFor>`; botão só com ícone usa `<IconButton label>`;
   status nunca só por cor (badge com texto). Tabelas com `caption`.
8. **Responsivo.** Grades `sm:grid-cols-2 xl:grid-cols-4`; nada de largura fixa em px para containers.
   Tabelas largas rolam dentro do cartão (o `DataTable` já faz isso).
9. **Regras de negócio** que valeriam no servidor ficam em funções puras em `src/domain/<modulo>.ts`
   (validação, cálculo), chamadas pela tela. Assim a recriação com back-end reaproveita a lógica.
10. **Sem arquivos compartilhados.** Não edite `components/ui`, `components/charts`, `nav.ts`, `routes.tsx`,
    `domain/session.tsx`, `domain/roles.ts`, `lib/*`. Se precisar de um componente novo, crie em
    `src/pages/<modulo>/_shared.tsx`. Dados novos em `src/data/<modulo>.ts` e regras em `src/domain/<modulo>.ts`.

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
`useProviders`, `useAggregators`, `useAffiliates`, `useWebhookDestinations`, `useWebhookExecutions`.
Sessão e equipe: `useSession`, `useTeam`, `useRoles`, `useAudit` (`@/domain/session`).
Estado do site: `useAttackMode`, `useMaintenance`, `usePanelSecurity`, `OPEN_INVOICE` (`@/domain/system`).
Métricas diárias: `getDailySeries`, `sumSeries`, `gameStatsForPeriod` (`@/data/metrics`).
