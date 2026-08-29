/* ==========================================================================
   ZOO MUNDO - Personagens jogaveis
   ========================================================================== */
window.ZM = window.ZM || {};

ZM.PERSONAGENS = [
  { id: 'nina',  nome: 'Nina',  pele: '#f3c6a0', cabelo: '#3b2418', cabeloTipo: 'maria-chiquinha', roupa: '#f2643f', roupaAlt: '#ffd166', chapeu: '#2f9e63' },
  { id: 'tiago', nome: 'Tiago', pele: '#8a5a3c', cabelo: '#191210', cabeloTipo: 'curto',           roupa: '#4f8ef7', roupaAlt: '#ffd166', chapeu: '#f2a03d' },
  { id: 'aya',   nome: 'Aya',   pele: '#5c3a24', cabelo: '#241413', cabeloTipo: 'afro',            roupa: '#8b5cf6', roupaAlt: '#a7f3d0', chapeu: '#facc15' },
  { id: 'leo',   nome: 'Leo',   pele: '#f7d9bd', cabelo: '#c47a2c', cabeloTipo: 'topete',          roupa: '#22c1a4', roupaAlt: '#fde68a', chapeu: '#ef476f' }
];

ZM.PERSONAGEM_BY_ID = {};
ZM.PERSONAGENS.forEach(function (p) { ZM.PERSONAGEM_BY_ID[p.id] = p; });
