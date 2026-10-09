// Textos legais publicados no site, com histórico de versões.
// Cada documento guarda o texto atual e as edições que levam de uma versão à anterior.
import { DAY, NOW, iso } from './now'
import { diffStats, type LegalDoc, type LegalDocId, type LegalVersion } from '@/domain/config1-textos'

interface HistoryStep {
  daysAgo: number
  author: string
  summary: string
  reaccept: boolean
  /** edições que transformam esta versão na anterior */
  revert?: [string, string][]
}

interface DocSpec {
  id: LegalDocId
  title: string
  slug: string
  description: string
  current: string
  /** da versão atual para a mais antiga */
  history: HistoryStep[]
}

const TERMOS = `# Termos de uso

Estes Termos regulam o uso do site **X2Win** e de todos os produtos oferecidos nele: apostas esportivas de quota fixa, cassino on-line e cassino ao vivo. Ao criar uma conta, você declara que leu e aceita estes Termos.

## 1. Quem pode jogar

- Somente maiores de **18 (dezoito) anos**, residentes no Brasil e com CPF regular.
- Cada pessoa pode ter uma única conta. Contas duplicadas são encerradas e os saldos ficam retidos para análise.
- É proibido jogar em nome de terceiros ou permitir que outra pessoa use a sua conta.
- Não podem apostar: sócios, administradores e funcionários da operadora, agentes públicos que atuam na regulação do setor e pessoas que possam influenciar o resultado de eventos esportivos.

## 2. Conta e verificação de identidade

Para depositar, jogar e sacar, você precisa confirmar seus dados. Podemos pedir documento com foto, selfie e comprovante de endereço a qualquer momento.

1. O nome do titular da conta precisa ser o mesmo da conta bancária usada no PIX.
2. Depósitos e saques são feitos somente por PIX, em conta de mesma titularidade.
3. Dados falsos ou de terceiros levam ao encerramento da conta.

## 3. Depósitos e saques

- Depósito mínimo: R$ 10,00. Saque mínimo: R$ 20,00.
- O saque é pago em até 2 dias úteis após a aprovação. A maioria é paga no mesmo dia.
- Valores de bônus só podem ser sacados depois de cumprido o rollover da promoção.
- Podemos reter um saque enquanto houver verificação de segurança pendente.

## 4. Apostas esportivas

As apostas são aceitas pelas odds exibidas no momento da confirmação. Uma aposta confirmada não pode ser cancelada pelo jogador. Em caso de erro evidente de odd ou de evento cancelado, a aposta é anulada e o valor devolvido.

## 5. Jogo responsável

Oferecemos limites de depósito, de perda e de tempo, pausa e autoexclusão em **Minha conta › Jogo responsável**. Leia a nossa [Política de jogo responsável](https://x2win.bet.br/jogo-responsavel).

## 6. Encerramento da conta

Você pode encerrar a sua conta a qualquer momento pelo suporte. O saldo real disponível é devolvido por PIX para a conta de mesma titularidade.

## 7. Alterações destes Termos

Quando mudarmos estes Termos, avisaremos no site. Mudanças importantes exigem novo aceite no seu próximo acesso.

## 8. Lei aplicável

Estes Termos seguem a legislação brasileira, em especial a Lei nº 14.790/2023 e as normas da Secretaria de Prêmios e Apostas do Ministério da Fazenda (SPA/MF). Fica eleito o foro do domicílio do apostador.
`

const PRIVACIDADE = `# Política de privacidade

A X2Win trata os seus dados pessoais conforme a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018). Esta Política explica quais dados coletamos, por que e por quanto tempo.

## 1. Dados que coletamos

- **Cadastro:** nome, CPF, data de nascimento, e-mail, celular e endereço.
- **Verificação de identidade:** foto do documento e selfie.
- **Uso do site:** endereço IP, dispositivo, navegador, páginas visitadas e histórico de apostas.
- **Pagamentos:** chave PIX e dados da conta bancária de mesma titularidade.

## 2. Para que usamos

1. Cumprir obrigações legais e regulatórias, como a verificação de idade e a prevenção à lavagem de dinheiro.
2. Executar o contrato: processar apostas, depósitos e saques.
3. Prevenir fraudes e proteger a sua conta.
4. Enviar comunicações de marketing, somente com o seu consentimento.

## 3. Com quem compartilhamos

Compartilhamos dados apenas com autoridades e órgãos reguladores, quando a lei exige; com instituições de pagamento que processam o PIX; com provedores de verificação de identidade; e com fornecedores de tecnologia contratados sob dever de sigilo.

## 4. Por quanto tempo guardamos

Os dados de cadastro e as transações são guardados por no mínimo 5 (cinco) anos após o encerramento da conta, para cumprir obrigações legais. Dados de marketing são apagados quando você retira o consentimento.

## 5. Seus direitos

Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados, além de revogar o consentimento, pelo e-mail [privacidade@x2win.bet.br](mailto:privacidade@x2win.bet.br). Respondemos em até 15 dias.

## 6. Cookies

Usamos cookies essenciais para o funcionamento do site e, com o seu consentimento, cookies de medição e publicidade. Você pode mudar a escolha a qualquer momento no rodapé do site.

## 7. Encarregado de dados (DPO)

Equipe de Privacidade X2Win · [dpo@x2win.bet.br](mailto:dpo@x2win.bet.br)
`

