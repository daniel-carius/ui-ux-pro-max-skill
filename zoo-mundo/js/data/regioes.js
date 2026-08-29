/* ==========================================================================
   ZOO MUNDO - Dados das Regioes
   Para adicionar uma nova regiao: acrescente um objeto neste array.
   O mapa e montado automaticamente a partir de `col` e `row`.
   ========================================================================== */
window.ZM = window.ZM || {};

ZM.REGIONS = [
  {
    id: 'praca', prep: 'na',
    nome: 'Praça Central',
    nomeCurto: 'Praça',
    icone: '🎪',
    continente: 'Mundo',
    col: 1, row: 1,
    bioma: 'praca',
    // Regra de desbloqueio: sempre liberada
    unlock: { tipo: 'inicial' },
    mvp: true,
    paleta: {
      chao: '#8ed07a', chaoAlt: '#7cc468', chaoDetalhe: '#a7dd91',
      caminho: '#f2dfae', caminhoBorda: '#e3c98d',
      agua: '#5cc7e8', tronco: '#8a5a3b', folha: '#3f9d5d', folhaAlt: '#57b872',
      cartaz: '#f4a72c', ceu: '#bfe9a8'
    },
    dica: 'O coração do zoológico! Converse com os animais perdidos.'
  },
  {
    id: 'africa', prep: 'na',
    nome: 'África · Savana',
    nomeCurto: 'África',
    icone: '🦁',
    continente: 'África',
    col: 0, row: 1,
    bioma: 'savana',
    unlock: { tipo: 'descobertas', valor: 3 },
    mvp: true,
    paleta: {
      chao: '#e3c675', chaoAlt: '#d4b25f', chaoDetalhe: '#efd98f',
      caminho: '#c9a45c', caminhoBorda: '#b8924c',
      agua: '#63b7d6', tronco: '#7a5334', folha: '#6f9f4a', folhaAlt: '#87b45c',
      cartaz: '#e2793a', ceu: '#f0d99a'
    },
    dica: 'Savana quente, acácias e muito espaço para correr.'
  },
  {
    id: 'oceania', prep: 'na',
    nome: 'Austrália · Oceania',
    nomeCurto: 'Austrália',
    icone: '🦘',
    continente: 'Oceania',
    col: 2, row: 1,
    bioma: 'outback',
    unlock: { tipo: 'descobertas', valor: 9 },
    mvp: true,
    paleta: {
      chao: '#e0a370', chaoAlt: '#cf8f5d', chaoDetalhe: '#eeb884',
      caminho: '#b9744a', caminhoBorda: '#a4643d',
      agua: '#57bcd6', tronco: '#9c8368', folha: '#7fae7c', folhaAlt: '#9cc493',
      cartaz: '#d9523c', ceu: '#f3c19a'
    },
    dica: 'Outback avermelhado, eucaliptos e pedras gigantes.'
  },
  {
    id: 'brasil', prep: 'no',
    nome: 'Brasil · Amazônia',
    nomeCurto: 'Brasil',
    icone: '🦜',
    continente: 'América do Sul',
    col: 0, row: 0,
    bioma: 'floresta',
    unlock: { tipo: 'embreve' },
    mvp: false,
    paleta: {
      chao: '#4f9a54', chaoAlt: '#438a48', chaoDetalhe: '#63ad66',
      caminho: '#8d6a44', caminhoBorda: '#7a5a39',
      agua: '#39a6c9', tronco: '#6b4a30', folha: '#2f7d45', folhaAlt: '#3f9a56',
      cartaz: '#2f9e63', ceu: '#7fc98a'
    },
    dica: 'Floresta tropical, rios e vegetação densa.'
  },
  {
    id: 'asia', prep: 'na',
    nome: 'Ásia · China',
    nomeCurto: 'Ásia',
    icone: '🐼',
    continente: 'Ásia',
    col: 1, row: 0,
    bioma: 'bambuzal',
    unlock: { tipo: 'embreve' },
    mvp: false,
    paleta: {
      chao: '#8fc98a', chaoAlt: '#7fbb7a', chaoDetalhe: '#a5d79f',
      caminho: '#d0b48f', caminhoBorda: '#bda079',
      agua: '#59bcd4', tronco: '#9aa85e', folha: '#5fa85f', folhaAlt: '#7cbd74',
      cartaz: '#d94f4f', ceu: '#bde2b6'
    },
    dica: 'Bambus, montanhas e arquitetura milenar.'
  },
  {
    id: 'polar', prep: 'na',
    nome: 'Região Polar',
    nomeCurto: 'Polar',
    icone: '🐧',
    continente: 'Antártida',
    col: 2, row: 0,
    bioma: 'gelo',
    unlock: { tipo: 'embreve' },
    mvp: false,
    paleta: {
      chao: '#eaf4fb', chaoAlt: '#dbe9f5', chaoDetalhe: '#ffffff',
      caminho: '#c6dcec', caminhoBorda: '#b0cbe0',
      agua: '#4fa8d8', tronco: '#b9cfdd', folha: '#dff0fa', folhaAlt: '#ffffff',
      cartaz: '#4f8fd9', ceu: '#dff0fa'
    },
    dica: 'Neve, gelo e geleiras flutuantes.'
  }
];

ZM.REGION_BY_ID = {};
ZM.REGIONS.forEach(function (r) { ZM.REGION_BY_ID[r.id] = r; });

ZM.regionNome = function (id) {
  var r = ZM.REGION_BY_ID[id];
  return r ? r.nomeCurto : id;
};
