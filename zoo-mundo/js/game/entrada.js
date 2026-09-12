/* ==========================================================================
   ZOO MUNDO - Entrada do jogador (teclado, toque e joystick virtual)
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Entrada = (function () {
  'use strict';
  var U = ZM.Utils;

  var teclas = {};
  var acaoNaFila = false;
  var cliqueNaFila = null;
  var joy = { ativo: false, id: null, baseX: 0, baseY: 0, x: 0, y: 0, dx: 0, dy: 0 };
  var elBase = null, elTopo = null, elZona = null;

  var MAPA = {
    ArrowUp: 'cima', KeyW: 'cima',
    ArrowDown: 'baixo', KeyS: 'baixo',
    ArrowLeft: 'esq', KeyA: 'esq',
    ArrowRight: 'dir', KeyD: 'dir'
  };

  function iniciar(canvas, zonaJoystick, baseJoystick, topoJoystick, botaoAcao) {
    elZona = zonaJoystick; elBase = baseJoystick; elTopo = topoJoystick;

    window.addEventListener('keydown', function (e) {
      if (MAPA[e.code]) { teclas[MAPA[e.code]] = true; e.preventDefault(); }
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
        acaoNaFila = true; e.preventDefault();
      }
    });
    window.addEventListener('keyup', function (e) {
      if (MAPA[e.code]) { teclas[MAPA[e.code]] = false; e.preventDefault(); }
    });
    window.addEventListener('blur', function () { teclas = {}; });

    // clique/toque direto no mapa (interagir com animal)
    canvas.addEventListener('pointerdown', function (e) {
      var r = canvas.getBoundingClientRect();
      cliqueNaFila = { x: e.clientX - r.left, y: e.clientY - r.top };
    });

    // joystick virtual
    if (elZona) {
      elZona.addEventListener('pointerdown', function (e) {
        joy.ativo = true; joy.id = e.pointerId;
        var r = elZona.getBoundingClientRect();
        joy.baseX = e.clientX - r.left; joy.baseY = e.clientY - r.top;
        posicionar();
        elZona.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      elZona.addEventListener('pointermove', function (e) {
        if (!joy.ativo || e.pointerId !== joy.id) return;
        var r = elZona.getBoundingClientRect();
        var dx = (e.clientX - r.left) - joy.baseX;
        var dy = (e.clientY - r.top) - joy.baseY;
        var d = Math.sqrt(dx * dx + dy * dy), max = 52;
        if (d > max) { dx = dx / d * max; dy = dy / d * max; d = max; }
        joy.x = dx; joy.y = dy;
        joy.dx = dx / max; joy.dy = dy / max;
        posicionar();
        e.preventDefault();
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        elZona.addEventListener(ev, function (e) {
          if (e.pointerId !== joy.id) return;
          joy.ativo = false; joy.dx = 0; joy.dy = 0; joy.x = 0; joy.y = 0;
          if (elBase) elBase.style.opacity = '0';
        });
      });
    }

    if (botaoAcao) {
      botaoAcao.addEventListener('pointerdown', function (e) {
        acaoNaFila = true; e.preventDefault();
      });
    }
  }

  function posicionar() {
    if (!elBase || !elTopo) return;
    elBase.style.opacity = '1';
    elBase.style.left = joy.baseX + 'px';
    elBase.style.top = joy.baseY + 'px';
    elTopo.style.left = (joy.baseX + joy.x) + 'px';
    elTopo.style.top = (joy.baseY + joy.y) + 'px';
  }

  function vetor() {
    var x = 0, y = 0;
    if (teclas.esq) x -= 1;
    if (teclas.dir) x += 1;
    if (teclas.cima) y -= 1;
    if (teclas.baixo) y += 1;
    if (joy.ativo) { x += joy.dx; y += joy.dy; }
    var d = Math.sqrt(x * x + y * y);
    if (d > 1) { x /= d; y /= d; }
    return { x: x, y: y, forca: Math.min(1, d) };
  }

  function consumirAcao() { var a = acaoNaFila; acaoNaFila = false; return a; }
  function consumirClique() { var c = cliqueNaFila; cliqueNaFila = null; return c; }
  function limpar() { teclas = {}; acaoNaFila = false; cliqueNaFila = null; }

  return { iniciar: iniciar, vetor: vetor, consumirAcao: consumirAcao, consumirClique: consumirClique, limpar: limpar };
})();
