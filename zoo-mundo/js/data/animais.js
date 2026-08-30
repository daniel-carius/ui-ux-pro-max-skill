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
    spawn: { regiao: 'praca', x: 0.28, y: 0.74 }
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
  },
/* ---------------------- BRASIL / AMAZONIA ----------------------- */
  {
    id: 'onca-pintada', nome: 'Onça-pintada', artigo: 'a', emoji: '🐆', sprite: 'onca',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta e beira de rio',
    alimentacao: 'Carnívoro',
    curiosidade: 'A onça-pintada adora nadar e é a felina com a mordida mais forte das Américas.',
    som: 'rosnado',
    spawn: { regiao: 'africa', x: 0.14, y: 0.60 }
  },
  {
    id: 'arara-azul', nome: 'Arara-azul', artigo: 'a', emoji: '🦜', sprite: 'arara',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Copa das árvores',
    alimentacao: 'Frugívoro',
    curiosidade: 'A arara-azul escolhe um par e vive com ele a vida inteira.',
    som: 'grasnado',
    spawn: { regiao: 'oceania', x: 0.16, y: 0.62 }
  },
  {
    id: 'tucano', nome: 'Tucano', artigo: 'o', emoji: '🐦', sprite: 'tucano',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta tropical',
    alimentacao: 'Frugívoro',
    curiosidade: 'O bico enorme do tucano é leve e ajuda o corpo dele a se refrescar.',
    som: 'assobio',
    spawn: { regiao: 'praca', x: 0.70, y: 0.74 }
  },
  {
    id: 'preguica', nome: 'Preguiça', artigo: 'a', emoji: '🦥', sprite: 'preguica',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Copa das árvores',
    alimentacao: 'Herbívoro',
    curiosidade: 'A preguiça é tão devagar que mofo e algas chegam a crescer no pelo dela.',
    som: 'bocejo',
    spawn: { regiao: 'brasil', x: 0.26, y: 0.34 }
  },
  {
    id: 'capivara', nome: 'Capivara', artigo: 'a', emoji: '🦫', sprite: 'capivara',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Rios e brejos',
    alimentacao: 'Herbívoro',
    curiosidade: 'A capivara é o maior roedor do mundo e consegue cochilar dentro da água.',
    som: 'chiado',
    spawn: { regiao: 'brasil', x: 0.68, y: 0.72 }
  },
  {
    id: 'macaco-prego', nome: 'Macaco-prego', artigo: 'o', emoji: '🐒', sprite: 'macaco',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta tropical',
    alimentacao: 'Onívoro',
    curiosidade: 'O macaco-prego usa pedras como martelo para abrir castanhas duras.',
    som: 'guincho',
    spawn: { regiao: 'brasil', x: 0.44, y: 0.24 }
  },

  /* -------------------------- ÁSIA / CHINA ------------------------ */
  {
    id: 'panda', nome: 'Panda-gigante', artigo: 'o', emoji: '🐼', sprite: 'panda',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas de bambu',
    alimentacao: 'Herbívoro',
    curiosidade: 'O panda passa até 14 horas por dia comendo bambu.',
    som: 'mastigada',
    spawn: { regiao: 'asia', x: 0.30, y: 0.36 }
  },
  {
    id: 'tigre', nome: 'Tigre', artigo: 'o', emoji: '🐅', sprite: 'tigre',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas e manguezais',
    alimentacao: 'Carnívoro',
    curiosidade: 'Cada tigre tem um desenho de listras diferente, e a pele também é listrada.',
    som: 'rugido-grave',
    spawn: { regiao: 'brasil', x: 0.78, y: 0.30 }
  },
  {
    id: 'panda-vermelho', nome: 'Panda-vermelho', artigo: 'o', emoji: '🦊', sprite: 'panda-vermelho',
    casa: 'asia', continente: 'Ásia', habitat: 'Montanhas do Himalaia',
    alimentacao: 'Herbívoro',
    curiosidade: 'O panda-vermelho enrola a cauda peluda no corpo como se fosse um cobertor.',
    som: 'chilro',
    spawn: { regiao: 'oceania', x: 0.80, y: 0.74 }
  },
  {
    id: 'orangotango', nome: 'Orangotango', artigo: 'o', emoji: '🦧', sprite: 'orangotango',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas tropicais',
    alimentacao: 'Frugívoro',
    curiosidade: 'O orangotango monta uma cama nova de folhas na árvore todo fim de tarde.',
    som: 'grito',
    spawn: { regiao: 'asia', x: 0.70, y: 0.30 }
  },
  {
    id: 'pavao', nome: 'Pavão', artigo: 'o', emoji: '🦚', sprite: 'pavao',
    casa: 'asia', continente: 'Ásia', habitat: 'Bosques e campos',
    alimentacao: 'Onívoro',
    curiosidade: 'A cauda aberta do pavão pode ter mais de 200 penas com desenho de olho.',
    som: 'canto',
    spawn: { regiao: 'brasil', x: 0.20, y: 0.72 }
  },
  {
    id: 'camelo', nome: 'Camelo', artigo: 'o', emoji: '🐫', sprite: 'camelo',
    casa: 'asia', continente: 'Ásia', habitat: 'Estepes e desertos',
    alimentacao: 'Herbívoro',
    curiosidade: 'As corcovas do camelo guardam gordura, e não água como muita gente pensa.',
    som: 'resmungo',
    spawn: { regiao: 'asia', x: 0.50, y: 0.74 }
  },

  /* ------------------------- REGIÃO POLAR ------------------------- */
  {
    id: 'urso-polar', nome: 'Urso-polar', artigo: 'o', emoji: '🐻‍❄️', sprite: 'urso-polar',
    casa: 'polar', continente: 'Ártico', habitat: 'Gelo marinho',
    alimentacao: 'Carnívoro',
    curiosidade: 'A pele do urso-polar é preta; os pelos são ocos e transparentes.',
    som: 'rugido-polar',
    spawn: { regiao: 'brasil', x: 0.52, y: 0.52 }
  },
  {
    id: 'pinguim', nome: 'Pinguim', artigo: 'o', emoji: '🐧', sprite: 'pinguim',
    casa: 'polar', continente: 'Antártida', habitat: 'Costa gelada',
    alimentacao: 'Carnívoro',
    curiosidade: 'O pinguim não voa no ar, mas "voa" debaixo d\'água a 25 km/h.',
    som: 'grasno',
    spawn: { regiao: 'oceania', x: 0.44, y: 0.20 }
  },
  {
    id: 'foca', nome: 'Foca', artigo: 'a', emoji: '🦭', sprite: 'foca',
    casa: 'polar', continente: 'Antártida', habitat: 'Mar e blocos de gelo',
    alimentacao: 'Carnívoro',
    curiosidade: 'A foca consegue prender a respiração por mais de vinte minutos.',
    som: 'latido',
    spawn: { regiao: 'polar', x: 0.30, y: 0.68 }
  },
  {
    id: 'morsa', nome: 'Morsa', artigo: 'a', emoji: '🦭', sprite: 'morsa',
    casa: 'polar', continente: 'Ártico', habitat: 'Praias de gelo',
    alimentacao: 'Carnívoro',
    curiosidade: 'A morsa usa as presas enormes para se apoiar e subir no gelo.',
    som: 'bufo-grave',
    spawn: { regiao: 'asia', x: 0.22, y: 0.68 }
  },
  {
    id: 'raposa-artica', nome: 'Raposa-do-ártico', artigo: 'a', emoji: '🦊', sprite: 'raposa',
    casa: 'polar', continente: 'Ártico', habitat: 'Tundra',
    alimentacao: 'Onívoro',
    curiosidade: 'No verão a raposa-do-ártico troca o pelo branco por um pelo marrom.',
    som: 'ganido',
    spawn: { regiao: 'polar', x: 0.68, y: 0.32 }
  },
  {
    id: 'rena', nome: 'Rena', artigo: 'a', emoji: '🦌', sprite: 'rena',
    casa: 'polar', continente: 'Ártico', habitat: 'Tundra e florestas frias',
    alimentacao: 'Herbívoro',
    curiosidade: 'Os olhos da rena mudam de cor no inverno para enxergar melhor no escuro.',
    som: 'bufo-rena',
    spawn: { regiao: 'asia', x: 0.78, y: 0.66 }
  }
];

ZM.ANIMAL_BY_ID = {};
ZM.ANIMAIS.forEach(function (a) { ZM.ANIMAL_BY_ID[a.id] = a; });

/* Animais que moram em cada regiao (usado no passaporte) */
ZM.animaisDaRegiao = function (regiaoId) {
  return ZM.ANIMAIS.filter(function (a) { return a.casa === regiaoId; });
};
