# 🦁 Zoo Mundo — MVP

Jogo educativo infantil 2D em visão de cima (top-down). A criança explora um
zoológico dividido por regiões do mundo, encontra animais, descobre de onde eles
vêm e ajuda os que estão perdidos a voltarem para casa.

> **Explore. Descubra. Proteja.**

## Como jogar

| Ação | Desktop | Celular / tablet |
|------|---------|------------------|
| Andar | `WASD` ou setas | joystick virtual (metade esquerda da tela) |
| Conversar com o animal | `E`, `Espaço`, `Enter` ou clique no animal | botão 👋 **Falar** ou toque no animal |
| Passaporte | `P` | botão 🛂 |
| Meu Zoológico | `Z` | botão 🦓 |
| Fechar janela | `Esc` | botão ✕ |

## Como rodar

Basta abrir `index.html` no navegador (funciona em `file://`, sem build e sem
dependências). Para servir por HTTP:

```bash
cd zoo-mundo
python3 -m http.server 8080
# abra http://localhost:8080
```

O progresso é salvo automaticamente no `localStorage` (chave `zoomundo.save.v1`).

## Loop principal

```
EXPLORAR → ENCONTRAR ANIMAL → IDENTIFICAR → DESCOBRIR A ORIGEM
        → LEVAR PARA A REGIÃO CORRETA → GANHAR PONTOS → DESBLOQUEAR REGIÕES
```

- **Pontuação:** 100 por animal novo, +25 por acertar cada pergunta de primeira,
  +50 por resgatar um animal perdido.
- **Progressão:** 3 animais descobertos abrem a **África**; 9 abrem a **Austrália**.
  Brasil, Ásia e Região Polar aparecem no mapa como áreas bloqueadas
  (“Explore mais para desbloquear esta região.”).
- **Passaporte:** progresso por região e carimbo `REGIÃO COMPLETA` com confete.
- **Meu Zoológico:** 12 cards; os animais não descobertos aparecem como silhueta.

## Mapa

O mundo é uma grade de células de 1200 × 900 px (3 colunas × 2 linhas):

```
┌──────────┬──────────┬──────────┐
│  Brasil  │   Ásia   │  Polar   │   (bloqueadas no MVP)
├──────────┼──────────┼──────────┤
│  África  │  Praça   │Austrália │
└──────────┴──────────┴──────────┘
```

Cada região tem paleta, vegetação e chão próprios (savana, outback, floresta,
bambuzal, gelo). As passagens entre regiões só abrem quando as duas estão
liberadas — caso contrário o portão aparece fechado com um cadeado.

## Estrutura do código

```
zoo-mundo/
├── index.html               # estrutura das telas e ordem dos scripts
├── css/estilo.css           # visual (Fredoka + Nunito, botões grandes, cards)
├── assets/audio/            # opcional: arquivos de som (veja LEIA-ME.md)
└── js/
    ├── data/                # DADOS separados da interface
    │   ├── animais.js       # 12 animais: nome, sprite, casa, habitat, curiosidade...
    │   ├── regioes.js       # 6 regiões: posição na grade, paleta, regra de desbloqueio
    │   └── personagens.js   # 4 personagens jogáveis
    ├── core/
    │   ├── utils.js         # matemática, cores, RNG com semente, colisão
    │   ├── audio.js         # sons sintetizados + suporte a arquivos
    │   └── estado.js        # progresso, pontuação e save no navegador
    ├── render/
    │   ├── sprites-animais.js     # os 12 animais desenhados em vetor (canvas)
    │   ├── sprites-personagem.js  # personagem em 4 direções com animação
    │   └── cenario.js             # árvores, pedras, placas, portões, fonte
    ├── game/
    │   ├── mundo.js         # monta o mapa, o chão, o cenário e as barreiras
    │   ├── entrada.js       # teclado, toque e joystick virtual
    │   └── jogo.js          # câmera, loop, animais, partículas, minimapa
    ├── ui/
    │   ├── comum.js         # modais, canvas de sprites, confete, avisos
    │   ├── encontro.js      # quiz, resgate e recompensas
    │   ├── passaporte.js    # progresso por região e carimbos
    │   ├── colecao.js       # “Meu Zoológico”
    │   └── telas.js         # tela inicial, escolha de personagem, HUD
    └── main.js              # liga tudo
```

Nenhuma imagem externa é usada: todos os personagens, animais e cenários são
desenhados por código no canvas, então o jogo abre offline e pesa poucos KB.

## Como estender

**Novo animal** — acrescente um objeto em `js/data/animais.js`:

```js
{
  id: 'tucano', nome: 'Tucano', artigo: 'o', emoji: '🦜', sprite: 'tucano',
  casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta tropical',
  alimentacao: 'Frugívoro', curiosidade: 'O bico enorme ajuda a refrescar o corpo.',
  som: 'sopro',
  spawn: { regiao: 'praca', x: 0.4, y: 0.6 }   // x/y de 0 a 1 dentro da região
}
```

Se `spawn.regiao` for diferente de `casa`, o animal começa **perdido** e o jogador
poderá levá-lo para casa. Depois crie o desenho `tucano` em
`js/render/sprites-animais.js` (funções recebem `ctx` com os pés em `0,0`).

**Nova região** — acrescente em `js/data/regioes.js` com `col`/`row` livres na
grade, uma paleta, um `bioma` (a receita de cenário vem de `RECEITAS` em
`js/game/mundo.js`) e a regra de desbloqueio:

```js
unlock: { tipo: 'descobertas', valor: 12 }   // ou { tipo: 'embreve' } / { tipo: 'inicial' }
```

**Novos quizzes** — as perguntas são geradas a partir dos dados (nome do animal e
região de origem), então cada animal novo já entra no quiz automaticamente.

## Experiência da criança

- Textos curtos, botões grandes, ícones claros e feedback sempre positivo.
- Nunca aparece “errado”: as respostas incorretas mostram
  *“Quase! Esse animal vive em outro lugar.”* e o jogador tenta de novo.
- Comemorações com confete, carimbos e estrelinhas a cada conquista.
