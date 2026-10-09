// Países (código ISO 3166-1 alfa-2 e nome em português) e bloqueios de demonstração.
import { DAY, NOW, iso } from './now'

export type Region = 'Américas' | 'Europa' | 'África' | 'Ásia e Oriente Médio' | 'Oceania'

export interface Country {
  code: string
  name: string
  region: Region
}

const A: Region = 'Américas'
const E: Region = 'Europa'
const F: Region = 'África'
const S: Region = 'Ásia e Oriente Médio'
const O: Region = 'Oceania'

export const COUNTRIES: Country[] = [
  ['BR', 'Brasil', A], ['AR', 'Argentina', A], ['BO', 'Bolívia', A], ['CA', 'Canadá', A], ['CL', 'Chile', A], ['CO', 'Colômbia', A],
  ['CR', 'Costa Rica', A], ['CU', 'Cuba', A], ['DO', 'República Dominicana', A], ['EC', 'Equador', A], ['SV', 'El Salvador', A],
  ['US', 'Estados Unidos', A], ['GT', 'Guatemala', A], ['GY', 'Guiana', A], ['GF', 'Guiana Francesa', A], ['HT', 'Haiti', A], ['HN', 'Honduras', A],
  ['JM', 'Jamaica', A], ['MX', 'México', A], ['NI', 'Nicarágua', A], ['PA', 'Panamá', A], ['PY', 'Paraguai', A], ['PE', 'Peru', A],
  ['PR', 'Porto Rico', A], ['SR', 'Suriname', A], ['UY', 'Uruguai', A], ['VE', 'Venezuela', A],
  ['DE', 'Alemanha', E], ['AT', 'Áustria', E], ['BE', 'Bélgica', E], ['BG', 'Bulgária', E], ['HR', 'Croácia', E], ['DK', 'Dinamarca', E],
  ['SK', 'Eslováquia', E], ['SI', 'Eslovênia', E], ['ES', 'Espanha', E], ['EE', 'Estônia', E], ['FI', 'Finlândia', E], ['FR', 'França', E],
  ['GR', 'Grécia', E], ['NL', 'Holanda (Países Baixos)', E], ['HU', 'Hungria', E], ['IE', 'Irlanda', E], ['IT', 'Itália', E], ['LV', 'Letônia', E],
  ['LT', 'Lituânia', E], ['LU', 'Luxemburgo', E], ['MT', 'Malta', E], ['NO', 'Noruega', E], ['PL', 'Polônia', E], ['PT', 'Portugal', E],
  ['GB', 'Reino Unido', E], ['CZ', 'República Tcheca', E], ['RO', 'Romênia', E], ['RU', 'Rússia', E], ['SE', 'Suécia', E], ['CH', 'Suíça', E],
  ['TR', 'Turquia', E], ['UA', 'Ucrânia', E],
  ['ZA', 'África do Sul', F], ['AO', 'Angola', F], ['CV', 'Cabo Verde', F], ['EG', 'Egito', F], ['GH', 'Gana', F], ['GW', 'Guiné-Bissau', F],
  ['KE', 'Quênia', F], ['MA', 'Marrocos', F], ['MZ', 'Moçambique', F], ['NG', 'Nigéria', F], ['ST', 'São Tomé e Príncipe', F], ['SN', 'Senegal', F],
  ['AF', 'Afeganistão', S], ['SA', 'Arábia Saudita', S], ['KP', 'Coreia do Norte', S], ['KR', 'Coreia do Sul', S], ['CN', 'China', S],
  ['AE', 'Emirados Árabes Unidos', S], ['PH', 'Filipinas', S], ['IN', 'Índia', S], ['ID', 'Indonésia', S], ['IR', 'Irã', S], ['IQ', 'Iraque', S],
  ['IL', 'Israel', S], ['JP', 'Japão', S], ['LB', 'Líbano', S], ['MO', 'Macau', S], ['MY', 'Malásia', S], ['MM', 'Mianmar', S], ['PK', 'Paquistão', S],
  ['SG', 'Singapura', S], ['SY', 'Síria', S], ['TH', 'Tailândia', S], ['TL', 'Timor-Leste', S], ['VN', 'Vietnã', S],
  ['AU', 'Austrália', O], ['NZ', 'Nova Zelândia', O],
].map(([code, name, region]) => ({ code, name, region })) as Country[]

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

/** Regra da plataforma: fixa, vale para todas as operações e não pode ser removida. */
export const PLATFORM_BLOCKED: { code: string; reason: string }[] = [
  { code: 'KP', reason: 'Sanções internacionais e lista de ação do GAFI' },
  { code: 'IR', reason: 'Sanções internacionais e lista de ação do GAFI' },
  { code: 'MM', reason: 'Lista de ação do GAFI' },
  { code: 'SY', reason: 'Sanções internacionais' },
  { code: 'CU', reason: 'Sanções internacionais' },
  { code: 'US', reason: 'Provedoras de jogos sem licença no país' },
]

export interface BlockedCountry {
  id: string
  code: string
  reason: string
  createdAt: string
  createdBy: string
}

export function seedBlockedCountries(): BlockedCountry[] {
  const at = (d: number) => iso(new Date(NOW.getTime() - d * DAY))
  return [
    { id: 'GB', code: 'GB', reason: 'Exige licença local da Gambling Commission', createdAt: at(388), createdBy: 'Daniel Carius' },
    { id: 'FR', code: 'FR', reason: 'Exige licença local (ANJ)', createdAt: at(388), createdBy: 'Daniel Carius' },
    { id: 'ES', code: 'ES', reason: 'Exige licença local', createdAt: at(240), createdBy: 'Rafael Lima' },
    { id: 'PT', code: 'PT', reason: 'Exige licença local (SRIJ)', createdAt: at(240), createdBy: 'Rafael Lima' },
    { id: 'AR', code: 'AR', reason: 'Pico de cadastros suspeitos vindos do país', createdAt: at(17), createdBy: 'Beatriz Souza' },
  ]
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Tentativas de acesso barradas nos últimos 30 dias (simulado, determinístico). */
export function blockedHits30d(code: string): number {
  const base: Record<string, number> = { US: 1840, AR: 1312, PT: 964, PY: 0, GB: 211, ES: 187, FR: 96 }
  return base[code] ?? (hash(code) % 60)
}
