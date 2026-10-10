// Gateways e contas de pagamento (demonstração). Segredos são valores DEMO.
// Modo API, sem nada gravado: os gateways integrados sem credencial e desligados, só as contas
// principais (desligadas) e roteamento vazio. Os valores DEMO nunca vão para o servidor.
import { GATEWAY_NAMES } from '@/domain/system'
import { callbackUrlFor, type Gateway, type GatewayAccount, type GatewayId, type RoutingConfig } from '@/domain/config2-gateways'
import { apiValue } from './demo'
import { DAY, NOW, iso } from './now'

export const GATEWAY_KEYS = {
  gateways: 'config.gateways',
  accounts: 'config.gateways.contas',
  routing: 'config.gateways.roteamento',
} as const

const ago = (d: number) => iso(new Date(NOW.getTime() - d * DAY))

const IDS: GatewayId[] = ['pagflex', 'pixnow', 'brpay']

export function seedGateways(): Gateway[] {
  return GATEWAY_NAMES.map((name, i) => ({
    id: IDS[i],
    name,
    primary: i === 0,
    active: i !== 2,
    environment: 'producao' as const,
    clientId: ['pf_prod_x2win_8812', 'pn_x2win_prod_41', 'brp_x2win_0193'][i],
    secret: `DEMO-${IDS[i]}-secret-${['k29d', 'r7a1', 'm0q8'][i]}`,
    webhookSecret: `DEMO-${IDS[i]}-webhook-${['s81x', 'v2c4', 'h6n3'][i]}`,
    updatedAt: ago([12, 30, 95][i]),
    updatedBy: 'Daniel Carius',
  }))
}

function account(id: string, gatewayId: GatewayId, name: string, main: boolean, active: boolean, days: number, holder: string, clientId = '', secret = ''): GatewayAccount {
  return {
    id,
    gatewayId,
    name,
    main,
    active,
    clientId,
    secret,
    callbackUrl: callbackUrlFor(gatewayId, id, main),
    createdAt: ago(days),
    holder,
  }
}

export function seedGatewayAccounts(): GatewayAccount[] {
  return [
    account('ga-pf-main', 'pagflex', 'Conta principal', true, true, 380, 'X2Win Entretenimento Digital Ltda.'),
    account('ga-pf-2', 'pagflex', 'Conta 2 (alto volume)', false, true, 140, 'X2Win Entretenimento Digital Ltda.', 'pf_acc_x2win_hv02', 'DEMO-pagflex-acc2-secret-p0t5'),
    account('ga-pf-3', 'pagflex', 'Conta 3 (VIP)', false, false, 45, 'X2Win Entretenimento Digital Ltda.', 'pf_acc_x2win_vip3', 'DEMO-pagflex-acc3-secret-w8e1'),
    account('ga-pn-main', 'pixnow', 'Conta principal', true, true, 210, 'X2Win Entretenimento Digital Ltda.'),
    account('ga-br-main', 'brpay', 'Conta principal', true, true, 95, 'X2Win Entretenimento Digital Ltda.'),
  ]
}

export const DEFAULT_ROUTING: RoutingConfig = apiValue<RoutingConfig>(
  {
    deposits: { 'ga-pf-main': 60, 'ga-pf-2': 25, 'ga-pn-main': 15 },
    fallback: ['ga-pf-main', 'ga-pn-main', 'ga-pf-2'],
    withdrawalAccountId: 'ga-pf-main',
    withdrawalFallback: true,
  },
  (): RoutingConfig => ({ deposits: {}, fallback: [], withdrawalAccountId: 'ga-pf-main', withdrawalFallback: true }),
)

const MAIN_ACCOUNT: Record<GatewayId, string> = { pagflex: 'ga-pf-main', pixnow: 'ga-pn-main', brpay: 'ga-br-main' }

apiValue(seedGateways, (): Gateway[] =>
  GATEWAY_NAMES.map((name, i) => ({
    id: IDS[i],
    name,
    primary: i === 0,
    active: false,
    environment: 'producao' as const,
    clientId: '',
    secret: '',
    webhookSecret: '',
    updatedAt: iso(NOW),
    updatedBy: '',
  })),
)
// modo API: o titular vem do cadastro da operação (nunca a razão social da demonstração)
apiValue(seedGatewayAccounts, (): GatewayAccount[] => IDS.map((id) => account(MAIN_ACCOUNT[id], id, 'Conta principal', true, false, 0, '')))

