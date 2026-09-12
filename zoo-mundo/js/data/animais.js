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
    id: 'leao', comida: 'carne', nome: 'Leão', artigo: 'o', emoji: '🦁', sprite: 'leao',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Carnívoro',
    curiosidade: 'O rugido de um leão pode ser ouvido a vários quilômetros de distância.',
    som: 'rugido',
    spawn: { regiao: 'africa', x: 0.24, y: 0.32 }
  },
  {
    id: 'elefante', comida: 'capim', nome: 'Elefante', artigo: 'o', emoji: '🐘', sprite: 'elefante',
    casa: 'africa', continente: 'África', habitat: 'Savana e florestas',
    alimentacao: 'Herbívoro',
    curiosidade: 'O elefante usa a tromba como mão, mangueira e até como snorkel.',
    som: 'trombeta',
    spawn: { regiao: 'praca', x: 0.26, y: 0.34 }
  },
  {
    id: 'girafa', comida: 'folhas', nome: 'Girafa', artigo: 'a', emoji: '🦒', sprite: 'girafa',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Herbívoro',
    curiosidade: 'A língua da girafa é azulada e tem quase meio metro de comprimento.',
    som: 'sopro',
    spawn: { regiao: 'africa', x: 0.72, y: 0.28 }
  },
  {
    id: 'zebra', comida: 'capim', nome: 'Zebra', artigo: 'a', emoji: '🦓', sprite: 'zebra',
    casa: 'africa', continente: 'África', habitat: 'Savana',
    alimentacao: 'Herbívoro',
    curiosidade: 'Não existem duas zebras com listras iguais, igual à nossa impressão digital.',
    som: 'relincho',
    spawn: { regiao: 'praca', x: 0.72, y: 0.30 }
  },
  {
    id: 'rinoceronte', comida: 'capim', nome: 'Rinoceronte', artigo: 'o', emoji: '🦏', sprite: 'rinoceronte',
    casa: 'africa', continente: 'África', habitat: 'Savana e pastagens',
    alimentacao: 'Herbívoro',
    curiosidade: 'O chifre do rinoceronte é feito de queratina, o mesmo material das nossas unhas.',
    som: 'bufo',
    spawn: { regiao: 'africa', x: 0.30, y: 0.74 }
  },
  {
    id: 'hipopotamo', comida: 'capim', nome: 'Hipopótamo', artigo: 'o', emoji: '🦛', sprite: 'hipopotamo',
    casa: 'africa', continente: 'África', habitat: 'Rios e lagos',
    alimentacao: 'Herbívoro',
    curiosidade: 'O hipopótamo passa quase o dia inteiro dentro da água para se refrescar.',
    som: 'bocejo',
    spawn: { regiao: 'africa', x: 0.62, y: 0.70 }
  },

  /* --------------------------- AUSTRALIA -------------------------- */
  {
    id: 'canguru', comida: 'capim', nome: 'Canguru', artigo: 'o', emoji: '🦘', sprite: 'canguru',
    casa: 'oceania', continente: 'Oceania', habitat: 'Campos e outback',
    alimentacao: 'Herbívoro',
    curiosidade: 'O filhote de canguru nasce do tamanho de uma jujuba e cresce dentro da bolsa da mãe.',
    som: 'pulo',
    spawn: { regiao: 'praca', x: 0.28, y: 0.74 }
  },
  {
    id: 'coala', comida: 'folhas', timido: true, nome: 'Coala', artigo: 'o', emoji: '🐨', sprite: 'coala',
    casa: 'oceania', continente: 'Oceania', habitat: 'Florestas de eucalipto',
    alimentacao: 'Herbívoro',
    curiosidade: 'O coala dorme até 20 horas por dia para digerir as folhas de eucalipto.',
    som: 'ronco',
    spawn: { regiao: 'africa', x: 0.50, y: 0.20 }
  },
  {
    id: 'wombat', comida: 'capim', nome: 'Wombat', artigo: 'o', emoji: '🐹', sprite: 'wombat',
    casa: 'oceania', continente: 'Oceania', habitat: 'Tocas e campos',
    alimentacao: 'Herbívoro',
    curiosidade: 'O cocô do wombat tem formato de cubinho e não rola morro abaixo.',
    som: 'fungada',
    spawn: { regiao: 'oceania', x: 0.28, y: 0.36 }
  },
  {
    id: 'emu', comida: 'insetos', nome: 'Emu', artigo: 'o', emoji: '🐦', sprite: 'emu',
    casa: 'oceania', continente: 'Oceania', habitat: 'Outback e campos abertos',
    alimentacao: 'Onívoro',
    curiosidade: 'O emu não voa, mas corre a quase 50 km/h, mais rápido que uma bicicleta.',
    som: 'tambor',
    spawn: { regiao: 'africa', x: 0.84, y: 0.60 }
  },
  {
    id: 'diabo-tasmania', comida: 'carne', nome: 'Diabo-da-Tasmânia', artigo: 'o', emoji: '😈', sprite: 'diabo',
    casa: 'oceania', continente: 'Oceania', habitat: 'Florestas da Tasmânia',
    alimentacao: 'Carnívoro',
    curiosidade: 'Ele é pequeno, mas tem uma das mordidas mais fortes entre os mamíferos.',
    som: 'grunhido',
    spawn: { regiao: 'oceania', x: 0.70, y: 0.30 }
  },
  {
    id: 'ornitorrinco', comida: 'insetos', nome: 'Ornitorrinco', artigo: 'o', emoji: '🦆', sprite: 'ornitorrinco',
    casa: 'oceania', continente: 'Oceania', habitat: 'Rios e riachos',
    alimentacao: 'Carnívoro',
    curiosidade: 'O ornitorrinco põe ovos, tem bico de pato e encontra comida com sensores elétricos.',
    som: 'agua',
    spawn: { regiao: 'oceania', x: 0.52, y: 0.72 }
  },
