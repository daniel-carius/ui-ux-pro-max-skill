/* ==========================================================================
   ZOO MUNDO - Sprites dos animais desenhados em vetor (canvas)
   Cada funcao desenha o animal com os pes em (0,0), altura ~ -100.
   Uso: ZM.SpritesAnimais.desenhar('leao', ctx, x, y, escala, tempo);
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.SpritesAnimais = (function () {
  'use strict';
  var U = ZM.Utils;

  /* ---------------------------- auxiliares ---------------------------- */
  function olho(ctx, x, y, r, brilho) {
    U.circle(ctx, x, y, r, '#241b16');
    U.circle(ctx, x - r * 0.3, y - r * 0.35, r * 0.38, 'rgba(255,255,255,' + (brilho === undefined ? 0.95 : brilho) + ')');
  }
  function sorriso(ctx, x, y, w, cor) {
    ctx.strokeStyle = cor || '#4a332a';
    ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, w, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  function perna(ctx, x, yTopo, largura, altura, cor, offset) {
    U.roundRect(ctx, x - largura / 2, yTopo, largura, altura + (offset || 0), largura / 2);
    ctx.fillStyle = cor; ctx.fill();
  }
  function corpo(ctx, x, y, rx, ry, cor, corBaixo) {
    U.ellipse(ctx, x, y, rx, ry, cor);
    if (corBaixo) {
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.clip();
      U.ellipse(ctx, x, y + ry * 0.55, rx * 0.8, ry * 0.6, corBaixo);
      ctx.restore();
    }
  }

  /* ------------------------------ animais ----------------------------- */
  var A = {};

  A.leao = function (ctx, t) {
    var b = Math.sin(t * 3) * 1.6, p = Math.sin(t * 7) * 3;
    perna(ctx, -20, -26, 13, 26, '#c9884a', p);
    perna(ctx, 20, -26, 13, 26, '#c9884a', -p);
    // cauda
    ctx.strokeStyle = '#d59a5a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(30, -40); ctx.quadraticCurveTo(52, -50 + b, 46, -70 + b); ctx.stroke();
    U.circle(ctx, 46, -74 + b, 7, '#8c5a2b');
    corpo(ctx, 0, -42 + b, 32, 24, '#e0a253', '#f2c68d');
    // juba
    var juba = '#c8722f';
    for (var i = 0; i < 11; i++) {
      var ang = (i / 11) * Math.PI * 2;
      U.circle(ctx, Math.cos(ang) * 26, -72 + b + Math.sin(ang) * 24, 11, juba);
    }
    U.circle(ctx, 0, -72 + b, 25, '#c8722f');
    U.circle(ctx, 0, -72 + b, 21, '#efb672');
    U.ellipse(ctx, 0, -64 + b, 13, 10, '#fbe0bb');
    olho(ctx, -8, -76 + b, 3.4); olho(ctx, 8, -76 + b, 3.4);
    U.ellipse(ctx, 0, -68 + b, 4, 3, '#7a4126');
    sorriso(ctx, 0, -66 + b, 6);
  };

  A.elefante = function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.5, p = Math.sin(t * 6) * 3, tr = Math.sin(t * 2) * 4;
    perna(ctx, -24, -28, 17, 28, '#8e99a5', p);
    perna(ctx, 24, -28, 17, 28, '#8e99a5', -p);
    ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(36, -46); ctx.quadraticCurveTo(48, -40, 44, -30); ctx.stroke();
    corpo(ctx, 0, -48 + b, 37, 28, '#9aa3ad', '#b3bcc6');
    // orelhas
    U.ellipse(ctx, -30, -76 + b, 17, 21, '#8794a0', -0.25);
    U.ellipse(ctx, 30, -76 + b, 17, 21, '#8794a0', 0.25);
    U.ellipse(ctx, -29, -76 + b, 11, 14, '#a9b5c0', -0.25);
    U.ellipse(ctx, 29, -76 + b, 11, 14, '#a9b5c0', 0.25);
    U.circle(ctx, 0, -78 + b, 24, '#a4aeb9');
    olho(ctx, -9, -84 + b, 3.2); olho(ctx, 9, -84 + b, 3.2);
    // tromba
    ctx.strokeStyle = '#a4aeb9'; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -70 + b);
    ctx.quadraticCurveTo(2 + tr, -54 + b, 10 + tr * 1.6, -44 + b); ctx.stroke();
    // presas
    ctx.strokeStyle = '#fff6e2'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-11, -68 + b); ctx.lineTo(-15, -56 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, -68 + b); ctx.lineTo(15, -56 + b); ctx.stroke();
  };

  A.girafa = function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.4, p = Math.sin(t * 6) * 3;
    perna(ctx, -18, -40, 11, 40, '#e3b667', p);
    perna(ctx, 18, -40, 11, 40, '#e3b667', -p);
    ctx.strokeStyle = '#dcae5d'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(24, -54); ctx.quadraticCurveTo(38, -58, 34, -70); ctx.stroke();
    corpo(ctx, 0, -54 + b, 27, 21, '#f2c46b', '#fadfa5');
    // pescoco
    ctx.save();
    U.roundRect(ctx, -9, -104 + b, 20, 56, 9); ctx.fillStyle = '#f2c46b'; ctx.fill();
    // manchas
    ctx.beginPath(); U.roundRect(ctx, -9, -104 + b, 20, 56, 9); ctx.clip();
    var m = [[-4, -96], [6, -86], [-3, -74], [7, -62], [-4, -54]];
    m.forEach(function (q) { U.ellipse(ctx, q[0], q[1] + b, 5.5, 4.5, '#c58c3c'); });
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, -54 + b, 27, 21, 0, 0, Math.PI * 2); ctx.clip();
    [[-16, -60], [-4, -48], [12, -58], [16, -44], [-14, -44]].forEach(function (q) {
      U.ellipse(ctx, q[0], q[1] + b, 6, 5, '#c58c3c');
    });
    ctx.restore();
    // cabeca
    U.ellipse(ctx, 2, -110 + b, 15, 12, '#f7ce7c');
    U.ellipse(ctx, 10, -105 + b, 9, 7, '#f0bd63');
    U.ellipse(ctx, -12, -114 + b, 8, 5, '#f7ce7c', -0.5);
    U.ellipse(ctx, 15, -117 + b, 7, 5, '#f7ce7c', 0.4);
    ctx.strokeStyle = '#c58c3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-1, -118 + b); ctx.lineTo(-3, -126 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -119 + b); ctx.lineTo(6, -127 + b); ctx.stroke();
    U.circle(ctx, -3, -127 + b, 3, '#8c5a2b'); U.circle(ctx, 6, -128 + b, 3, '#8c5a2b');
    olho(ctx, -3, -113 + b, 3); olho(ctx, 8, -112 + b, 3);
    U.circle(ctx, 14, -104 + b, 1.6, '#8c5a2b');
  };

  A.zebra = function (ctx, t) {
    var b = Math.sin(t * 3) * 1.5, p = Math.sin(t * 7) * 3;
    perna(ctx, -20, -28, 12, 28, '#e9e9ec', p);
    perna(ctx, 20, -28, 12, 28, '#e9e9ec', -p);
    ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(28, -46); ctx.quadraticCurveTo(44, -50, 40, -66); ctx.stroke();
    ctx.save();
    corpo(ctx, 0, -46 + b, 31, 23, '#f4f4f6');
    ctx.beginPath(); ctx.ellipse(0, -46 + b, 31, 23, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2f2f38';
    for (var i = -3; i <= 3; i++) {
      ctx.save(); ctx.translate(i * 9, -46 + b); ctx.rotate(0.18);
      ctx.fillRect(-3, -26, 6, 52); ctx.restore();
    }
    ctx.restore();
    // cabeca
    ctx.save();
    U.ellipse(ctx, 4, -74 + b, 17, 15, '#f4f4f6');
    ctx.beginPath(); ctx.ellipse(4, -74 + b, 17, 15, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2f2f38';
    ctx.fillRect(-4, -92 + b, 4, 22); ctx.fillRect(5, -92 + b, 4, 22); ctx.fillRect(14, -92 + b, 4, 22);
    ctx.restore();
    U.ellipse(ctx, 14, -68 + b, 10, 8, '#5c5c66');
    U.ellipse(ctx, -6, -87 + b, 5, 8, '#f4f4f6', -0.3);
    U.ellipse(ctx, 12, -88 + b, 5, 8, '#f4f4f6', 0.3);
    olho(ctx, 0, -76 + b, 3.2); olho(ctx, 12, -78 + b, 3);
    U.circle(ctx, 18, -67 + b, 2, '#2f2f38');
  };

  A.rinoceronte = function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.4, p = Math.sin(t * 6.4) * 3;
    perna(ctx, -22, -24, 16, 24, '#8f8d96', p);
    perna(ctx, 22, -24, 16, 24, '#8f8d96', -p);
    ctx.strokeStyle = '#9c9aa3'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(34, -44); ctx.quadraticCurveTo(46, -42, 44, -30); ctx.stroke();
    corpo(ctx, 0, -44 + b, 36, 26, '#a9a7b0', '#c0bec6');
    U.ellipse(ctx, 0, -46 + b, 22, 12, '#b6b4bd', -0.1);
    // cabeca
    U.ellipse(ctx, -4, -72 + b, 24, 18, '#b0aeb7');
    U.ellipse(ctx, -20, -66 + b, 13, 10, '#bcbac3');
    // chifres
    ctx.fillStyle = '#f0ead9';
    ctx.beginPath(); ctx.moveTo(-30, -70 + b); ctx.quadraticCurveTo(-38, -86 + b, -26, -84 + b);
    ctx.quadraticCurveTo(-24, -76 + b, -22, -70 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-16, -78 + b); ctx.quadraticCurveTo(-14, -88 + b, -8, -80 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, 6, -88 + b, 5, 7, '#9c9aa3'); U.ellipse(ctx, 16, -86 + b, 5, 7, '#9c9aa3');
    olho(ctx, -6, -76 + b, 3); olho(ctx, 8, -74 + b, 3);
    U.circle(ctx, -26, -62 + b, 2, '#6f6d76');
  };

  A.hipopotamo = function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.4, p = Math.sin(t * 6) * 2.6;
    perna(ctx, -22, -20, 17, 20, '#a37b95', p);
    perna(ctx, 22, -20, 17, 20, '#a37b95', -p);
    corpo(ctx, 0, -40 + b, 38, 24, '#b58fa8', '#cba7bd');
    U.ellipse(ctx, -2, -66 + b, 27, 20, '#bd97b0');
    // focinho
    U.ellipse(ctx, -2, -58 + b, 22, 13, '#d5b0c6');
    U.circle(ctx, -10, -60 + b, 2.4, '#7e5f73'); U.circle(ctx, 6, -60 + b, 2.4, '#7e5f73');
    sorriso(ctx, -2, -58 + b, 10, '#8b6a80');
    // orelhinhas + olhos no alto
    U.ellipse(ctx, -18, -84 + b, 6, 5, '#bd97b0'); U.ellipse(ctx, 14, -84 + b, 6, 5, '#bd97b0');
    olho(ctx, -12, -76 + b, 3.4); olho(ctx, 9, -76 + b, 3.4);
  };

  A.canguru = function (ctx, t) {
    var b = Math.sin(t * 3.2) * 2;
    // cauda
    ctx.strokeStyle = '#c07f4e'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, -28); ctx.quadraticCurveTo(34, -20, 46, -6); ctx.stroke();
    // pes
    U.roundRect(ctx, -22, -12, 30, 12, 6); ctx.fillStyle = '#b8763f'; ctx.fill();
    // pernas fortes
    U.ellipse(ctx, -6, -30 + b, 15, 20, '#cf8b58');
    corpo(ctx, 0, -56 + b, 20, 26, '#d9975f', '#eec49a');
    // bolsa
    U.ellipse(ctx, -6, -48 + b, 12, 12, '#e8b884');
    U.circle(ctx, -8, -50 + b, 5, '#c98a55');
    olho(ctx, -10, -51 + b, 1.6, 0.8); olho(ctx, -6, -51 + b, 1.6, 0.8);
    // bracinhos
    ctx.strokeStyle = '#cf8b58'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-12, -66 + b); ctx.lineTo(-18, -58 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, -66 + b); ctx.lineTo(18, -58 + b); ctx.stroke();
    // cabeca
    U.ellipse(ctx, 0, -86 + b, 16, 15, '#dc9c65');
    U.ellipse(ctx, 4, -80 + b, 11, 8, '#f0c79a');
    U.ellipse(ctx, -10, -104 + b, 5.5, 13, '#dc9c65', -0.16);
    U.ellipse(ctx, 10, -104 + b, 5.5, 13, '#dc9c65', 0.16);
    U.ellipse(ctx, -10, -104 + b, 3, 9, '#f3b8a0', -0.16);
    U.ellipse(ctx, 10, -104 + b, 3, 9, '#f3b8a0', 0.16);
    olho(ctx, -6, -88 + b, 3.2); olho(ctx, 7, -88 + b, 3.2);
    U.circle(ctx, 6, -78 + b, 2.4, '#5f3f28');
    sorriso(ctx, 4, -77 + b, 5);
  };

  A.coala = function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.5;
    perna(ctx, -14, -14, 13, 14, '#9aa3ad');
    perna(ctx, 14, -14, 13, 14, '#9aa3ad');
    corpo(ctx, 0, -38 + b, 26, 25, '#b0b9c3', '#d7dee5');
    ctx.strokeStyle = '#a4adb7'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-20, -44 + b); ctx.lineTo(-26, -32 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, -44 + b); ctx.lineTo(26, -32 + b); ctx.stroke();
    // orelhas fofas
    U.circle(ctx, -22, -74 + b, 14, '#b7c0ca');
    U.circle(ctx, 22, -74 + b, 14, '#b7c0ca');
    U.circle(ctx, -22, -74 + b, 9, '#e7edf2');
    U.circle(ctx, 22, -74 + b, 9, '#e7edf2');
    U.circle(ctx, 0, -68 + b, 21, '#bcc5cf');
    U.ellipse(ctx, 0, -60 + b, 14, 10, '#dbe2e9');
    // nariz grande
    U.ellipse(ctx, 0, -66 + b, 8, 10, '#3f3a3d');
    U.ellipse(ctx, -2, -69 + b, 2.6, 3, 'rgba(255,255,255,0.45)');
    olho(ctx, -11, -73 + b, 3.2); olho(ctx, 11, -73 + b, 3.2);
    sorriso(ctx, 0, -57 + b, 5, '#5b5257');
  };

  A.wombat = function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.2, p = Math.sin(t * 7) * 2;
    perna(ctx, -18, -12, 13, 12, '#7d5c3f', p);
    perna(ctx, 18, -12, 13, 12, '#7d5c3f', -p);
    corpo(ctx, 0, -30 + b, 33, 21, '#9c7350', '#bb9068');
    U.ellipse(ctx, -20, -50 + b, 20, 17, '#a87d58');
    U.circle(ctx, -32, -62 + b, 7, '#a87d58'); U.circle(ctx, -10, -64 + b, 7, '#a87d58');
    U.circle(ctx, -32, -62 + b, 4, '#c79f7c'); U.circle(ctx, -10, -64 + b, 4, '#c79f7c');
    U.ellipse(ctx, -30, -46 + b, 12, 9, '#c09068');
    U.ellipse(ctx, -36, -47 + b, 4.5, 3.5, '#4b3626');
    olho(ctx, -26, -54 + b, 3); olho(ctx, -12, -54 + b, 3);
    sorriso(ctx, -30, -44 + b, 5, '#5c4331');
  };

  A.emu = function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.6, p = Math.sin(t * 6) * 4;
    ctx.strokeStyle = '#c0a184'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -30); ctx.lineTo(-10 + p, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -30); ctx.lineTo(12 - p, -2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10 + p, -2); ctx.lineTo(-18 + p, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12 - p, -2); ctx.lineTo(20 - p, 0); ctx.stroke();
    // corpo penugento
    corpo(ctx, 0, -48 + b, 28, 23, '#8b7963');
    for (var i = 0; i < 7; i++) {
      var ang = i / 7 * Math.PI * 2;
      U.circle(ctx, Math.cos(ang) * 20, -48 + b + Math.sin(ang) * 15, 8, 'rgba(122,106,86,0.55)');
    }
    // pescoco
    ctx.strokeStyle = '#7a6a5a'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -58 + b); ctx.quadraticCurveTo(-20, -76 + b, -14, -94 + b); ctx.stroke();
    U.ellipse(ctx, -14, -100 + b, 11, 10, '#6f6053');
    ctx.fillStyle = '#e2a13d';
    ctx.beginPath(); ctx.moveTo(-24, -100 + b); ctx.lineTo(-36, -97 + b); ctx.lineTo(-24, -94 + b); ctx.closePath(); ctx.fill();
    olho(ctx, -16, -103 + b, 3);
  };

  A.diabo = function (ctx, t) {
    var b = Math.sin(t * 3.4) * 1.4, p = Math.sin(t * 8) * 2;
    perna(ctx, -16, -12, 12, 12, '#25232a', p);
    perna(ctx, 16, -12, 12, 12, '#25232a', -p);
    ctx.strokeStyle = '#2c2a32'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(26, -26); ctx.quadraticCurveTo(42, -22, 44, -10); ctx.stroke();
    corpo(ctx, 0, -32 + b, 30, 21, '#33313a');
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, -32 + b, 30, 21, 0, 0, Math.PI * 2); ctx.clip();
    U.ellipse(ctx, -6, -22 + b, 18, 6, '#f3f0ee');
    ctx.restore();
    U.ellipse(ctx, -14, -52 + b, 21, 18, '#3a3841');
    U.ellipse(ctx, -22, -46 + b, 12, 9, '#46434d');
    U.circle(ctx, -28, -66 + b, 8, '#e2707f'); U.circle(ctx, -4, -68 + b, 8, '#e2707f');
    U.circle(ctx, -28, -66 + b, 4.5, '#f7b3bd'); U.circle(ctx, -4, -68 + b, 4.5, '#f7b3bd');
    olho(ctx, -21, -55 + b, 3.2, 1); olho(ctx, -7, -56 + b, 3.2, 1);
    U.circle(ctx, -30, -46 + b, 2.4, '#161418');
    // sorriso com dentinhos
    ctx.fillStyle = '#f6f3f0';
    ctx.beginPath(); ctx.moveTo(-30, -42 + b); ctx.lineTo(-26, -37 + b); ctx.lineTo(-22, -42 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-20, -42 + b); ctx.lineTo(-16, -37 + b); ctx.lineTo(-13, -42 + b); ctx.closePath(); ctx.fill();
  };

  A.ornitorrinco = function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.3;
    // cauda achatada
    U.ellipse(ctx, 30, -18 + b, 18, 10, '#6f4b30', 0.15);
    perna(ctx, -12, -10, 11, 10, '#5f4029');
    perna(ctx, 14, -10, 11, 10, '#5f4029');
    corpo(ctx, 0, -28 + b, 30, 19, '#8b6242', '#a87c56');
    U.ellipse(ctx, -22, -44 + b, 17, 14, '#996b48');
    // bico de pato
    U.ellipse(ctx, -40, -40 + b, 15, 7, '#3f3a41', -0.1);
    U.ellipse(ctx, -40, -41 + b, 12, 5, '#57505a', -0.1);
    olho(ctx, -26, -49 + b, 3); olho(ctx, -16, -47 + b, 3);
    // patas com membrana
    ctx.fillStyle = '#4a3324';
    ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-6, 0); ctx.lineTo(-11, -5); ctx.closePath(); ctx.fill();
  };

  /* --------------------------- API publica ---------------------------- */
  var offscreen = null;

  function desenhar(id, ctx, x, y, escala, tempo, opcoes) {
    var fn = A[id];
    if (!fn) return;
    var o = opcoes || {};
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(escala * (o.espelhar ? -1 : 1), escala);
    if (o.sombra !== false) U.shadow(ctx, 0, 0, 34, 10, 0.15);
    fn(ctx, tempo || 0);
    ctx.restore();
  }

  /* Silhueta preenchida (usada nos cards ainda nao descobertos) */
  function desenharSilhueta(id, ctx, x, y, escala, cor) {
    var w = 260, h = 260;
    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreen.width = w; offscreen.height = h;
    }
    var o = offscreen.getContext('2d');
    o.clearRect(0, 0, w, h);
    desenhar(id, o, w / 2, h - 40, 1.1, 0, { sombra: false });
    o.globalCompositeOperation = 'source-in';
    o.fillStyle = cor || '#0f172a';
    o.fillRect(0, 0, w, h);
    o.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(escala, escala);
    ctx.drawImage(offscreen, -w / 2, -(h - 40));
    ctx.restore();
  }

  function existe(id) { return !!A[id]; }

  return { desenhar: desenhar, desenharSilhueta: desenharSilhueta, existe: existe, lista: A };
})();