const JOGO_RESPONSAVEL = `# Política de jogo responsável

Apostar deve ser diversão, nunca uma forma de ganhar dinheiro ou de resolver problemas financeiros. A X2Win segue a Lei nº 14.790/2023 e as portarias da SPA/MF e oferece ferramentas para você manter o controle.

## Ferramentas disponíveis

- **Limite de depósito:** diário, semanal ou mensal.
- **Limite de perda:** o quanto você aceita perder em um período.
- **Alerta de tempo de sessão:** um aviso a cada intervalo de jogo.
- **Pausa:** 24 horas, 7 dias ou 30 dias sem acesso a apostas.
- **Autoexclusão:** de 6 meses a permanente. Durante a autoexclusão, a conta não pode ser reaberta.

Diminuir um limite vale na hora. Aumentar um limite só vale depois de 72 horas, para você ter tempo de pensar.

## Sinais de alerta

1. Apostar mais do que planejou ou para recuperar perdas.
2. Esconder de familiares quanto tempo ou dinheiro gasta em apostas.
3. Pegar dinheiro emprestado para apostar.
4. Sentir ansiedade ou irritação quando não está jogando.

> Se você se identificou com algum desses sinais, faça uma pausa e procure ajuda.

## Onde buscar ajuda

- Jogadores Anônimos (JA): grupos de apoio gratuitos em todo o país.
- Centro de Valorização da Vida (CVV): ligue **188**, 24 horas, gratuito.
- Nosso suporte: [suporte@x2win.bet.br](mailto:suporte@x2win.bet.br)

## Proteção de menores

O cadastro é proibido para menores de 18 anos. Confirmamos a idade no cadastro e na verificação de identidade. Recomendamos o uso de controle parental nos dispositivos da família.
`

const BONUS = `# Política de bônus

Esta Política vale para todo bônus, giro grátis e cashback oferecido pela X2Win. Cada promoção pode ter regras próprias, que prevalecem sobre esta Política.

## 1. Como o bônus funciona

- O bônus é creditado no **saldo bônus**, separado do saldo real.
- Por padrão, as apostas usam primeiro o saldo bônus e depois o saldo real.
- Só é possível ter um bônus de depósito ativo por vez.

## 2. Rollover

O rollover é quanto você precisa apostar para transformar o bônus em saldo real. Exemplo: bônus de R$ 100,00 com rollover de 10x exige R$ 1.000,00 em apostas.

1. Slots contam 100% do valor apostado.
2. Jogos ao vivo e de mesa contam 10%.
3. Apostas esportivas contam 100% quando a odd for igual ou maior que 1,50.
4. Jogos crash contam somente quando a rodada termina em perda total ou com ganho de pelo menos 2x.

## 3. Prazo

O bônus não convertido expira em 30 dias. Ao expirar, o saldo bônus é zerado e os ganhos obtidos com ele são removidos.

## 4. Aposta máxima

Enquanto houver bônus ativo, a aposta máxima é de R$ 25,00 por rodada ou por bilhete.

## 5. Cancelamento

Você pode cancelar um bônus ativo a qualquer momento em **Minha conta › Bônus**. O saldo bônus e os ganhos vinculados a ele são removidos. O saldo real não é afetado.

## 6. Abuso

Contas ligadas entre si, padrões de aposta sem risco ou múltiplas contas para receber bônus levam ao cancelamento dos bônus e dos ganhos, e podem levar ao encerramento das contas.
`

