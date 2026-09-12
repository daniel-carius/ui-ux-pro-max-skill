/* ==========================================================================
   ZOO MUNDO - Sprites dos animais do Brasil, da Ásia e da Região Polar
   Mesma convenção do arquivo sprites-animais.js: pés em (0,0), altura ~ -100.
   ========================================================================== */
(function () {
  'use strict';
  var U = ZM.Utils;
  var aux = ZM.SpritesAnimais.aux;
  var olho = aux.olho, sorriso = aux.sorriso, perna = aux.perna, corpo = aux.corpo;
  var reg = ZM.SpritesAnimais.registrar;

  /* ========================= BRASIL / AMAZÔNIA ========================= */

  reg('onca', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.6, p = Math.sin(t * 7) * 3;
    perna(ctx, -20, -24, 13, 24, '#d99f4d', p);
    perna(ctx, 20, -24, 13, 24, '#d99f4d', -p);
    ctx.strokeStyle = '#e8b45c'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(28, -40); ctx.quadraticCurveTo(50, -44 + b, 46, -64 + b); ctx.stroke();
    ctx.save();
    corpo(ctx, 0, -42 + b, 32, 23, '#e8b45c', '#f7dba6');
    ctx.beginPath(); ctx.ellipse(0, -42 + b, 32, 23, 0, 0, Math.PI * 2); ctx.clip();
    roseta(ctx, [[-18, -50], [-4, -38], [12, -50], [20, -36], [-14, -32], [4, -56]], b);
    ctx.restore();
    U.circle(ctx, 0, -70 + b, 23, '#eeba66');
    U.ellipse(ctx, -18, -86 + b, 8, 8, '#d99f4d');
    U.ellipse(ctx, 18, -86 + b, 8, 8, '#d99f4d');
    U.ellipse(ctx, -18, -86 + b, 4, 4, '#f7dba6');
    U.ellipse(ctx, 18, -86 + b, 4, 4, '#f7dba6');
    ctx.save();
    ctx.beginPath(); ctx.arc(0, -70 + b, 23, 0, Math.PI * 2); ctx.clip();
    roseta(ctx, [[-16, -80], [14, -82], [-12, -62], [16, -60]], b, 4);
    ctx.restore();
    U.ellipse(ctx, 0, -63 + b, 13, 10, '#fbe8c6');
    olho(ctx, -8, -74 + b, 3.4); olho(ctx, 8, -74 + b, 3.4);
    U.ellipse(ctx, 0, -66 + b, 4, 3, '#4a332a');
    sorriso(ctx, 0, -64 + b, 6);
  });

  function roseta(ctx, pontos, b, r) {
    ctx.fillStyle = 'rgba(64,42,24,0.85)';
    pontos.forEach(function (q) {
      ctx.beginPath();
      ctx.arc(q[0], q[1] + b, r || 5.5, 0, Math.PI * 2);
      ctx.arc(q[0] + 2, q[1] + 2 + b, (r || 5.5) * 0.45, 0, Math.PI * 2);
      ctx.fill('evenodd');
    });
  }

  reg('arara', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 2, asa = Math.sin(t * 3) * 0.12;
    // cauda comprida
    ctx.fillStyle = '#2f5cc0';
    ctx.beginPath(); ctx.moveTo(6, -34 + b); ctx.lineTo(30, 2); ctx.lineTo(40, -6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a6fd8';
    ctx.beginPath(); ctx.moveTo(4, -40 + b); ctx.lineTo(24, -4); ctx.lineTo(34, -14); ctx.closePath(); ctx.fill();
    // patas
    ctx.strokeStyle = '#5b5a63'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -26 + b); ctx.lineTo(-8, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -26 + b); ctx.lineTo(8, -2); ctx.stroke();
    corpo(ctx, 0, -52 + b, 22, 27, '#3a6fd8', '#5c8ceb');
    // asa
    ctx.save(); ctx.translate(-12, -56 + b); ctx.rotate(asa);
    U.ellipse(ctx, 0, 0, 12, 21, '#2f5cc0', 0.15);
    U.ellipse(ctx, 1, 6, 8, 13, '#4d7fe0', 0.15);
    ctx.restore();
    // cabeça
    U.circle(ctx, -2, -84 + b, 16, '#4275e0');
    U.ellipse(ctx, -8, -82 + b, 9, 9, '#f7f2e4');           // face clara
    ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-9, -84 + b, 6.5, 0, Math.PI * 2); ctx.stroke();
    olho(ctx, -9, -85 + b, 3);
    // bico curvo
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath();
    ctx.moveTo(-14, -80 + b);
    ctx.quadraticCurveTo(-30, -80 + b, -24, -66 + b);
    ctx.quadraticCurveTo(-18, -70 + b, -12, -72 + b);
    ctx.closePath(); ctx.fill();
    U.ellipse(ctx, -18, -78 + b, 4, 2.5, '#4d4d55');
  });

  reg('tucano', function (ctx, t) {
    var b = Math.sin(t * 2.8) * 2;
    ctx.strokeStyle = '#5b5a63'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, -24 + b); ctx.lineTo(-7, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -24 + b); ctx.lineTo(8, -2); ctx.stroke();
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath(); ctx.moveTo(10, -38 + b); ctx.lineTo(34, -12); ctx.lineTo(36, -26); ctx.closePath(); ctx.fill();
    corpo(ctx, 0, -50 + b, 22, 26, '#2b2b30');
    U.ellipse(ctx, -4, -52 + b, 13, 17, '#fff3cf');          // peito
    U.ellipse(ctx, 10, -54 + b, 10, 16, '#1f1f23', 0.15);    // asa
    U.circle(ctx, -2, -80 + b, 15, '#2b2b30');
    U.ellipse(ctx, -6, -76 + b, 9, 9, '#fff3cf');
    olho(ctx, -6, -84 + b, 3.2, 1);
    // bico enorme
    ctx.fillStyle = '#f0a63c';
    ctx.beginPath();
    ctx.moveTo(-12, -84 + b);
    ctx.quadraticCurveTo(-46, -82 + b, -40, -68 + b);
    ctx.quadraticCurveTo(-26, -68 + b, -12, -72 + b);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9762c';
    ctx.beginPath();
    ctx.moveTo(-30, -78 + b); ctx.quadraticCurveTo(-44, -78 + b, -40, -68 + b);
    ctx.quadraticCurveTo(-34, -70 + b, -28, -72 + b); ctx.closePath(); ctx.fill();
  });

  reg('preguica', function (ctx, t) {
    var b = Math.sin(t * 1.3) * 2;                            // bem devagar
    perna(ctx, -13, -14, 12, 14, '#8d7a5f');
    perna(ctx, 13, -14, 12, 14, '#8d7a5f');
    corpo(ctx, 0, -38 + b, 25, 24, '#a08d70', '#c3b394');
    // braços compridos com garras
    ctx.strokeStyle = '#8d7a5f'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-18, -46 + b); ctx.quadraticCurveTo(-32, -40 + b, -30, -24 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(18, -46 + b); ctx.quadraticCurveTo(32, -40 + b, 30, -24 + b); ctx.stroke();
    ctx.strokeStyle = '#5f5140'; ctx.lineWidth = 3;
    [-30, 30].forEach(function (x) {
      ctx.beginPath(); ctx.moveTo(x, -24 + b); ctx.lineTo(x + (x < 0 ? -6 : 6), -16 + b); ctx.stroke();
    });
    U.circle(ctx, 0, -64 + b, 20, '#b3a184');
    U.ellipse(ctx, 0, -60 + b, 15, 13, '#e2d6bd');           // rosto claro
    // máscara escura ao redor dos olhos
    U.ellipse(ctx, -8, -66 + b, 6.5, 5, '#7a6a52', -0.3);
    U.ellipse(ctx, 8, -66 + b, 6.5, 5, '#7a6a52', 0.3);
    olho(ctx, -8, -66 + b, 3); olho(ctx, 8, -66 + b, 3);
    U.ellipse(ctx, 0, -57 + b, 4, 3, '#5f5140');
    sorriso(ctx, 0, -55 + b, 6, '#6d5c46');
  });

  reg('capivara', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.2, p = Math.sin(t * 6.5) * 2;
    perna(ctx, -18, -12, 12, 12, '#8a6440', p);
    perna(ctx, 18, -12, 12, 12, '#8a6440', -p);
    corpo(ctx, 0, -30 + b, 34, 21, '#a67b4e', '#c39a6c');
    U.ellipse(ctx, -22, -48 + b, 20, 16, '#b0855a');
    U.circle(ctx, -34, -60 + b, 5.5, '#8a6440'); U.circle(ctx, -14, -62 + b, 5.5, '#8a6440');
    // focinho retangular
    U.roundRect(ctx, -44, -50 + b, 18, 13, 6); ctx.fillStyle = '#bb9067'; ctx.fill();
    U.circle(ctx, -39, -45 + b, 2, '#4b3626'); U.circle(ctx, -33, -45 + b, 2, '#4b3626');
    olho(ctx, -28, -54 + b, 3); olho(ctx, -15, -55 + b, 3);
    sorriso(ctx, -35, -41 + b, 5, '#5c4331');
  });

  reg('macaco', function (ctx, t) {
    var b = Math.sin(t * 3.4) * 2;
    // cauda enrolada
    ctx.strokeStyle = '#8b6239'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(16, -34 + b);
    ctx.quadraticCurveTo(44, -40 + b, 38, -58 + b);
    ctx.quadraticCurveTo(34, -68 + b, 26, -62 + b);
    ctx.stroke();
    perna(ctx, -12, -14, 11, 14, '#7a5531');
    perna(ctx, 12, -14, 11, 14, '#7a5531');
    corpo(ctx, 0, -38 + b, 22, 22, '#8b6239', '#c8a97e');
    ctx.strokeStyle = '#8b6239'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-16, -46 + b); ctx.lineTo(-24, -32 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, -46 + b); ctx.lineTo(24, -32 + b); ctx.stroke();
    U.circle(ctx, 0, -66 + b, 18, '#9a6f42');
    U.circle(ctx, -18, -68 + b, 7, '#9a6f42'); U.circle(ctx, 18, -68 + b, 7, '#9a6f42');
    U.circle(ctx, -18, -68 + b, 4, '#c9a274'); U.circle(ctx, 18, -68 + b, 4, '#c9a274');
    U.ellipse(ctx, 0, -64 + b, 13, 12, '#e3c295');          // rosto claro
    U.ellipse(ctx, 0, -77 + b, 11, 6, '#5f4328');            // topete
    olho(ctx, -5, -68 + b, 3); olho(ctx, 5, -68 + b, 3);
    U.circle(ctx, -2, -60 + b, 1.6, '#5f4328'); U.circle(ctx, 2, -60 + b, 1.6, '#5f4328');
    sorriso(ctx, 0, -58 + b, 5);
  });

  /* ============================ ÁSIA / CHINA =========================== */

  reg('panda', function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.4;
    perna(ctx, -15, -16, 14, 16, '#2c2c30');
    perna(ctx, 15, -16, 14, 16, '#2c2c30');
    corpo(ctx, 0, -42 + b, 28, 26, '#f6f4ef');
    U.ellipse(ctx, -22, -50 + b, 9, 16, '#2c2c30', -0.2);   // braços pretos
    U.ellipse(ctx, 22, -50 + b, 9, 16, '#2c2c30', 0.2);
    U.circle(ctx, -18, -78 + b, 9, '#2c2c30'); U.circle(ctx, 18, -78 + b, 9, '#2c2c30');
    U.circle(ctx, 0, -70 + b, 22, '#f6f4ef');
    U.ellipse(ctx, -10, -74 + b, 7.5, 9, '#2c2c30', -0.25);  // manchas dos olhos
    U.ellipse(ctx, 10, -74 + b, 7.5, 9, '#2c2c30', 0.25);
    olho(ctx, -10, -74 + b, 3.2, 1); olho(ctx, 10, -74 + b, 3.2, 1);
    U.ellipse(ctx, 0, -64 + b, 5, 3.5, '#2c2c30');
    sorriso(ctx, 0, -62 + b, 6, '#3a3a40');
    // bambu na mão
    ctx.strokeStyle = '#8fbf5a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(24, -60 + b); ctx.lineTo(32, -84 + b); ctx.stroke();
    U.ellipse(ctx, 38, -84 + b, 9, 4, '#a7d46f', 0.3);
    U.ellipse(ctx, 28, -90 + b, 8, 3.5, '#a7d46f', -0.4);
  });

  reg('tigre', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.6, p = Math.sin(t * 7) * 3;
    perna(ctx, -20, -24, 14, 24, '#e08434', p);
    perna(ctx, 20, -24, 14, 24, '#e08434', -p);
    ctx.strokeStyle = '#f0913f'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(28, -40); ctx.quadraticCurveTo(52, -42 + b, 48, -62 + b); ctx.stroke();
    ctx.save();
    corpo(ctx, 0, -42 + b, 32, 23, '#f0913f', '#fbe0bd');
    ctx.beginPath(); ctx.ellipse(0, -42 + b, 32, 23, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2f2a26';
    for (var i = -2; i <= 2; i++) {
      ctx.save(); ctx.translate(i * 12, -42 + b); ctx.rotate(0.2);
      ctx.fillRect(-2.5, -26, 5, 24); ctx.restore();
    }
    ctx.restore();
    U.circle(ctx, 0, -70 + b, 24, '#f5a054');
    U.circle(ctx, -20, -86 + b, 8, '#e08434'); U.circle(ctx, 20, -86 + b, 8, '#e08434');
    U.circle(ctx, -20, -86 + b, 4, '#2f2a26'); U.circle(ctx, 20, -86 + b, 4, '#2f2a26');
    ctx.save();
    ctx.beginPath(); ctx.arc(0, -70 + b, 24, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#2f2a26';
    [[-18, -84, 0.4], [-20, -74, 0.1], [18, -84, -0.4], [20, -74, -0.1]].forEach(function (q) {
      ctx.save(); ctx.translate(q[0], q[1] + b); ctx.rotate(q[2]);
      ctx.fillRect(-8, -2, 16, 4); ctx.restore();
    });
    ctx.restore();
    U.ellipse(ctx, 0, -62 + b, 15, 11, '#fdf0dc');
    olho(ctx, -9, -73 + b, 3.4); olho(ctx, 9, -73 + b, 3.4);
    U.ellipse(ctx, 0, -66 + b, 4.5, 3.2, '#c4553f');
    sorriso(ctx, 0, -63 + b, 7);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2;
    [-1, 1].forEach(function (s) {
      ctx.beginPath(); ctx.moveTo(s * 6, -63 + b); ctx.lineTo(s * 22, -66 + b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 6, -61 + b); ctx.lineTo(s * 22, -60 + b); ctx.stroke();
    });
  });

  reg('panda-vermelho', function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.5, p = Math.sin(t * 6.5) * 2;
    perna(ctx, -14, -16, 12, 16, '#3a2a26', p);
    perna(ctx, 14, -16, 12, 16, '#3a2a26', -p);
    // cauda anelada
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var ang = -0.35 + i * 0.42;                            // cauda em arco
      var cx = 20 + Math.sin(ang) * 26, cy = -30 - (1 - Math.cos(ang)) * 22 + b;
      ctx.strokeStyle = i % 2 ? '#8a4a28' : '#d98246';
      ctx.lineWidth = 11 - i * 0.9;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 6 - 3);
      ctx.stroke();
    }
    corpo(ctx, 0, -36 + b, 24, 21, '#c9622f', '#e08a52');
    U.circle(ctx, -18, -66 + b, 10, '#f2e6d6'); U.circle(ctx, 18, -66 + b, 10, '#f2e6d6');
    U.circle(ctx, -18, -66 + b, 6, '#d98a5c'); U.circle(ctx, 18, -66 + b, 6, '#d98a5c');
    U.circle(ctx, 0, -58 + b, 20, '#d4703a');
    U.ellipse(ctx, 0, -54 + b, 15, 12, '#f7efe2');           // face branca
    U.ellipse(ctx, -12, -62 + b, 5, 8, '#f7efe2', -0.4);     // sobrancelhas claras
    U.ellipse(ctx, 12, -62 + b, 5, 8, '#f7efe2', 0.4);
    olho(ctx, -7, -60 + b, 3.2); olho(ctx, 7, -60 + b, 3.2);
    U.ellipse(ctx, 0, -52 + b, 4, 3, '#2f2a26');
    sorriso(ctx, 0, -50 + b, 5, '#4a3a30');
  });

  reg('orangotango', function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.6;
    perna(ctx, -13, -14, 13, 14, '#a85b28');
    perna(ctx, 13, -14, 13, 14, '#a85b28');
    corpo(ctx, 0, -40 + b, 26, 25, '#c9702f', '#e2a06a');
    // braços longos
    ctx.strokeStyle = '#b8632a'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-20, -48 + b); ctx.quadraticCurveTo(-36, -40 + b, -34, -18 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20, -48 + b); ctx.quadraticCurveTo(36, -40 + b, 34, -18 + b); ctx.stroke();
    // cabeça com "barba" larga
    U.ellipse(ctx, 0, -70 + b, 25, 20, '#c9702f');
    U.ellipse(ctx, 0, -66 + b, 15, 15, '#e0a878');           // face
    U.ellipse(ctx, 0, -58 + b, 11, 8, '#c98d64');            // focinho
    U.circle(ctx, -3, -59 + b, 1.8, '#5f3a20'); U.circle(ctx, 3, -59 + b, 1.8, '#5f3a20');
    olho(ctx, -6, -70 + b, 3.2); olho(ctx, 6, -70 + b, 3.2);
    sorriso(ctx, 0, -55 + b, 6, '#7a4a28');
    U.ellipse(ctx, 0, -88 + b, 9, 5, '#b8632a');             // tufo de pelo
  });

  reg('pavao', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.5;
    // leque de penas
    for (var i = -5; i <= 5; i++) {
      var ang = i * 0.22;
      var comp = 78 - Math.abs(i) * 3;
      var x = Math.sin(ang) * comp, y = -46 - Math.cos(ang) * comp + b;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      U.ellipse(ctx, 0, 6, 8, 26, i % 2 ? '#2a9d8f' : '#1f7a8c');
      U.circle(ctx, 0, -8, 7, '#2b5f9e');
      U.circle(ctx, 0, -8, 4, '#3f8fd4');
      U.circle(ctx, 0, -8, 2, '#f2c14e');
      ctx.restore();
    }
    ctx.strokeStyle = '#5b5a63'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, -24 + b); ctx.lineTo(-7, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -24 + b); ctx.lineTo(8, -2); ctx.stroke();
    corpo(ctx, 0, -44 + b, 20, 22, '#1f5fa8', '#2f7cc4');
    ctx.strokeStyle = '#1f5fa8'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -60 + b); ctx.lineTo(0, -76 + b); ctx.stroke();
    U.circle(ctx, 0, -82 + b, 11, '#2470bd');
    ctx.fillStyle = '#e3d5b8';
    ctx.beginPath(); ctx.moveTo(-9, -82 + b); ctx.lineTo(-20, -79 + b); ctx.lineTo(-9, -76 + b); ctx.closePath(); ctx.fill();
    olho(ctx, -4, -84 + b, 3);
    // crista
    ctx.strokeStyle = '#2a9d8f'; ctx.lineWidth = 2;
    [-4, 0, 4].forEach(function (dx) {
      ctx.beginPath(); ctx.moveTo(dx, -90 + b); ctx.lineTo(dx * 1.4, -100 + b); ctx.stroke();
      U.circle(ctx, dx * 1.4, -101 + b, 2.6, '#2a9d8f');
    });
  });

  reg('camelo', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.4, p = Math.sin(t * 5.5) * 3;
    perna(ctx, -18, -34, 11, 34, '#c09a68', p);
    perna(ctx, 18, -34, 11, 34, '#c09a68', -p);
    ctx.strokeStyle = '#c09a68'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(26, -50); ctx.quadraticCurveTo(38, -50, 36, -38); ctx.stroke();
    corpo(ctx, 0, -50 + b, 30, 20, '#cfa972', '#e2c69a');
    U.ellipse(ctx, -11, -66 + b, 13, 12, '#cfa972');          // corcovas
    U.ellipse(ctx, 11, -66 + b, 13, 12, '#cfa972');
    // pescoço curvo
    ctx.strokeStyle = '#cfa972'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-20, -56 + b); ctx.quadraticCurveTo(-36, -74 + b, -30, -92 + b); ctx.stroke();
    U.ellipse(ctx, -32, -98 + b, 14, 11, '#d9b47f', -0.2);
    U.ellipse(ctx, -42, -95 + b, 8, 7, '#e2c69a');
    U.ellipse(ctx, -24, -108 + b, 5, 6, '#c09a68', 0.3);
    olho(ctx, -32, -102 + b, 3);
    U.circle(ctx, -46, -95 + b, 1.8, '#6b4f2e');
    sorriso(ctx, -42, -92 + b, 5, '#7d5f3a');
  });

  /* ========================== REGIÃO POLAR ============================ */

  reg('urso-polar', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.5, p = Math.sin(t * 6) * 2.5;
    perna(ctx, -19, -20, 16, 20, '#e6e4dc', p);
    perna(ctx, 19, -20, 16, 20, '#e6e4dc', -p);
    corpo(ctx, 0, -44 + b, 33, 26, '#f4f2ea', '#ffffff');
    U.circle(ctx, -19, -76 + b, 8, '#e6e4dc'); U.circle(ctx, 19, -76 + b, 8, '#e6e4dc');
    U.circle(ctx, -19, -76 + b, 4, '#d6cfc4'); U.circle(ctx, 19, -76 + b, 4, '#d6cfc4');
    U.circle(ctx, 0, -70 + b, 23, '#f8f6ef');
    U.ellipse(ctx, 0, -60 + b, 15, 11, '#e9e5da');            // focinho
    U.ellipse(ctx, 0, -64 + b, 5, 3.6, '#2f2c2a');
    olho(ctx, -9, -74 + b, 3.2); olho(ctx, 9, -74 + b, 3.2);
    sorriso(ctx, 0, -60 + b, 6, '#57534d');
  });

  reg('pinguim', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.6, asa = Math.sin(t * 4) * 0.2;
    ctx.fillStyle = '#f0a63c';
    U.ellipse(ctx, -9, -2, 11, 5, '#f0a63c'); U.ellipse(ctx, 9, -2, 11, 5, '#f0a63c');
    corpo(ctx, 0, -38 + b, 24, 32, '#2b2f3a');
    U.ellipse(ctx, 0, -34 + b, 16, 25, '#f7f4ec');            // barriga
    ctx.save(); ctx.translate(-22, -44 + b); ctx.rotate(-asa);
    U.ellipse(ctx, 0, 0, 7, 17, '#2b2f3a'); ctx.restore();
    ctx.save(); ctx.translate(22, -44 + b); ctx.rotate(asa);
    U.ellipse(ctx, 0, 0, 7, 17, '#2b2f3a'); ctx.restore();
    U.circle(ctx, 0, -72 + b, 17, '#2b2f3a');
    U.ellipse(ctx, 0, -68 + b, 12, 11, '#f7f4ec');
    olho(ctx, -6, -72 + b, 3.2); olho(ctx, 6, -72 + b, 3.2);
    ctx.fillStyle = '#f0a63c';
    ctx.beginPath(); ctx.moveTo(-5, -66 + b); ctx.lineTo(5, -66 + b); ctx.lineTo(0, -58 + b); ctx.closePath(); ctx.fill();
  });

  reg('foca', function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.4;
    U.shadow(ctx, 0, 0, 30, 8, 0.12);
    // corpo alongado
    U.ellipse(ctx, 6, -18 + b, 34, 17, '#aab8c4', -0.08);
    U.ellipse(ctx, 2, -14 + b, 26, 11, '#cdd8e2', -0.08);
    // nadadeira traseira
    ctx.fillStyle = '#9aa9b6';
    ctx.beginPath(); ctx.moveTo(34, -22 + b); ctx.lineTo(52, -30 + b); ctx.lineTo(50, -12 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, -6, -12 + b, 12, 6, '#9aa9b6', 0.4);       // nadadeira lateral
    // cabeça
    U.circle(ctx, -22, -34 + b, 16, '#b8c5d1');
    U.ellipse(ctx, -28, -28 + b, 11, 8, '#dbe4ec');
    U.ellipse(ctx, -34, -29 + b, 4, 3, '#3a3f47');
    olho(ctx, -25, -37 + b, 3.4); olho(ctx, -13, -36 + b, 3.4);
    sorriso(ctx, -30, -25 + b, 5, '#5b636d');
    ctx.strokeStyle = 'rgba(90,100,110,0.7)'; ctx.lineWidth = 1.2;
    [-1, 1].forEach(function (s) {
      ctx.beginPath(); ctx.moveTo(-33, -27 + b + s * 2); ctx.lineTo(-45, -28 + b + s * 5); ctx.stroke();
    });
  });

  reg('morsa', function (ctx, t) {
    var b = Math.sin(t * 2) * 1.3;
    U.shadow(ctx, 0, 0, 34, 9, 0.13);
    U.ellipse(ctx, 10, -22 + b, 36, 20, '#a9756a', -0.05);
    U.ellipse(ctx, 6, -17 + b, 27, 12, '#c08c80', -0.05);
    ctx.fillStyle = '#96655c';
    ctx.beginPath(); ctx.moveTo(40, -28 + b); ctx.lineTo(58, -36 + b); ctx.lineTo(56, -14 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, -22, -40 + b, 19, 17, '#b57e72');
    U.ellipse(ctx, -28, -32 + b, 14, 11, '#d0a094');          // bigodeira
    olho(ctx, -24, -46 + b, 3.2); olho(ctx, -12, -45 + b, 3.2);
    U.ellipse(ctx, -36, -35 + b, 4, 3, '#4a3630');
    // presas
    ctx.fillStyle = '#fdf6e6';
    [-32, -24].forEach(function (x) {
      ctx.beginPath();
      ctx.moveTo(x - 3, -28 + b); ctx.lineTo(x + 3, -28 + b); ctx.lineTo(x + 1, -8 + b);
      ctx.closePath(); ctx.fill();
    });
    ctx.strokeStyle = 'rgba(80,55,48,0.65)'; ctx.lineWidth = 1.2;
    [0, 1, 2].forEach(function (i) {
      ctx.beginPath(); ctx.moveTo(-36, -33 + b + i * 3); ctx.lineTo(-50, -34 + b + i * 4); ctx.stroke();
    });
  });

  reg('raposa', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.4, p = Math.sin(t * 7) * 2.5;
    perna(ctx, -14, -16, 10, 16, '#cfcbc2', p);
    perna(ctx, 14, -16, 10, 16, '#cfcbc2', -p);
    // cauda fofa
    U.ellipse(ctx, 30, -34 + b, 18, 12, '#f2f0ea', 0.5);
    U.ellipse(ctx, 38, -42 + b, 9, 7, '#ffffff', 0.5);
    ctx.strokeStyle = '#d8d4ca'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, -34 + b, 26, 19, 0, 0, Math.PI * 2); ctx.stroke();
    corpo(ctx, 0, -34 + b, 26, 19, '#f8f7f3', '#ffffff');
    // orelhas arredondadas
    U.ellipse(ctx, -13, -66 + b, 8, 10, '#eceae3');
    U.ellipse(ctx, 13, -66 + b, 8, 10, '#eceae3');
    U.ellipse(ctx, -13, -66 + b, 4, 6, '#e6bcb4');
    U.ellipse(ctx, 13, -66 + b, 4, 6, '#e6bcb4');
    U.circle(ctx, 0, -54 + b, 18, '#f8f6f1');
    ctx.fillStyle = '#f8f6f1';
    ctx.beginPath(); ctx.moveTo(-8, -50 + b); ctx.lineTo(-26, -44 + b); ctx.lineTo(-6, -42 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, -26, -45 + b, 3.4, 2.8, '#3a3733');
    olho(ctx, -7, -56 + b, 3.2); olho(ctx, 7, -56 + b, 3.2);
    sorriso(ctx, -6, -45 + b, 4.5, '#8a857d');
  });

  reg('rena', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.4, p = Math.sin(t * 6) * 3;
    perna(ctx, -18, -32, 10, 32, '#8a6c4c', p);
    perna(ctx, 18, -32, 10, 32, '#8a6c4c', -p);
    corpo(ctx, 0, -48 + b, 29, 20, '#9a7856', '#c3a684');
    ctx.strokeStyle = '#9a7856'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-16, -54 + b); ctx.quadraticCurveTo(-26, -70 + b, -22, -82 + b); ctx.stroke();
    U.ellipse(ctx, -24, -88 + b, 14, 11, '#a8845f', -0.15);
    U.ellipse(ctx, -34, -85 + b, 8, 6, '#d2b894');
    // chifres galhados
    ctx.strokeStyle = '#c8a271'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    [[-30, -1], [-16, 1]].forEach(function (base) {
      var x = base[0], s = base[1];
      ctx.beginPath();
      ctx.moveTo(x, -96 + b);
      ctx.quadraticCurveTo(x + s * 6, -110 + b, x + s * 2, -118 + b);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s * 4, -106 + b); ctx.lineTo(x + s * 14, -112 + b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + s * 3, -112 + b); ctx.lineTo(x - s * 6, -118 + b); ctx.stroke();
    });
    U.ellipse(ctx, -12, -98 + b, 5, 7, '#8a6c4c', 0.3);
    olho(ctx, -25, -91 + b, 3.2); olho(ctx, -14, -90 + b, 3);
    U.circle(ctx, -38, -85 + b, 2.6, '#5f4632');
  });

})();
