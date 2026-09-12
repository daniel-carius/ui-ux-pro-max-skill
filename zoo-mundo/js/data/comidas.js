/* ==========================================================================
   ZOO MUNDO - Alimentos que a criança colhe no cenário e dá aos animais
   `fonte` lista os tipos de cenário que dão aquela comida (ver render/cenario.js).
   Árvores só dão fruta quando têm `frutas: true` (desenhadas com frutinhas).
   ========================================================================== */
window.ZM = window.ZM || {};

ZM.COMIDAS = [
  { id: 'fruta',   nome: 'fruta',   emoji: '🍌', cor: '#ffb830', fonte: ['arvore', 'selva', 'sakura', 'carvalho', 'palmeira'],
    dica: 'nas árvores que têm frutinhas penduradas' },
  { id: 'bambu',   nome: 'bambu',   emoji: '🎋', cor: '#8fbf5a', fonte: ['bambu'],
    dica: 'nos bambuzais da Ásia' },
  { id: 'folhas',  nome: 'folhas',  emoji: '🌿', cor: '#4fae5c', fonte: ['arbusto', 'acacia', 'eucalipto'],
    dica: 'nos arbustos, nas acácias e nos eucaliptos' },
  { id: 'capim',   nome: 'capim',   emoji: '🌾', cor: '#d1b45a', fonte: ['capim'],
    dica: 'nos tufos de capim alto' },
  { id: 'peixe',   nome: 'peixe',   emoji: '🐟', cor: '#5cb8dc', fonte: ['pesqueiro', 'pier'],
    dica: 'no cais de pesca, na beira dos lagos' },
  { id: 'insetos', nome: 'insetos', emoji: '🐛', cor: '#9c6b3f', fonte: ['pedra'],
    dica: 'levantando as pedras' },
  { id: 'carne',   nome: 'carne',   emoji: '🍖', cor: '#d9534f', fonte: ['cozinha'],
    dica: 'na Cozinha do Zoo, perto da fonte da Praça' }
];

ZM.COMIDA_BY_ID = {};
ZM.COMIDAS.forEach(function (c) { ZM.COMIDA_BY_ID[c.id] = c; });

/* Qual comida um tipo de cenário oferece (ou null) */
ZM.comidaDoCenario = function (tipo) {
  for (var i = 0; i < ZM.COMIDAS.length; i++) {
    if (ZM.COMIDAS[i].fonte.indexOf(tipo) !== -1) return ZM.COMIDAS[i].id;
  }
  return null;
};
