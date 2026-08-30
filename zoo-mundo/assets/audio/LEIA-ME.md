# Sons do Zoo Mundo

O jogo funciona **sem nenhum arquivo de áudio**: todos os efeitos são sintetizados
em tempo real pelo WebAudio (`js/core/audio.js`).

Para trocar qualquer efeito por um arquivo real, coloque o arquivo nesta pasta e
registre-o antes de tocar (por exemplo em `js/main.js`):

```js
ZM.Audio.registrar('descoberta', 'assets/audio/descoberta.mp3');
ZM.Audio.registrar('rugido',     'assets/audio/leao.mp3');
```

## Nomes usados pelo jogo

| Nome            | Quando toca                                  |
|-----------------|----------------------------------------------|
| `ui`            | toque em botões                              |
| `encontro`      | ao abrir a conversa com um animal            |
| `correto`       | resposta certa                               |
| `quase`         | resposta incorreta (feedback gentil)         |
| `descoberta`    | novo animal registrado no passaporte         |
| `casa`          | animal levado de volta para a região dele    |
| `desbloqueio`   | nova região liberada                         |
| `carimbo`       | região completa (carimbo no passaporte)      |
| `passo`         | reservado para passos do personagem          |

| `seguindo`      | animal aceita acompanhar o jogador            |

## Vozes dos animais

Cada animal tem o campo `som` em `js/data/animais.js`. O botão 🔊 **Ouvir**, na
janela do encontro e na ficha da coleção, toca exatamente esse som.

- **África:** `rugido`, `trombeta`, `sopro`, `relincho`, `bufo`, `bocejo`
- **Austrália:** `pulo`, `ronco`, `fungada`, `tambor`, `grunhido`, `agua`
- **Brasil:** `rosnado`, `grasnado`, `assobio`, `chiado`, `guincho` (a preguiça usa `bocejo`)
- **Ásia:** `mastigada`, `rugido-grave`, `chilro`, `grito`, `canto`, `resmungo`
- **Polar:** `rugido-polar`, `grasno`, `latido`, `bufo-grave`, `ganido`, `bufo-rena`

Registre um arquivo com o mesmo nome para substituir o som sintetizado.

Os sons são gerados com osciladores e com ruído filtrado (para rugidos, bufos e
chiados), com vibrato nos pios — tudo em `SINTESE`, dentro de `js/core/audio.js`.