const SPECS: DocSpec[] = [
  {
    id: 'termos',
    title: 'Termos de uso',
    slug: '/termos-de-uso',
    description: 'Regras de uso do site, da conta, de depósitos, saques e apostas.',
    current: TERMOS,
    history: [
      {
        daysAgo: 38,
        author: 'Daniel Carius',
        summary: 'Lei aplicável passa a citar a Lei 14.790/2023 e as normas da SPA/MF; foro no domicílio do apostador.',
        reaccept: true,
        revert: [
          [
            'Estes Termos seguem a legislação brasileira, em especial a Lei nº 14.790/2023 e as normas da Secretaria de Prêmios e Apostas do Ministério da Fazenda (SPA/MF). Fica eleito o foro do domicílio do apostador.',
            'Estes Termos seguem a legislação brasileira. Fica eleito o foro da comarca de São Paulo/SP.',
          ],
          [' Mudanças importantes exigem novo aceite no seu próximo acesso.', ''],
        ],
      },
      {
        daysAgo: 96,
        author: 'Beatriz Souza',
        summary: 'PIX só em conta de mesma titularidade e retenção de saque durante verificação de segurança.',
        reaccept: false,
        revert: [
          ['2. Depósitos e saques são feitos somente por PIX, em conta de mesma titularidade.', '2. Depósitos e saques são feitos por PIX.'],
          ['- Podemos reter um saque enquanto houver verificação de segurança pendente.\n', ''],
        ],
      },
      {
        daysAgo: 181,
        author: 'Daniel Carius',
        summary: 'Proíbe apostas de sócios, funcionários, agentes públicos do setor e pessoas que influenciam resultados.',
        reaccept: true,
        revert: [['- Não podem apostar: sócios, administradores e funcionários da operadora, agentes públicos que atuam na regulação do setor e pessoas que possam influenciar o resultado de eventos esportivos.\n', '']],
      },
      {
        daysAgo: 252,
        author: 'Rafael Lima',
        summary: 'Saque mínimo sobe de R$ 10,00 para R$ 20,00.',
        reaccept: true,
        revert: [['Saque mínimo: R$ 20,00.', 'Saque mínimo: R$ 10,00.']],
      },
      {
        daysAgo: 333,
        author: 'Daniel Carius',
        summary: 'Inclui a seção de apostas esportivas (odds, cancelamento e anulação).',
        reaccept: false,
        revert: [
          ['apostas esportivas de quota fixa, cassino on-line e cassino ao vivo', 'cassino on-line e cassino ao vivo'],
          [
            '## 4. Apostas esportivas\n\nAs apostas são aceitas pelas odds exibidas no momento da confirmação. Uma aposta confirmada não pode ser cancelada pelo jogador. Em caso de erro evidente de odd ou de evento cancelado, a aposta é anulada e o valor devolvido.\n\n',
            '',
          ],
          ['## 5. Jogo responsável', '## 4. Jogo responsável'],
          ['## 6. Encerramento', '## 5. Encerramento'],
          ['## 7. Alterações', '## 6. Alterações'],
          ['## 8. Lei aplicável', '## 7. Lei aplicável'],
        ],
      },
      { daysAgo: 412, author: 'Daniel Carius', summary: 'Versão inicial publicada na abertura do site.', reaccept: false },
    ],
  },
  {
    id: 'privacidade',
    title: 'Política de privacidade',
    slug: '/privacidade',
    description: 'Quais dados pessoais são tratados, para quê e por quanto tempo (LGPD).',
    current: PRIVACIDADE,
    history: [
      {
        daysAgo: 21,
        author: 'Beatriz Souza',
        summary: 'Nova seção de cookies, com escolha do jogador no rodapé do site.',
        reaccept: true,
        revert: [
          [
            '## 6. Cookies\n\nUsamos cookies essenciais para o funcionamento do site e, com o seu consentimento, cookies de medição e publicidade. Você pode mudar a escolha a qualquer momento no rodapé do site.\n\n',
            '',
          ],
          ['## 7. Encarregado', '## 6. Encarregado'],
        ],
      },
      {
        daysAgo: 163,
        author: 'Daniel Carius',
        summary: 'Prazo de guarda dos dados passa a ser de no mínimo 5 anos após o encerramento da conta.',
        reaccept: false,
        revert: [
          [
            'Os dados de cadastro e as transações são guardados por no mínimo 5 (cinco) anos após o encerramento da conta, para cumprir obrigações legais.',
            'Os dados de cadastro e as transações são guardados pelo prazo exigido em lei.',
          ],
        ],
      },
      {
        daysAgo: 298,
        author: 'Daniel Carius',
        summary: 'Inclui a selfie na verificação de identidade e os provedores de verificação.',
        reaccept: false,
        revert: [
          ['- **Verificação de identidade:** foto do documento e selfie.', '- **Verificação de identidade:** foto do documento.'],
          [' com provedores de verificação de identidade; e', ' e'],
        ],
      },
      { daysAgo: 412, author: 'Daniel Carius', summary: 'Versão inicial publicada na abertura do site.', reaccept: false },
    ],
  },
  {
    id: 'jogo-responsavel',
    title: 'Jogo responsável',
    slug: '/jogo-responsavel',
    description: 'Ferramentas de controle, sinais de alerta e onde buscar ajuda.',
    current: JOGO_RESPONSAVEL,
    history: [
      {
        daysAgo: 58,
        author: 'Beatriz Souza',
        summary: 'Aumento de limite passa a valer só depois de 72 horas (antes, 24 horas).',
        reaccept: false,
        revert: [
          [
            'Diminuir um limite vale na hora. Aumentar um limite só vale depois de 72 horas, para você ter tempo de pensar.',
            'Diminuir um limite vale na hora. Aumentar um limite vale depois de 24 horas.',
          ],
        ],
      },
      {
        daysAgo: 204,
        author: 'Daniel Carius',
        summary: 'Inclui limite de perda e alerta de tempo de sessão.',
        reaccept: false,
        revert: [
          ['- **Limite de perda:** o quanto você aceita perder em um período.\n', ''],
          ['- **Alerta de tempo de sessão:** um aviso a cada intervalo de jogo.\n', ''],
        ],
      },
      { daysAgo: 412, author: 'Daniel Carius', summary: 'Versão inicial publicada na abertura do site.', reaccept: false },
    ],
  },
  {
    id: 'bonus',
    title: 'Política de bônus',
    slug: '/politica-de-bonus',
    description: 'Rollover, prazo, aposta máxima e cancelamento de bônus.',
    current: BONUS,
    history: [
      {
        daysAgo: 12,
        author: 'Camila Rocha',
        summary: 'Jogador pode cancelar um bônus ativo em Minha conta › Bônus.',
        reaccept: false,
        revert: [
          [
            '## 5. Cancelamento\n\nVocê pode cancelar um bônus ativo a qualquer momento em **Minha conta › Bônus**. O saldo bônus e os ganhos vinculados a ele são removidos. O saldo real não é afetado.\n\n',
            '',
          ],
          ['## 6. Abuso', '## 5. Abuso'],
        ],
      },
      {
        daysAgo: 131,
        author: 'Camila Rocha',
        summary: 'Prazo do bônus não convertido sobe de 15 para 30 dias.',
        reaccept: false,
        revert: [['expira em 30 dias', 'expira em 15 dias']],
      },
      {
        daysAgo: 219,
        author: 'Rafael Lima',
        summary: 'Aposta máxima com bônus ativo cai de R$ 50,00 para R$ 25,00.',
        reaccept: true,
        revert: [['R$ 25,00 por rodada', 'R$ 50,00 por rodada']],
      },
      {
        daysAgo: 309,
        author: 'Camila Rocha',
        summary: 'Define quando os jogos crash contam para o rollover.',
        reaccept: false,
        revert: [['4. Jogos crash contam somente quando a rodada termina em perda total ou com ganho de pelo menos 2x.\n', '']],
      },
      { daysAgo: 401, author: 'Daniel Carius', summary: 'Versão inicial publicada na abertura do site.', reaccept: false },
    ],
  },
]

