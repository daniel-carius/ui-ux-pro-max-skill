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

## Vozes dos animais

Cada animal tem o campo `som` em `js/data/animais.js`:

`rugido`, `trombeta`, `sopro`, `relincho`, `bufo`, `bocejo`, `pulo`, `ronco`,
`fungada`, `tambor`, `grunhido`, `agua`.

Registre um arquivo com o mesmo nome para substituir o som sintetizado.
