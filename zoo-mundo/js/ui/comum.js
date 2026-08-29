/* ==========================================================================
   ZOO MUNDO - Utilidades de interface (modais, canvas de sprites, festa)
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.UI = (function () {
  'use strict';

  var aoFecharModal = null;

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function abrirModal(id, aoFechar) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('ativo');
    aoFecharModal = aoFechar || null;
    ZM.Jogo.pausar(true);
  }

  function fecharModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('ativo');
    if (!document.querySelector('.modal.ativo') && !document.querySelector('.aviso-regiao.ativo')) {
      ZM.Jogo.pausar(false);
    }
    var fn = aoFecharModal; aoFecharModal = null;
    if (fn) fn();
  }

  function fecharTodos() {
    $$('.modal.ativo').forEach(function (m) { m.classList.remove('ativo'); });
    ZM.Jogo.pausar(false);
  }

  /* Canvas com o sprite de um animal (ou silhueta) */
  function canvasAnimal(spriteId, tamanho, opcoes) {
    var o = opcoes || {};
    var c = document.createElement('canvas');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = tamanho * dpr; c.height = tamanho * dpr;
    c.style.width = tamanho + 'px'; c.style.height = tamanho + 'px';
    var ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    var escala = (tamanho / 165) * (o.zoom || 1);
    var baseY = tamanho * 0.9;
    if (o.silhueta) {
      ZM.SpritesAnimais.desenharSilhueta(spriteId, ctx, tamanho / 2, baseY, escala, o.cor || '#c3b7a2');
    } else {
      ZM.SpritesAnimais.desenhar(spriteId, ctx, tamanho / 2, baseY, escala, o.tempo || 0, { sombra: o.sombra !== false });
    }
    return c;
  }

  /* Canvas animado do animal (usado no modal de encontro) */
  function canvasAnimalAnimado(spriteId, largura, altura) {
    var c = document.createElement('canvas');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = largura * dpr; c.height = altura * dpr;
    c.style.width = '100%'; c.style.maxWidth = largura + 'px'; c.style.height = 'auto';
    var ctx = c.getContext('2d');
    var inicio = performance.now();
    var vivo = true;
    function quadro(agora) {
      if (!vivo || !c.isConnected) { vivo = false; return; }
      var t = (agora - inicio) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, largura, altura);
      // chao decorativo
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#e8c98a';
      ctx.beginPath(); ctx.ellipse(largura / 2, altura - 22, 96, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ZM.SpritesAnimais.desenhar(spriteId, ctx, largura / 2, altura - 22, (altura / 190), t);
      requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);
    return c;
  }

  function canvasPersonagem(personagem, tamanho, dir) {
    var c = document.createElement('canvas');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = tamanho * dpr; c.height = tamanho * dpr;
    c.style.width = tamanho + 'px'; c.style.height = tamanho + 'px';
    var ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    var inicio = performance.now();
    function quadro(agora) {
      if (!c.isConnected && agora - inicio > 2000) return;
      var t = (agora - inicio) / 1000;
      ctx.clearRect(0, 0, tamanho, tamanho);
      ZM.SpritesPersonagem.desenhar(ctx, personagem, tamanho / 2, tamanho * 0.94,
        tamanho / 95, dir || 'baixo', t * 6, false, t);
      requestAnimationFrame(quadro);
    }
    requestAnimationFrame(quadro);
    return c;
  }

  /* Confete comemorativo */
  function confete(quantidade) {
    var alvo = document.getElementById('festa');
    if (!alvo) return;
    var cores = ['#ffd166', '#ff8fab', '#7fd39b', '#4f8ef7', '#f97316', '#8b5cf6'];
    for (var i = 0; i < (quantidade || 60); i++) {
      var p = document.createElement('i');
      p.className = 'confete';
      p.style.left = Math.random() * 100 + '%';
      p.style.background = cores[Math.floor(Math.random() * cores.length)];
      p.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.width = (7 + Math.random() * 8) + 'px';
      p.style.height = (10 + Math.random() * 10) + 'px';
      alvo.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 3600); })(p);
    }
  }

  /* Aviso grande de nova regiao / carimbo */
  var filaAvisos = [];
  var mostrandoAviso = false;

  function aviso(dados) {
    filaAvisos.push(dados);
    if (!mostrandoAviso) proximoAviso();
  }

  function proximoAviso() {
    var dados = filaAvisos.shift();
    var el = document.getElementById('aviso-regiao');
    if (!dados) {
      mostrandoAviso = false;
      el.classList.remove('ativo');
      if (!document.querySelector('.modal.ativo')) ZM.Jogo.pausar(false);
      return;
    }
    mostrandoAviso = true;
    ZM.Jogo.pausar(true);
    document.getElementById('aviso-icone').textContent = dados.icone || '🎉';
    document.getElementById('aviso-titulo').textContent = dados.titulo || '';
    document.getElementById('aviso-texto').textContent = dados.texto || '';
    var ok = document.getElementById('aviso-ok');
    ok.textContent = dados.botao || 'OBA!';
    el.classList.add('ativo');
    confete(dados.confete || 70);
    ZM.Audio.tocar(dados.som || 'desbloqueio');
    ok.onclick = function () {
      ZM.Audio.tocar('ui');
      if (dados.aoFechar) dados.aoFechar();
      proximoAviso();
    };
  }

  return {
    $: $, $$: $$, abrirModal: abrirModal, fecharModal: fecharModal, fecharTodos: fecharTodos,
    canvasAnimal: canvasAnimal, canvasAnimalAnimado: canvasAnimalAnimado,
    canvasPersonagem: canvasPersonagem, confete: confete, aviso: aviso
  };
})();