/* ---------------------- BRASIL / AMAZONIA ----------------------- */
  {
    id: 'onca-pintada', comida: 'carne', timido: true, nome: 'Onça-pintada', artigo: 'a', emoji: '🐆', sprite: 'onca',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta e beira de rio',
    alimentacao: 'Carnívoro',
    curiosidade: 'A onça-pintada adora nadar e é a felina com a mordida mais forte das Américas.',
    som: 'rosnado',
    spawn: { regiao: 'africa', x: 0.14, y: 0.60 }
  },
  {
    id: 'arara-azul', comida: 'fruta', nome: 'Arara-azul', artigo: 'a', emoji: '🦜', sprite: 'arara',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Copa das árvores',
    alimentacao: 'Frugívoro',
    curiosidade: 'A arara-azul escolhe um par e vive com ele a vida inteira.',
    som: 'grasnado',
    spawn: { regiao: 'oceania', x: 0.16, y: 0.62 }
  },
  {
    id: 'tucano', comida: 'fruta', nome: 'Tucano', artigo: 'o', emoji: '🐦', sprite: 'tucano',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta tropical',
    alimentacao: 'Frugívoro',
    curiosidade: 'O bico enorme do tucano é leve e ajuda o corpo dele a se refrescar.',
    som: 'assobio',
    spawn: { regiao: 'praca', x: 0.82, y: 0.80 }
  },
  {
    id: 'preguica', comida: 'folhas', nome: 'Preguiça', artigo: 'a', emoji: '🦥', sprite: 'preguica',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Copa das árvores',
    alimentacao: 'Herbívoro',
    curiosidade: 'A preguiça é tão devagar que mofo e algas chegam a crescer no pelo dela.',
    som: 'bocejo',
    spawn: { regiao: 'brasil', x: 0.26, y: 0.34 }
  },
  {
    id: 'capivara', comida: 'capim', nome: 'Capivara', artigo: 'a', emoji: '🦫', sprite: 'capivara',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Rios e brejos',
    alimentacao: 'Herbívoro',
    curiosidade: 'A capivara é o maior roedor do mundo e consegue cochilar dentro da água.',
    som: 'chiado',
    spawn: { regiao: 'brasil', x: 0.68, y: 0.72 }
  },
  {
    id: 'macaco-prego', comida: 'fruta', nome: 'Macaco-prego', artigo: 'o', emoji: '🐒', sprite: 'macaco',
    casa: 'brasil', continente: 'América do Sul', habitat: 'Floresta tropical',
    alimentacao: 'Onívoro',
    curiosidade: 'O macaco-prego usa pedras como martelo para abrir castanhas duras.',
    som: 'guincho',
    spawn: { regiao: 'brasil', x: 0.44, y: 0.24 }
  },

  /* -------------------------- ÁSIA / CHINA ------------------------ */
  {
    id: 'panda', comida: 'bambu', nome: 'Panda-gigante', artigo: 'o', emoji: '🐼', sprite: 'panda',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas de bambu',
    alimentacao: 'Herbívoro',
    curiosidade: 'O panda passa até 14 horas por dia comendo bambu.',
    som: 'mastigada',
    spawn: { regiao: 'asia', x: 0.30, y: 0.36 }
  },
  {
    id: 'tigre', comida: 'carne', timido: true, nome: 'Tigre', artigo: 'o', emoji: '🐅', sprite: 'tigre',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas e manguezais',
    alimentacao: 'Carnívoro',
    curiosidade: 'Cada tigre tem um desenho de listras diferente, e a pele também é listrada.',
    som: 'rugido-grave',
    spawn: { regiao: 'brasil', x: 0.78, y: 0.30 }
  },
  {
    id: 'panda-vermelho', comida: 'bambu', nome: 'Panda-vermelho', artigo: 'o', emoji: '🦊', sprite: 'panda-vermelho',
    casa: 'asia', continente: 'Ásia', habitat: 'Montanhas do Himalaia',
    alimentacao: 'Herbívoro',
    curiosidade: 'O panda-vermelho enrola a cauda peluda no corpo como se fosse um cobertor.',
    som: 'chilro',
    spawn: { regiao: 'oceania', x: 0.80, y: 0.74 }
  },
  {
    id: 'orangotango', comida: 'fruta', nome: 'Orangotango', artigo: 'o', emoji: '🦧', sprite: 'orangotango',
    casa: 'asia', continente: 'Ásia', habitat: 'Florestas tropicais',
    alimentacao: 'Frugívoro',
    curiosidade: 'O orangotango monta uma cama nova de folhas na árvore todo fim de tarde.',
    som: 'grito',
    spawn: { regiao: 'asia', x: 0.70, y: 0.30 }
  },
  {
    id: 'pavao', comida: 'insetos', nome: 'Pavão', artigo: 'o', emoji: '🦚', sprite: 'pavao',
    casa: 'asia', continente: 'Ásia', habitat: 'Bosques e campos',
    alimentacao: 'Onívoro',
    curiosidade: 'A cauda aberta do pavão pode ter mais de 200 penas com desenho de olho.',
    som: 'canto',
    spawn: { regiao: 'brasil', x: 0.20, y: 0.72 }
  },
  {
    id: 'camelo', comida: 'capim', nome: 'Camelo', artigo: 'o', emoji: '🐫', sprite: 'camelo',
    casa: 'asia', continente: 'Ásia', habitat: 'Estepes e desertos',
    alimentacao: 'Herbívoro',
    curiosidade: 'As corcovas do camelo guardam gordura, e não água como muita gente pensa.',
    som: 'resmungo',
    spawn: { regiao: 'asia', x: 0.50, y: 0.74 }
  },

  /* ------------------------- REGIÃO POLAR ------------------------- */
  {
    id: 'urso-polar', comida: 'peixe', timido: true, nome: 'Urso-polar', artigo: 'o', emoji: '🐻‍❄️', sprite: 'urso-polar',
    casa: 'polar', continente: 'Ártico', habitat: 'Gelo marinho',
    alimentacao: 'Carnívoro',
    curiosidade: 'A pele do urso-polar é preta; os pelos são ocos e transparentes.',
    som: 'rugido-polar',
    spawn: { regiao: 'brasil', x: 0.52, y: 0.52 }
  },
  {
    id: 'pinguim', comida: 'peixe', timido: true, nome: 'Pinguim', artigo: 'o', emoji: '🐧', sprite: 'pinguim',
    casa: 'polar', continente: 'Antártida', habitat: 'Costa gelada',
    alimentacao: 'Carnívoro',
    curiosidade: 'O pinguim não voa no ar, mas "voa" debaixo d\'água a 25 km/h.',
    som: 'grasno',
    spawn: { regiao: 'oceania', x: 0.44, y: 0.20 }
  },
  {
    id: 'foca', comida: 'peixe', nome: 'Foca', artigo: 'a', emoji: '🦭', sprite: 'foca',
    casa: 'polar', continente: 'Antártida', habitat: 'Mar e blocos de gelo',
    alimentacao: 'Carnívoro',
    curiosidade: 'A foca consegue prender a respiração por mais de vinte minutos.',
    som: 'latido',
    spawn: { regiao: 'polar', x: 0.30, y: 0.68 }
  },
  {
    id: 'morsa', comida: 'peixe', timido: true, nome: 'Morsa', artigo: 'a', emoji: '🦭', sprite: 'morsa',
    casa: 'polar', continente: 'Ártico', habitat: 'Praias de gelo',
    alimentacao: 'Carnívoro',
    curiosidade: 'A morsa usa as presas enormes para se apoiar e subir no gelo.',
    som: 'bufo-grave',
    spawn: { regiao: 'asia', x: 0.22, y: 0.68 }
  },
  {
    id: 'raposa-artica', comida: 'carne', nome: 'Raposa-do-ártico', artigo: 'a', emoji: '🦊', sprite: 'raposa',
    casa: 'polar', continente: 'Ártico', habitat: 'Tundra',
    alimentacao: 'Onívoro',
    curiosidade: 'No verão a raposa-do-ártico troca o pelo branco por um pelo marrom.',
    som: 'ganido',
    spawn: { regiao: 'polar', x: 0.68, y: 0.32 }
  },
  {
    id: 'rena', comida: 'folhas', nome: 'Rena', artigo: 'a', emoji: '🦌', sprite: 'rena',
    casa: 'polar', continente: 'Ártico', habitat: 'Tundra e florestas frias',
    alimentacao: 'Herbívoro',
    curiosidade: 'Os olhos da rena mudam de cor no inverno para enxergar melhor no escuro.',
    som: 'bufo-rena',
    spawn: { regiao: 'asia', x: 0.78, y: 0.66 }
  },
