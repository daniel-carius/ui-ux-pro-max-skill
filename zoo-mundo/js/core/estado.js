/* ==========================================================================
   ZOO MUNDO - Estado do jogo + progresso salvo no navegador
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Estado = (function () {
  'use strict';

  var CHAVE = 'zoomundo.save.v1';
  var ouvintes = {};
  var dados = null;

  function padrao() {
    var posicoes = {};
    ZM.ANIMAIS.forEach(function (a) { posicoes[a.id] = a.spawn.regiao; });
    return {
      versao: 1,
      personagem: 'nina',
      pontos: 0,
      descobertos: [],          // ids de animais descobertos
      resgatados: [],           // ids levados para casa
      seguindo: [],             // ids que estão acompanhando o jogador (em fila)
      regioes: { praca: true }, // regioes desbloqueadas
      completas: [],            // regioes com carimbo
      posicaoAnimais: posicoes, // id -> regiao atual
      jogador: null,            // {x, y} no mundo
      som: true,
      iniciado: false
    };
  }

  function carregar() {
    try {
      var bruto = localStorage.getItem(CHAVE);
      if (bruto) {
        var j = JSON.parse(bruto);
        if (j && j.versao === 1) {
          dados = Object.assign(padrao(), j);
          // garante que animais novos adicionados depois tenham posicao
          ZM.ANIMAIS.forEach(function (a) {
            if (!dados.posicaoAnimais[a.id]) dados.posicaoAnimais[a.id] = a.spawn.regiao;
          });
          return dados;
        }
      }
    } catch (e) { /* ignora saves corrompidos */ }
    dados = padrao();
    return dados;
  }

  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) {}
  }

  function reiniciar() {
    dados = padrao();
    salvar();
    emitir('reiniciado', {});
  }

  function temSave() {
    try {
      var b = localStorage.getItem(CHAVE);
      if (!b) return false;
      var j = JSON.parse(b);
      return !!(j && j.iniciado);
    } catch (e) { return false; }
  }

  function get() { return dados || carregar(); }

  /* Eventos simples ---------------------------------------------------- */
  function ao(evento, fn) { (ouvintes[evento] = ouvintes[evento] || []).push(fn); }
  function emitir(evento, payload) {
    (ouvintes[evento] || []).forEach(function (fn) { fn(payload); });
  }

  /* Consultas ---------------------------------------------------------- */
  function descoberto(id) { return get().descobertos.indexOf(id) !== -1; }
  function regiaoLiberada(id) { return !!get().regioes[id]; }
  function totalDescobertos() { return get().descobertos.length; }
  function totalAnimais() { return ZM.ANIMAIS.length; }
  function regiaoDoAnimal(id) { return get().posicaoAnimais[id]; }

  function progressoRegiao(regiaoId) {
    var moram = ZM.animaisDaRegiao(regiaoId);
    var achados = moram.filter(function (a) { return descoberto(a.id); });
    return { total: moram.length, feitos: achados.length, completa: moram.length > 0 && achados.length === moram.length };
  }

  /* Acoes -------------------------------------------------------------- */
  function definirPersonagem(id) { get().personagem = id; salvar(); }

  function marcarIniciado() { get().iniciado = true; salvar(); }

  function salvarPosicaoJogador(x, y) {
    var d = get();
    d.jogador = { x: Math.round(x), y: Math.round(y) };
  }

  function somarPontos(n) {
    var d = get();
    d.pontos += n;
    emitir('pontos', d.pontos);
    salvar();
  }

  function descobrir(id) {
    var d = get();
    if (d.descobertos.indexOf(id) === -1) {
      d.descobertos.push(id);
      emitir('descoberta', id);
    }
    salvar();
  }

  /* O animal passa a acompanhar o jogador */
  function chamarParaSeguir(id) {
    var d = get();
    if (d.seguindo.indexOf(id) === -1) d.seguindo.push(id);
    salvar();
    emitir('seguindo', id);
  }

  function pararDeSeguir(id) {
    var d = get();
    var i = d.seguindo.indexOf(id);
    if (i !== -1) d.seguindo.splice(i, 1);
    salvar();
  }

  function estaSeguindo(id) { return get().seguindo.indexOf(id) !== -1; }
  function comitiva() { return get().seguindo.slice(); }

  function levarParaCasa(id) {
    var d = get();
    var animal = ZM.ANIMAL_BY_ID[id];
    d.posicaoAnimais[id] = animal.casa;
    if (d.resgatados.indexOf(id) === -1) d.resgatados.push(id);
    pararDeSeguir(id);
    salvar();
    emitir('resgate', id);
  }

  /* Verifica desbloqueios e carimbos. Retorna lista de novidades. */
  function verificarProgresso() {
    var d = get();
    var novidades = [];

    ZM.REGIONS.forEach(function (r) {
      if (d.regioes[r.id]) return;
      if (r.unlock.tipo === 'descobertas' && d.descobertos.length >= r.unlock.valor) {
        d.regioes[r.id] = true;
        novidades.push({ tipo: 'regiao', regiao: r });
      }
    });

    ZM.REGIONS.forEach(function (r) {
      if (d.completas.indexOf(r.id) !== -1) return;
      var p = progressoRegiao(r.id);
      if (p.completa) {
        d.completas.push(r.id);
        novidades.push({ tipo: 'carimbo', regiao: r });
      }
    });

    if (novidades.length) salvar();
    return novidades;
  }

  /* Proxima meta mostrada no HUD */
  function proximaMeta() {
    var d = get();
    var alvo = null;
    ZM.REGIONS.forEach(function (r) {
      if (alvo || d.regioes[r.id] || r.unlock.tipo !== 'descobertas') return;
      alvo = r;
    });
    if (!alvo) return null;
    return {
      regiao: alvo,
      faltam: Math.max(0, alvo.unlock.valor - d.descobertos.length),
      total: alvo.unlock.valor
    };
  }

  return {
    carregar: carregar, salvar: salvar, reiniciar: reiniciar, temSave: temSave, get: get,
    ao: ao, emitir: emitir,
    descoberto: descoberto, regiaoLiberada: regiaoLiberada,
    totalDescobertos: totalDescobertos, totalAnimais: totalAnimais,
    regiaoDoAnimal: regiaoDoAnimal, progressoRegiao: progressoRegiao,
    definirPersonagem: definirPersonagem, marcarIniciado: marcarIniciado,
    chamarParaSeguir: chamarParaSeguir, pararDeSeguir: pararDeSeguir,
    estaSeguindo: estaSeguindo, comitiva: comitiva,
    salvarPosicaoJogador: salvarPosicaoJogador, somarPontos: somarPontos,
    descobrir: descobrir, levarParaCasa: levarParaCasa,
    verificarProgresso: verificarProgresso, proximaMeta: proximaMeta
  };
})();
