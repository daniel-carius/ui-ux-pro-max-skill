# 🦁 Zoo Mundo — MVP

Jogo educativo infantil 2D em visão de cima (top-down). A criança explora um
zoológico dividido por regiões do mundo, encontra animais, descobre de onde eles
vêm e leva os que estão perdidos de volta para casa — andando com eles pelo mapa.

> **Explore. Descubra. Proteja.**

## Como jogar

| Ação | Desktop | Celular / tablet |
|------|---------|------------------|
| Andar | `WASD` ou setas | joystick virtual (metade esquerda da tela) |
| Conversar com o animal | `E`, `Espaço`, `Enter` ou clique no animal | botão 👋 **Falar** ou toque no animal |
| Ouvir o som do animal | botão 🔊 **Ouvir** na janela do animal | botão 🔊 **Ouvir** |
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

Para gerar uma versão em **um único arquivo HTML** (útil para mandar por
mensagem ou publicar em qualquer lugar):

```bash
python3 build-arquivo-unico.py            # cria zoo-mundo-completo.html
```

## Loop principal

```
EXPLORAR → ENCONTRAR ANIMAL → IDENTIFICAR → DESCOBRIR A ORIGEM
        → CAMINHAR COM ELE ATÉ A REGIÃO CERTA → GANHAR PONTOS → DESBLOQUEAR REGIÕES
```

Ao aceitar “🐾 Vamos juntos!”, o animal passa a **andar atrás do jogador** (com um
coraçãozinho na cabeça) e entra no painel *Levando para casa*. Ele só chega em
casa quando a criança realmente caminha até a região dele — aí vêm o confete, os
pontos e o registro no passaporte. Vários animais podem acompanhar ao mesmo
tempo, formando uma fila. Se a região dele ainda estiver fechada, ele continua
junto até você desbloqueá-la; e dá para deixá-lo em qualquer lugar falando com
ele de novo.

- **Pontuação:** 100 por animal novo, +25 por acertar cada pergunta de primeira,
  +50 quando o animal chega em casa.
- **Progressão:** 3 animais descobertos abrem a **África**, 8 a **Austrália**,
  14 o **Brasil**, 20 a **Ásia** e 26 a **Região Polar**. As regiões fechadas
  aparecem no mapa com névoa, portão trancado e uma placa dizendo quantos animais
  faltam.
- **Passaporte:** progresso por região e carimbo `REGIÃO COMPLETA` com confete.
- **Meu Zoológico:** 30 cards; os animais não descobertos aparecem como silhueta.
- **Som de cada animal:** o botão 🔊 **Ouvir** toca a voz do bicho (rugido, pio,
  bufo...) na janela do encontro e na ficha da coleção.

## Mapa

O mundo é uma grade de células de 1200 × 900 px (3 colunas × 2 linhas):

```
┌──────────┬──────────┬──────────┐
│  Brasil  │   Ásia   │  Polar   │
├──────────┼──────────┼──────────┤
│  África  │  Praça   │Austrália │
└──────────┴──────────┴──────────┘
```

São **30 animais**, seis por região:

| Região | Animais |
|--------|---------|
| 🦁 África | Leão, Elefante, Girafa, Zebra, Rinoceronte, Hipopótamo |
| 🦘 Austrália | Canguru, Coala, Wombat, Emu, Diabo-da-Tasmânia, Ornitorrinco |
| 🦜 Brasil | Onça-pintada, Arara-azul, Tucano, Preguiça, Capivara, Macaco-prego |
| 🐼 Ásia | Panda-gigante, Tigre, Panda-vermelho, Orangotango, Pavão, Camelo |
| 🐧 Polar | Urso-polar, Pinguim, Foca, Morsa, Raposa-do-ártico, Rena |

Metade deles (15) começa na região errada, esperando uma carona até em casa.

Cada região tem paleta, vegetação e chão próprios (savana, outback, floresta,
bambuzal, gelo). As passagens entre regiões só abrem quando as duas estão
liberadas — caso contrário o portão aparece fechado com um cadeado.

## Estrutura do código

```
zoo-mundo/
├── index.html               # estrutura das telas e ordem dos scripts
├── build-arquivo-unico.py   # junta tudo em um HTML só (opcional)
├── css/estilo.css           # visual (Fredoka + Nunito, botões grandes, cards)
├── assets/audio/            # opcional: arquivos de som (veja LEIA-ME.md)
└── js/
    ├── data/                # DADOS separados da interface
    │   ├── animais.js       # 30 animais: nome, sprite, casa, habitat, curiosidade...
    │   ├── regioes.js       # 6 regiões: posição na grade, paleta, regra de desbloqueio
    │   └── personagens.js   # 4 personagens jogáveis
    ├── core/
    │   ├── utils.js         # matemática, cores, RNG com semente, colisão
    │   ├── audio.js         # sons sintetizados + suporte a arquivos
    │   └── estado.js        # progresso, pontuação e save no navegador
    ├── render/
    │   ├── sprites-animais.js     # animais da África e da Austrália (vetor em canvas)
    │   ├── sprites-animais-mundo.js  # animais do Brasil, da Ásia e do Polar
    │   ├── sprites-personagem.js  # personagem em 4 direções com animação
    │   └── cenario.js             # árvores, pedras, placas, portões, fonte
    ├── game/
    │   ├── mundo.js         # monta o mapa, o chão, o cenário e as barreiras
    │   ├── entrada.js       # teclado, toque e joystick virtual
    │   └── jogo.js          # câmera, loop, animais, comitiva, partículas, minimapa
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

Se `spawn.regiao` for diferente de `casa`, o animal começa **perdido** e vai
querer uma carona até em casa. Depois crie o desenho em
`js/render/sprites-animais-mundo.js` com `ZM.SpritesAnimais.registrar('tucano', fn)`
(a função recebe `ctx` com os pés em `0,0`), e um som com o mesmo nome do campo
`som` em `js/core/audio.js` — ou registre um arquivo de áudio, como explica
`assets/audio/LEIA-ME.md`.

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
