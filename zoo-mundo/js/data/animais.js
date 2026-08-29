/* ==========================================================================
   ZOO MUNDO - Base de dados dos animais (independente da interface)
   Para adicionar um animal novo:
     1. acrescente um objeto aqui (id unico, sprite existente em render/sprites-animais.js)
     2. defina `casa` (regiao correta) e `spawn` (onde ele aparece no comeco)
   Se `spawn.regiao` for diferente de `casa`, o animal comeca PERDIDO.
   ========================================================================== */
window.ZM = window.ZM || {};

ZM.ANIMAIS = [
  /* ---------------------------- AFRICA ---------------------------- */
  {
    id: 'leao', nome: 'Leão', artigo: 'o', emoji: '🦁', sprite: 'leao',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Carnívoro',
    curiosidade: 'O rugido de um leão pode ser ouvido a vários quilômetros de distância.',
    som: 'rugido',
    spawn: { regiao: 'africa', x: 0.24, y: 0.32 }
  },
  {
    id: 'elefante', nome: 'Elefante', artigo: 'o', emoji: '🐘', sprite: 'elefante',
    casa: 'africa', continente: 'África', habitat: 'Savana e florestas',
    alimentacao: 'Herbívoro',
    curiosidade: 'O elefante usa a tromba como mão, mangueira e até como snorkel.',
    som: 'trombeta',
    spawn: { regiao: 'praca', x: 0.26, y: 0.34 }
  },
  {
    id: 'girafa', nome: 'Girafa', artigo: 'a', emoji: '🦒', sprite: 'girafa',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Herbívoro',
    curiosidade: 'A língua da girafa é azulada e tem quase meio metro de comprimento.',
    som: 'sopro',
    spawn: { regiao: 'africa', x: 0.72, y: 0.28 }
  },
  {
    id: 'zebra', nome: 'Zebra', artigo: 'a', emoji: '🦓', sprite: 'zebra',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Herbívoro',
    curiosidade: 'Não existem duas zebras com listras iguais, igual à nossa impressão digital.',
    som: 'relincho',
    spawn: { regiao: 'praca', x: 0.72, y: 0.30 }
  },
  {
    id: 'rinoceronte', nome: 'Rinoceronte', artigo: 'o', emoji: '🦏', sprite: 'rinoceronte',
    casa: 'africa', continente: 'África', habitat: 'Savana e pastagens',
    alimentacao: 'Herbívoro',
    curiosidade: 'O chifre do rinoceronte é feito de queratina, o mesmo material das nossas unhas.',
    som: 'bufo',
    spawn: { regiao: 'africa', x: 0.30, y: 0.74 }
  },
  {
    id: 'hipopotamo', nome: 'Hipopótamo', artigo: 'o', emoji: '🦛', sprite: 'hipopotamo',
    casa: 'africa', continente: 'África', habitat: 'Rios e lagos',
    alimentacao: 'Herbívoro',
    curiosidade: 'O hipopótamo passa quase o dia inteiro dentro da água para se refrescar.',
    som: 'bocejo',
    spawn: { regiao: 'africa', x: 0.62, y: 0.70 }
  },

  /* --------------------------- AUSTRALIA -------------------------- */
  {
    id: 'canguru', nome: 'Canguru', artigo: 'o', emoji: '🦘', sprite: 'canguru',
    casa: 'oceania', continente: 'Oceania', habitat: 'Campos e outback',
    alimentacao: 'Herbívoro',
    curiosidade: 'O filhote de canguru nasce do tamanho de uma jujuba e cresce dentro da bolsa da mãe.',
    som: 'pulo',
    spawn: { regiao: 'praca', x: 0.30, y: 0.76 }
  },
  {
    id: 'coala', nome: 'Coala', artigo: 'o', emoji: '🐨', sprite: 'coala',
    casa: 'oceania', continente: 'Oceania', habitat: 'Florestas de eucalipto',
    alimentacao: 'Herbívoro',
    curiosidade: 'O coala dorme até 20 horas por dia para digerir as folhas de eucalipto.',
    som: 'ronco',
    spawn: { regiao: 'africa', x: 0.50, y: 0.20 }
  },
  {
    id: 'wombat', nome: 'Wombat', artigo: 'o', emoji: '🐹', sprite: 'wombat',
    casa: 'oceania', continente: 'Oceania', habitat: 'Tocas e campos',
    alimentacao: 'Herbívoro',
    curiosidade: 'O cocô do wombat tem formato de cubinho e não rola morro abaixo.',
    som: 'fungada',
    spawn: { regiao: 'oceania', x: 0.28, y: 0.36 }
  },
  {
    id: 'emu', nome: 'Emu', artigo: 'o', emoji: '🐦', sprite: 'emu',
    casa: 'oceania', continente: 'Oceania', habitat: 'Outback e campos abertos',
    alimentacao: 'Onívoro',
    curiosidade: 'O emu não voa, mas corre a quase 50 km/h, mais rápido que uma bicicleta.',
    som: 'tambor',
    spawn: { regiao: 'africa', x: 0.84, y: 0.60 }
  },
  {
    id: 'diabo-tasmania', nome: 'Diabo-da-Tasmânia', artigo: 'o', emoji: '😈', sprite: 'diabo',
    casa: 'oceania', continente: 'Oceania', habitat: 'Florestas da Tasmânia',
    alimentacao: 'Carnívoro',
    curiosidade: 'Ele é pequeno, mas tem uma das mordidas mais fortes entre os mamíferos.',
    som: 'grunhido',
    spawn: { regiao: 'oceania', x: 0.70, y: 0.30 }
  },
  {
    id: 'ornitorrinco', nome: 'Ornitorrinco', artigo: 'o', emoji: '🦆', sprite: 'ornitorrinco',
    casa: 'oceania', continente: 'Oceania', habitat: 'Rios e riachos',
    alimentacao: 'Carnívoro',
    curiosidade: 'O ornitorrinco põe ovos, tem bico de pato e encontra comida com sensores elétricos.',
    som: 'agua',
    spawn: { regiao: 'oceania', x: 0.52, y: 0.72 }
  }
];

ZM.ANIMAL_BY_ID = {};
ZM.ANIMAIS.forEach(function (a) { ZM.ANIMAL_BY_ID[a.id] = a; });

/* Animais que moram em cada regiao (usado no passaporte) */
ZM.animaisDaRegiao = function (regiaoId) {
  return ZM.ANIMAIS.filter(function (a) { return a.casa === regiaoId; });
};