function applyEdits(text: string, edits: [string, string][] = []): string {
  let out = text
  for (const [from, to] of edits) {
    if (!out.includes(from) && import.meta.env?.DEV) console.warn('[textos-legais] edição não encontrada:', from.slice(0, 60))
    out = out.replace(from, to)
  }
  return out
}

function buildDoc(spec: DocSpec): LegalDoc {
  // conteúdos da versão atual para a mais antiga
  const contents: string[] = [spec.current]
  for (let k = 0; k < spec.history.length - 1; k++) contents.push(applyEdits(contents[k], spec.history[k].revert))
  const n = spec.history.length
  const versions: LegalVersion[] = []
  for (let idx = n - 1; idx >= 0; idx--) {
    const step = spec.history[idx]
    const content = contents[idx]
    const prev = idx < n - 1 ? contents[idx + 1] : ''
    const stats = diffStats(prev, content)
    versions.push({
      version: n - idx,
      publishedAt: iso(new Date(NOW.getTime() - step.daysAgo * DAY)),
      author: step.author,
      summary: step.summary,
      content,
      requireReaccept: step.reaccept,
      added: stats.added,
      removed: stats.removed,
    })
  }
  return { id: spec.id, title: spec.title, slug: spec.slug, description: spec.description, versions }
}

export function seedLegalDocs(): LegalDoc[] {
  return SPECS.map(buildDoc)
}
