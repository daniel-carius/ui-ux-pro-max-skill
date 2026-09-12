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
| Colher comida | `E` perto de uma árvore com frutas, bambu, arbusto, capim, pedra ou cais | botão 👋 ou toque na fonte |
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

### Animais tímidos e comida

Alguns animais perdidos estão com fome e **não saem do lugar** até comer. Aí o
encontro ganha uma pergunta a mais — *"O que será que o coala come?"* — com três
opções. Acertando, o pedido fica registrado (o animal passa a mostrar 💭🌿 na
cabeça e entra no painel *Está com fome*). A comida se **colhe no cenário**:

| Comida | Onde colher |
|--------|-------------|
| 🍌 fruta | árvores que têm frutinhas penduradas (nem todas!) |
| 🎋 bambu | bambuzais da Ásia |
| 🌿 folhas | arbustos, acácias e eucaliptos |
| 🌾 capim | tufos de capim alto |
| 🐟 peixe | cais de pesca na beira dos lagos e o píer do Oceano |
| 🐛 insetos | levantando as pedras |
| 🍖 carne | Cozinha do Zoo, ao lado da fonte da Praça |

Cada fonte dá 1 item e demora ~25 s para dar de novo; a mochila guarda até 3 de
cada tipo. Se a criança já tiver a comida, dá na hora; se não, vai procurar e, ao
voltar e falar com o animal, **só entrega** — sem repetir o quiz. Ele come
("Nhac!"), solta coraçõezinhos e passa a seguir.

### Nível de explorador

Os pontos sobem o nível — 🌱 Iniciante → 🧭 Explorador (1000) → 🗺️ Guia (2500)
→ 🛡️ Guardião (4500) → 🏆 Lenda do Zoo (7500) — com badge no HUD, barra no
passaporte e uma comemoração a cada subida.

- **Pontuação:** 100 por animal novo, +25 por acertar cada pergunta de primeira
  (nome, região e comida), +50 quando o animal chega em casa.
- **Progressão:** 3 animais descobertos abrem a **África**, 8 a **Austrália**,
  14 o **Brasil**, 20 a **Ásia** e 26 a **Região Polar**. Descobrir **todos os 30**
  abre a **América do Norte**; 36 abrem a **Europa** e 42 o **Oceano**. As regiões
  fechadas aparecem no mapa com névoa, portão trancado e uma placa dizendo quantos
  animais faltam.
- **Passaporte:** progresso por região e carimbo `REGIÃO COMPLETA` com confete.
- **Meu Zoológico:** 48 cards; os animais não descobertos aparecem como silhueta.
- **Som de cada animal:** o botão 🔊 **Ouvir** toca a voz do bicho (rugido, pio,
  bufo...) na janela do encontro e na ficha da coleção.

## Mapa

O mundo é uma grade de células de 1200 × 900 px (3 colunas × 3 linhas):

```
┌──────────┬──────────┬──────────┐
│  Brasil  │   Ásia   │  Polar   │
├──────────┼──────────┼──────────┤
│  África  │  Praça   │Austrália │
├──────────┼──────────┼──────────┤
│  Europa  │ Am. Norte│  Oceano  │   ← expansão, abre depois dos 30
└──────────┴──────────┴──────────┘
```

São **48 animais**, seis por região:

| Região | Animais |
|--------|---------|
| 🦁 África | Leão, Elefante, Girafa, Zebra, Rinoceronte, Hipopótamo |
| 🦘 Austrália | Canguru, Coala, Wombat, Emu, Diabo-da-Tasmânia, Ornitorrinco |
| 🦜 Brasil | Onça-pintada, Arara-azul, Tucano, Preguiça, Capivara, Macaco-prego |
| 🐼 Ásia | Panda-gigante, Tigre, Panda-vermelho, Orangotango, Pavão, Camelo |
| 🐧 Polar | Urso-polar, Pinguim, Foca, Morsa, Raposa-do-ártico, Rena |
| 🦬 América do Norte | Bisão, Guaxinim, Alce, Urso-pardo, Águia-careca, Castor |
| 🦉 Europa | Lobo, Raposa-vermelha, Cervo, Ouriço, Coruja, Javali |
| 🐬 Oceano | Tubarão, Tartaruga-marinha, Golfinho, Polvo, Cavalo-marinho, Caranguejo |

21 deles começam na região errada, esperando uma carona até em casa — e 9 desses
são tímidos e só vão depois de comer.

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
    │   ├── animais.js       # 48 animais: nome, sprite, casa, comida, curiosidade...
    │   ├── comidas.js       # alimentos: emoji, onde colher, dica para a criança
    │   ├── regioes.js       # 9 regiões: posição na grade, paleta, regra de desbloqueio
    │   └── personagens.js   # 4 personagens jogáveis
    ├── core/
    │   ├── utils.js         # matemática, cores, RNG com semente, colisão
    │   ├── audio.js         # sons sintetizados + suporte a arquivos
    │   └── estado.js        # progresso, pontuação e save no navegador
    ├── render/
    │   ├── sprites-animais.js     # animais da África e da Austrália (vetor em canvas)
    │   ├── sprites-animais-mundo.js  # animais do Brasil, da Ásia e do Polar
    │   ├── sprites-animais-mundo2.js # América do Norte, Europa e Oceano
    │   ├── sprites-personagem.js  # personagem em 4 direções com animação
    │   └── cenario.js             # árvores, pedras, placas, portões, fonte
    ├── game/
    │   ├── mundo.js         # monta o mapa, o chão, o cenário e as barreiras
    │   ├── entrada.js       # teclado, toque e joystick virtual
    │   └── jogo.js          # câmera, loop, animais, comitiva, comida, partículas, minimapa
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
  som: 'sopro', comida: 'fruta', timido: true,   // timido: só segue depois de comer
  spawn: { regiao: 'praca', x: 0.4, y: 0.6 }   // x/y de 0 a 1 dentro da região
}
```

Se `spawn.regiao` for diferente de `casa`, o animal começa **perdido** e vai
querer uma carona até em casa. Depois crie o desenho em
`js/render/sprites-animais-mundo.js` com `ZM.SpritesAnimais.registrar('tucano', fn)`
(a função recebe `ctx` com os pés em `0,0`), e um som com o mesmo nome do campo
`som` em `js/core/audio.js` — ou registre um arquivo de áudio, como explica
`assets/audio/LEIA-ME.md`.

**Nova comida** — acrescente em `js/data/comidas.js` com a lista `fonte` dos tipos
de cenário que a oferecem; o motor marca as fontes e desenha o balão sozinho.

**Nova região** — acrescente em `js/data/regioes.js` com `col`/`row` livres na
grade, uma paleta, um `bioma` (a receita de cenário e os lagos vêm de `RECEITAS` e
`LAGOS` em `js/game/mundo.js`) e a regra de desbloqueio:

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