/* ------------------- AMÉRICA DO NORTE (expansão) ------------------ */
  {
    id: 'bisao', comida: 'capim', nome: 'Bisão', artigo: 'o', emoji: '🦬', sprite: 'bisao',
    casa: 'america', continente: 'América do Norte', habitat: 'Pradarias',
    alimentacao: 'Herbívoro',
    curiosidade: 'O bisão é enorme, mas corre a 55 km/h e salta cercas de quase 2 metros.',
    som: 'mugido',
    spawn: { regiao: 'america', x: 0.26, y: 0.34 }
  },
  {
    id: 'guaxinim', comida: 'fruta', nome: 'Guaxinim', artigo: 'o', emoji: '🦝', sprite: 'guaxinim',
    casa: 'america', continente: 'América do Norte', habitat: 'Florestas e beira de rios',
    alimentacao: 'Onívoro',
    curiosidade: 'O guaxinim "lava" a comida na água antes de comer, usando as patinhas.',
    som: 'chiado',
    spawn: { regiao: 'america', x: 0.70, y: 0.70 }
  },
  {
    id: 'alce', comida: 'folhas', nome: 'Alce', artigo: 'o', emoji: '🫎', sprite: 'alce',
    casa: 'america', continente: 'América do Norte', habitat: 'Florestas e lagos frios',
    alimentacao: 'Herbívoro',
    curiosidade: 'O alce mergulha para comer plantas do fundo do lago e nada muito bem.',
    som: 'bramido',
    spawn: { regiao: 'america', x: 0.24, y: 0.72 }
  },
  {
    id: 'urso-pardo', comida: 'peixe', nome: 'Urso-pardo', artigo: 'o', emoji: '🐻', sprite: 'urso-pardo',
    casa: 'america', continente: 'América do Norte', habitat: 'Montanhas e florestas',
    alimentacao: 'Onívoro',
    curiosidade: 'Antes do inverno, o urso-pardo come o dia todo para dormir meses sem comer.',
    som: 'rosnado-grave',
    spawn: { regiao: 'europa', x: 0.74, y: 0.30 }
  },
  {
    id: 'aguia-careca', comida: 'peixe', nome: 'Águia-careca', artigo: 'a', emoji: '🦅', sprite: 'aguia',
    casa: 'america', continente: 'América do Norte', habitat: 'Lagos e costas',
    alimentacao: 'Carnívoro',
    curiosidade: 'A águia-careca enxerga um peixe na água a mais de um quilômetro de altura.',
    som: 'grito-aguia',
    spawn: { regiao: 'oceano', x: 0.70, y: 0.70 }
  },
  {
    id: 'castor', comida: 'folhas', nome: 'Castor', artigo: 'o', emoji: '🦫', sprite: 'castor',
    casa: 'america', continente: 'América do Norte', habitat: 'Rios e riachos',
    alimentacao: 'Herbívoro',
    curiosidade: 'O castor constrói barragens de galhos tão fortes que mudam o curso dos rios.',
    som: 'estalo',
    spawn: { regiao: 'america', x: 0.74, y: 0.28 }
  },

  /* -------------------------- EUROPA (expansão) -------------------- */
  {
    id: 'lobo', comida: 'carne', timido: true, nome: 'Lobo', artigo: 'o', emoji: '🐺', sprite: 'lobo',
    casa: 'europa', continente: 'Europa', habitat: 'Bosques e montanhas',
    alimentacao: 'Carnívoro',
    curiosidade: 'Os lobos uivam para chamar a família, que pode ouvir a quilômetros de distância.',
    som: 'uivo',
    spawn: { regiao: 'america', x: 0.50, y: 0.24 }
  },
  {
    id: 'raposa-vermelha', comida: 'fruta', nome: 'Raposa-vermelha', artigo: 'a', emoji: '🦊', sprite: 'raposa-vermelha',
    casa: 'europa', continente: 'Europa', habitat: 'Bosques e campos',
    alimentacao: 'Onívoro',
    curiosidade: 'A raposa dá um pulo alto e cai de cabeça na neve para pegar o que está escondido.',
    som: 'ganido',
    spawn: { regiao: 'europa', x: 0.28, y: 0.34 }
  },
  {
    id: 'cervo', comida: 'folhas', nome: 'Cervo', artigo: 'o', emoji: '🦌', sprite: 'cervo',
    casa: 'europa', continente: 'Europa', habitat: 'Bosques',
    alimentacao: 'Herbívoro',
    curiosidade: 'Os chifres do cervo caem todo ano e crescem de novo, maiores.',
    som: 'sopro',
    spawn: { regiao: 'europa', x: 0.70, y: 0.66 }
  },
  {
    id: 'ourico', comida: 'insetos', nome: 'Ouriço', artigo: 'o', emoji: '🦔', sprite: 'ourico',
    casa: 'europa', continente: 'Europa', habitat: 'Jardins e bosques',
    alimentacao: 'Insetívoro',
    curiosidade: 'Quando se assusta, o ouriço vira uma bolinha de espinhos.',
    som: 'fungada',
    spawn: { regiao: 'europa', x: 0.50, y: 0.26 }
  },
  {
    id: 'coruja', comida: 'insetos', nome: 'Coruja', artigo: 'a', emoji: '🦉', sprite: 'coruja',
    casa: 'europa', continente: 'Europa', habitat: 'Bosques',
    alimentacao: 'Carnívoro',
    curiosidade: 'A coruja gira a cabeça quase até as costas, porque os olhos dela não se mexem.',
    som: 'pio-coruja',
    spawn: { regiao: 'europa', x: 0.80, y: 0.34 }
  },
  {
    id: 'javali', comida: 'fruta', timido: true, nome: 'Javali', artigo: 'o', emoji: '🐗', sprite: 'javali',
    casa: 'europa', continente: 'Europa', habitat: 'Bosques',
    alimentacao: 'Onívoro',
    curiosidade: 'O javali fuça a terra com o focinho procurando raízes e bolotas de carvalho.',
    som: 'grunhido',
    spawn: { regiao: 'oceano', x: 0.22, y: 0.70 }
  },

  /* ------------------------- OCEANO (expansão) --------------------- */
  {
    id: 'tubarao', comida: 'peixe', nome: 'Tubarão', artigo: 'o', emoji: '🦈', sprite: 'tubarao',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Mar aberto e recifes',
    alimentacao: 'Carnívoro',
    curiosidade: 'O tubarão troca de dentes a vida toda: pode ter milhares de dentes novos.',
    som: 'borbulha',
    spawn: { regiao: 'oceano', x: 0.30, y: 0.34 }
  },
  {
    id: 'tartaruga-marinha', comida: 'folhas', nome: 'Tartaruga-marinha', artigo: 'a', emoji: '🐢', sprite: 'tartaruga',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Mares quentes',
    alimentacao: 'Herbívoro',
    curiosidade: 'A tartaruga-marinha volta para a mesma praia onde nasceu para pôr os ovos.',
    som: 'sopro-agua',
    spawn: { regiao: 'america', x: 0.50, y: 0.74 }
  },
  {
    id: 'golfinho', comida: 'peixe', timido: true, nome: 'Golfinho', artigo: 'o', emoji: '🐬', sprite: 'golfinho',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Mar aberto',
    alimentacao: 'Carnívoro',
    curiosidade: 'Cada golfinho tem um assobio próprio, como se fosse o nome dele.',
    som: 'assobio-golfinho',
    spawn: { regiao: 'europa', x: 0.30, y: 0.66 }
  },
  {
    id: 'polvo', comida: 'peixe', nome: 'Polvo', artigo: 'o', emoji: '🐙', sprite: 'polvo',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Recifes e fundo do mar',
    alimentacao: 'Carnívoro',
    curiosidade: 'O polvo tem três corações e muda de cor para se esconder.',
    som: 'borbulha',
    spawn: { regiao: 'oceano', x: 0.60, y: 0.22 }
  },
  {
    id: 'cavalo-marinho', comida: 'insetos', nome: 'Cavalo-marinho', artigo: 'o', emoji: '🐚', sprite: 'cavalo-marinho',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Algas e corais',
    alimentacao: 'Carnívoro',
    curiosidade: 'No cavalo-marinho, é o papai que carrega os ovos na barriga até nascerem.',
    som: 'estalinho',
    spawn: { regiao: 'oceano', x: 0.50, y: 0.74 }
  },
  {
    id: 'caranguejo', comida: 'folhas', nome: 'Caranguejo', artigo: 'o', emoji: '🦀', sprite: 'caranguejo',
    casa: 'oceano', continente: 'Oceanos', habitat: 'Praias e recifes',
    alimentacao: 'Onívoro',
    curiosidade: 'O caranguejo anda de lado porque as pernas dele dobram só para os lados.',
    som: 'clique',
    spawn: { regiao: 'oceano', x: 0.50, y: 0.28 }
  }
];

ZM.ANIMAL_BY_ID = {};
ZM.ANIMAIS.forEach(function (a) { ZM.ANIMAL_BY_ID[a.id] = a; });

/* Animais que moram em cada regiao (usado no passaporte) */
ZM.animaisDaRegiao = function (regiaoId) {
  return ZM.ANIMAIS.filter(function (a) { return a.casa === regiaoId; });
};
