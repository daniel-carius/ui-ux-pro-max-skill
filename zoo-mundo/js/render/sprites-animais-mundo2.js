/* ==========================================================================
   ZOO MUNDO - Sprites da expansão: América do Norte, Europa e Oceano
   Mesma convenção: pés em (0,0), altura ~ -100.
   ========================================================================== */
(function () {
  'use strict';
  var U = ZM.Utils;
  var aux = ZM.SpritesAnimais.aux;
  var olho = aux.olho, sorriso = aux.sorriso, perna = aux.perna, corpo = aux.corpo;
  var reg = ZM.SpritesAnimais.registrar;

  /* ========================= AMÉRICA DO NORTE ========================= */

  reg('bisao', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.4, p = Math.sin(t * 6) * 3;
    perna(ctx, -22, -26, 14, 26, '#5a3f2b', p);
    perna(ctx, 22, -26, 14, 26, '#5a3f2b', -p);
    corpo(ctx, 4, -48 + b, 38, 26, '#6e4a30', '#8a6544');
    U.ellipse(ctx, 6, -66 + b, 26, 16, '#5a3f2b');            // corcova peluda
    for (var i = 0; i < 7; i++) U.circle(ctx, -14 + i * 7, -74 + b + Math.sin(i) * 3, 7, '#4f3625');
    U.ellipse(ctx, -24, -54 + b, 22, 19, '#5a3f2b');            // cabeça
    U.ellipse(ctx, -30, -44 + b, 13, 9, '#7d5a3e');             // focinho
    U.ellipse(ctx, -38, -44 + b, 3.6, 2.8, '#2f2018');
    ctx.strokeStyle = '#e9dcc3'; ctx.lineWidth = 4; ctx.lineCap = 'round';   // chifres
    ctx.beginPath(); ctx.moveTo(-36, -66 + b); ctx.quadraticCurveTo(-46, -72 + b, -40, -80 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-12, -68 + b); ctx.quadraticCurveTo(-4, -74 + b, -10, -82 + b); ctx.stroke();
    olho(ctx, -29, -56 + b, 3); olho(ctx, -17, -55 + b, 3);
    U.ellipse(ctx, -26, -34 + b, 8, 6, '#4f3625');              // barba
  });

  reg('guaxinim', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.4, p = Math.sin(t * 7) * 2.5;
    perna(ctx, -13, -14, 11, 14, '#4a4a52', p);
    perna(ctx, 13, -14, 11, 14, '#4a4a52', -p);
    ctx.lineCap = 'round';                                       // cauda anelada
    for (var i = 0; i < 6; i++) {
      var ang = -0.3 + i * 0.36;
      ctx.strokeStyle = i % 2 ? '#3a3a42' : '#9a9aa3'; ctx.lineWidth = 11 - i;
      ctx.beginPath();
      ctx.moveTo(20 + Math.sin(ang) * 24, -24 - (1 - Math.cos(ang)) * 24 + b);
      ctx.lineTo(24 + Math.sin(ang) * 26, -24 - (1 - Math.cos(ang)) * 26 + b); ctx.stroke();
    }
    corpo(ctx, 0, -34 + b, 25, 20, '#8d8d97', '#c4c4cc');
    U.circle(ctx, -15, -62 + b, 8, '#7e7e88'); U.circle(ctx, 15, -62 + b, 8, '#7e7e88');
    U.circle(ctx, 0, -54 + b, 19, '#9c9ca6');
    U.ellipse(ctx, 0, -50 + b, 15, 11, '#e6e6ea');
    U.ellipse(ctx, -8, -55 + b, 8, 5.5, '#2f2f38', -0.2);       // máscara
    U.ellipse(ctx, 8, -55 + b, 8, 5.5, '#2f2f38', 0.2);
    olho(ctx, -8, -55 + b, 3, 1); olho(ctx, 8, -55 + b, 3, 1);
    U.ellipse(ctx, 0, -45 + b, 3.6, 2.8, '#2f2f38');
    sorriso(ctx, 0, -43 + b, 5, '#55555f');
  });

  reg('alce', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.4, p = Math.sin(t * 5.5) * 3;
    perna(ctx, -18, -36, 10, 36, '#6b4c33', p);
    perna(ctx, 18, -36, 10, 36, '#6b4c33', -p);
    corpo(ctx, 0, -52 + b, 30, 20, '#7d5a3d', '#9a7856');
    ctx.strokeStyle = '#7d5a3d'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-16, -58 + b); ctx.quadraticCurveTo(-28, -72 + b, -24, -86 + b); ctx.stroke();
    U.ellipse(ctx, -28, -92 + b, 16, 12, '#8a6544', -0.1);
    U.ellipse(ctx, -40, -88 + b, 10, 8, '#a58363');            // focinho grande
    U.ellipse(ctx, -46, -88 + b, 3.4, 2.6, '#3a2818');
    U.ellipse(ctx, -22, -74 + b, 6, 9, '#6b4c33');             // papada
    // galhadas em pá
    ctx.fillStyle = '#d9c39a';
    [-1, 1].forEach(function (sd) {
      ctx.beginPath();
      ctx.moveTo(-28 + sd * 6, -102 + b);
      ctx.quadraticCurveTo(-28 + sd * 26, -114 + b, -28 + sd * 30, -128 + b);
      ctx.lineTo(-28 + sd * 22, -126 + b); ctx.lineTo(-28 + sd * 18, -132 + b);
      ctx.lineTo(-28 + sd * 12, -124 + b); ctx.lineTo(-28 + sd * 8, -130 + b);
      ctx.lineTo(-28 + sd * 4, -110 + b);
      ctx.closePath(); ctx.fill();
    });
    olho(ctx, -30, -95 + b, 3); olho(ctx, -20, -94 + b, 3);
  });

  reg('urso-pardo', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 1.5, p = Math.sin(t * 6) * 2.5;
    perna(ctx, -19, -20, 16, 20, '#6b4a2e', p);
    perna(ctx, 19, -20, 16, 20, '#6b4a2e', -p);
    corpo(ctx, 0, -44 + b, 33, 26, '#7e5a3b', '#9c7856');
    U.circle(ctx, -19, -76 + b, 8, '#6b4a2e'); U.circle(ctx, 19, -76 + b, 8, '#6b4a2e');
    U.circle(ctx, -19, -76 + b, 4, '#a58363'); U.circle(ctx, 19, -76 + b, 4, '#a58363');
    U.circle(ctx, 0, -70 + b, 23, '#86613f');
    U.ellipse(ctx, 0, -60 + b, 14, 11, '#b08f6c');
    U.ellipse(ctx, 0, -64 + b, 5, 3.8, '#2f2018');
    olho(ctx, -9, -74 + b, 3.2); olho(ctx, 9, -74 + b, 3.2);
    sorriso(ctx, 0, -60 + b, 6, '#4f3625');
  });

  reg('aguia', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.6, asa = Math.sin(t * 3) * 0.1;
    ctx.strokeStyle = '#f2b544'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, -24 + b); ctx.lineTo(-8, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -24 + b); ctx.lineTo(8, -2); ctx.stroke();
    ctx.lineWidth = 3;
    [-8, 8].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, -2); ctx.lineTo(x - 6, 1); ctx.moveTo(x, -2); ctx.lineTo(x + 6, 1); ctx.stroke(); });
    ctx.fillStyle = '#f4efe4';                                  // cauda branca
    ctx.beginPath(); ctx.moveTo(6, -30 + b); ctx.lineTo(28, -10); ctx.lineTo(30, -24); ctx.closePath(); ctx.fill();
    corpo(ctx, 0, -52 + b, 22, 28, '#5a3f2b', '#6e4a30');
    ctx.save(); ctx.translate(-16, -58 + b); ctx.rotate(asa);
    U.ellipse(ctx, 0, 4, 12, 24, '#4a3222', 0.2); ctx.restore();
    ctx.save(); ctx.translate(16, -58 + b); ctx.rotate(-asa);
    U.ellipse(ctx, 0, 4, 12, 24, '#4a3222', -0.2); ctx.restore();
    U.circle(ctx, -2, -86 + b, 15, '#f7f3ea');                  // cabeça branca
    ctx.fillStyle = '#f2b544';                                  // bico curvo
    ctx.beginPath(); ctx.moveTo(-14, -88 + b); ctx.quadraticCurveTo(-30, -88 + b, -26, -76 + b);
    ctx.quadraticCurveTo(-20, -78 + b, -12, -80 + b); ctx.closePath(); ctx.fill();
    olho(ctx, -8, -89 + b, 3.2);
    ctx.strokeStyle = '#3a2818'; ctx.lineWidth = 2;              // sobrancelha séria
    ctx.beginPath(); ctx.moveTo(-14, -95 + b); ctx.lineTo(-2, -93 + b); ctx.stroke();
  });

  reg('castor', function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.3, p = Math.sin(t * 6.5) * 2;
    U.ellipse(ctx, 30, -14 + b, 20, 11, '#5a3f2b', 0.15);       // cauda achatada
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(18 + i * 6, -8 + b); ctx.lineTo(24 + i * 6, -20 + b); ctx.stroke(); }
    perna(ctx, -14, -12, 12, 12, '#6b4a2e', p);
    perna(ctx, 14, -12, 12, 12, '#6b4a2e', -p);
    corpo(ctx, 0, -32 + b, 28, 22, '#8a5f3c', '#b08a62');
    U.circle(ctx, -14, -58 + b, 6, '#7a5133'); U.circle(ctx, 14, -58 + b, 6, '#7a5133');
    U.circle(ctx, 0, -52 + b, 18, '#96683f');
    U.ellipse(ctx, 0, -46 + b, 12, 9, '#c29a6e');
    U.ellipse(ctx, 0, -50 + b, 4, 3, '#3a2818');
    olho(ctx, -7, -55 + b, 3); olho(ctx, 7, -55 + b, 3);
    ctx.fillStyle = '#ffd97a';                                  // dentões
    ctx.fillRect(-4, -44 + b, 3.5, 6); ctx.fillRect(0.5, -44 + b, 3.5, 6);
  });

  /* =============================== EUROPA ============================== */

  reg('lobo', function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.5, p = Math.sin(t * 7) * 3;
    perna(ctx, -18, -24, 11, 24, '#6f7480', p);
    perna(ctx, 18, -24, 11, 24, '#6f7480', -p);
    U.ellipse(ctx, 30, -40 + b, 16, 9, '#7e8492', 0.6);         // cauda
    corpo(ctx, 0, -44 + b, 30, 21, '#8a909c', '#c9cdd6');
    U.ellipse(ctx, -10, -66 + b, 20, 17, '#959ba7');
    U.ellipse(ctx, -24, -60 + b, 13, 8, '#c9cdd6');             // focinho comprido
    U.ellipse(ctx, -34, -61 + b, 3.6, 2.8, '#2b2b32');
    ctx.fillStyle = '#7e8492';                                  // orelhas pontudas
    ctx.beginPath(); ctx.moveTo(-20, -78 + b); ctx.lineTo(-16, -94 + b); ctx.lineTo(-8, -80 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-2, -80 + b); ctx.lineTo(6, -92 + b); ctx.lineTo(8, -76 + b); ctx.closePath(); ctx.fill();
    olho(ctx, -16, -69 + b, 3, 1); olho(ctx, -4, -68 + b, 3, 1);
    ctx.fillStyle = '#f6f3f0';
    ctx.beginPath(); ctx.moveTo(-26, -56 + b); ctx.lineTo(-23, -51 + b); ctx.lineTo(-20, -56 + b); ctx.closePath(); ctx.fill();
  });

  reg('raposa-vermelha', function (ctx, t) {
    var b = Math.sin(t * 3) * 1.4, p = Math.sin(t * 7) * 2.5;
    perna(ctx, -14, -18, 10, 18, '#3a2a22', p);
    perna(ctx, 14, -18, 10, 18, '#3a2a22', -p);
    U.ellipse(ctx, 30, -36 + b, 19, 11, '#e06a2c', 0.5);        // cauda
    U.circle(ctx, 42, -46 + b, 7, '#fff4e6');
    corpo(ctx, 0, -36 + b, 26, 19, '#e8742f', '#fff1dd');
    ctx.fillStyle = '#e06a2c';                                  // orelhas
    ctx.beginPath(); ctx.moveTo(-18, -62 + b); ctx.lineTo(-14, -80 + b); ctx.lineTo(-4, -66 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, -66 + b); ctx.lineTo(14, -80 + b); ctx.lineTo(18, -62 + b); ctx.closePath(); ctx.fill();
    U.circle(ctx, 0, -56 + b, 18, '#ee8038');
    ctx.fillStyle = '#fff4e6';                                  // focinho branco
    ctx.beginPath(); ctx.moveTo(-10, -52 + b); ctx.lineTo(0, -38 + b); ctx.lineTo(10, -52 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, 0, -41 + b, 3.4, 2.8, '#2b2016');
    olho(ctx, -7, -58 + b, 3); olho(ctx, 7, -58 + b, 3);
  });

  reg('cervo', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 1.4, p = Math.sin(t * 6) * 3;
    perna(ctx, -16, -34, 8, 34, '#a8794f', p);
    perna(ctx, 16, -34, 8, 34, '#a8794f', -p);
    corpo(ctx, 0, -48 + b, 26, 18, '#c48c5c', '#f2dcc1');
    [[-14, -52], [0, -46], [12, -54], [8, -42], [-6, -56]].forEach(function (q) {
      U.circle(ctx, q[0], q[1] + b, 2.6, '#fff4e6');
    });
    ctx.strokeStyle = '#c48c5c'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-14, -54 + b); ctx.quadraticCurveTo(-24, -68 + b, -22, -82 + b); ctx.stroke();
    U.ellipse(ctx, -24, -88 + b, 12, 10, '#d09a68', -0.1);
    U.ellipse(ctx, -33, -86 + b, 7, 5.5, '#f2dcc1');
    U.ellipse(ctx, -38, -86 + b, 2.8, 2.2, '#3a2818');
    U.ellipse(ctx, -14, -96 + b, 4, 6, '#c48c5c', 0.4);          // orelha
    ctx.strokeStyle = '#d9c39a'; ctx.lineWidth = 3;               // galhada fina
    [[-30, -1], [-18, 1]].forEach(function (g) {
      ctx.beginPath(); ctx.moveTo(g[0], -96 + b); ctx.quadraticCurveTo(g[0] + g[1] * 6, -110 + b, g[0] + g[1] * 3, -120 + b); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g[0] + g[1] * 4, -106 + b); ctx.lineTo(g[0] + g[1] * 12, -112 + b); ctx.stroke();
    });
    olho(ctx, -26, -91 + b, 3); olho(ctx, -16, -90 + b, 2.8);
  });

  reg('ourico', function (ctx, t) {
    var b = Math.sin(t * 3.2) * 1.2;
    perna(ctx, -10, -8, 8, 8, '#7a5a3e');
    perna(ctx, 10, -8, 8, 8, '#7a5a3e');
    U.ellipse(ctx, 4, -24 + b, 26, 20, '#6b4f36');              // corpo com espinhos
    ctx.strokeStyle = '#4a3624'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (var i = 0; i < 14; i++) {
      var ang = Math.PI + (i / 13) * Math.PI;
      var x = 4 + Math.cos(ang) * 24, y = -24 + b + Math.sin(ang) * 18;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * 9, y + Math.sin(ang) * 9); ctx.stroke();
      U.circle(ctx, x + Math.cos(ang) * 9, y + Math.sin(ang) * 9, 1.6, '#f2e6cf');
    }
    U.ellipse(ctx, -20, -20 + b, 14, 11, '#d8b48c');            // carinha
    U.ellipse(ctx, -32, -18 + b, 3.4, 2.8, '#2b2016');
    U.circle(ctx, -16, -32 + b, 4, '#c9a27a'); U.circle(ctx, -6, -34 + b, 4, '#c9a27a');
    olho(ctx, -24, -24 + b, 2.6); olho(ctx, -14, -25 + b, 2.6);
    sorriso(ctx, -26, -16 + b, 4, '#7a5a3e');
  });

  reg('coruja', function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.3;
    ctx.strokeStyle = '#e2a13d'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -14 + b); ctx.lineTo(-9, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -14 + b); ctx.lineTo(9, -2); ctx.stroke();
    corpo(ctx, 0, -42 + b, 24, 30, '#8a6642', '#c9a77c');
    for (var i = 0; i < 6; i++) {                                 // peito com "escamas"
      U.ellipse(ctx, -8 + (i % 3) * 8, -46 + b + Math.floor(i / 3) * 10, 4, 3, 'rgba(120,85,50,0.45)');
    }
    U.ellipse(ctx, -20, -44 + b, 8, 22, '#6f4f30', 0.15);       // asas
    U.ellipse(ctx, 20, -44 + b, 8, 22, '#6f4f30', -0.15);
    U.circle(ctx, 0, -76 + b, 22, '#9a7550');
    ctx.fillStyle = '#9a7550';                                  // tufos
    ctx.beginPath(); ctx.moveTo(-18, -90 + b); ctx.lineTo(-22, -104 + b); ctx.lineTo(-8, -94 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(18, -90 + b); ctx.lineTo(22, -104 + b); ctx.lineTo(8, -94 + b); ctx.closePath(); ctx.fill();
    U.circle(ctx, -9, -76 + b, 10, '#f2e6cf'); U.circle(ctx, 9, -76 + b, 10, '#f2e6cf');
    U.circle(ctx, -9, -76 + b, 5, '#e8b23c'); U.circle(ctx, 9, -76 + b, 5, '#e8b23c');
    olho(ctx, -9, -76 + b, 3.2, 1); olho(ctx, 9, -76 + b, 3.2, 1);
    ctx.fillStyle = '#e2a13d';
    ctx.beginPath(); ctx.moveTo(-4, -68 + b); ctx.lineTo(4, -68 + b); ctx.lineTo(0, -60 + b); ctx.closePath(); ctx.fill();
  });

  reg('javali', function (ctx, t) {
    var b = Math.sin(t * 2.8) * 1.3, p = Math.sin(t * 7) * 2.5;
    perna(ctx, -18, -16, 11, 16, '#3f3129', p);
    perna(ctx, 18, -16, 11, 16, '#3f3129', -p);
    corpo(ctx, 0, -36 + b, 33, 22, '#5a4638', '#7a6252');
    for (var i = -3; i <= 3; i++) {                               // crina eriçada
      ctx.strokeStyle = '#3f3129'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(i * 8, -56 + b); ctx.lineTo(i * 8 - 2, -66 + b); ctx.stroke();
    }
    U.ellipse(ctx, -24, -48 + b, 20, 16, '#5f4a3b');
    U.ellipse(ctx, -38, -42 + b, 10, 8, '#8f7466');             // focinho
    U.circle(ctx, -42, -43 + b, 2, '#3a2818'); U.circle(ctx, -37, -43 + b, 2, '#3a2818');
    ctx.strokeStyle = '#f2e6cf'; ctx.lineWidth = 3;               // presas
    ctx.beginPath(); ctx.moveTo(-30, -38 + b); ctx.lineTo(-33, -30 + b); ctx.stroke();
    U.ellipse(ctx, -26, -64 + b, 5, 8, '#4a3a30', -0.3); U.ellipse(ctx, -12, -64 + b, 5, 8, '#4a3a30', 0.3);
    olho(ctx, -28, -50 + b, 2.8); olho(ctx, -16, -50 + b, 2.8);
  });

  /* =============================== OCEANO ============================== */

  reg('tubarao', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 2;
    U.shadow(ctx, 0, 0, 36, 8, 0.1);
    ctx.fillStyle = '#7f95a8';                                  // cauda
    ctx.beginPath(); ctx.moveTo(34, -30 + b); ctx.lineTo(52, -48 + b); ctx.lineTo(50, -16 + b); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, 0, -30 + b, 40, 18, '#8fa6b8', -0.05);
    U.ellipse(ctx, -4, -24 + b, 32, 10, '#dde7ee', -0.05);      // barriga
    ctx.fillStyle = '#7f95a8';                                  // barbatana dorsal
    ctx.beginPath(); ctx.moveTo(-6, -46 + b); ctx.lineTo(8, -70 + b); ctx.lineTo(16, -46 + b); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4, -18 + b); ctx.lineTo(4, -4 + b); ctx.lineTo(14, -18 + b); ctx.closePath(); ctx.fill();
    olho(ctx, -26, -34 + b, 3.4, 1);
    ctx.fillStyle = '#f6f3f0';                                  // sorriso com dentes
    for (var i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(-34 + i * 6, -26 + b); ctx.lineTo(-31 + i * 6, -21 + b); ctx.lineTo(-28 + i * 6, -26 + b); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,80,95,0.5)'; ctx.lineWidth = 1.5;
    [-18, -12, -6].forEach(function (x) { ctx.beginPath(); ctx.moveTo(x, -40 + b); ctx.lineTo(x, -32 + b); ctx.stroke(); });
  });

  reg('tartaruga', function (ctx, t) {
    var b = Math.sin(t * 2) * 1.2;
    U.shadow(ctx, 0, 0, 30, 8, 0.1);
    U.ellipse(ctx, -14, -10 + b, 12, 6, '#5fae6e', 0.5);        // nadadeiras
    U.ellipse(ctx, 22, -10 + b, 12, 6, '#5fae6e', -0.5);
    U.ellipse(ctx, 4, -24 + b, 30, 20, '#3f8f4f');               // casco
    U.ellipse(ctx, 4, -26 + b, 24, 15, '#5aae66');
    ctx.strokeStyle = '#2f6b3a'; ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var ang = i * Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(4, -26 + b); ctx.lineTo(4 + Math.cos(ang) * 22, -26 + b + Math.sin(ang) * 13); ctx.stroke();
    }
    U.ellipse(ctx, 4, -26 + b, 8, 5, '#7dc98a');
    U.ellipse(ctx, -30, -30 + b, 12, 10, '#6fbf7c');             // cabeça
    U.ellipse(ctx, -26, -16 + b, 12, 6, '#6fbf7c', 0.3);         // nadadeira da frente
    olho(ctx, -33, -33 + b, 3); olho(ctx, -25, -32 + b, 2.6);
    sorriso(ctx, -34, -26 + b, 4, '#2f6b3a');
  });

  reg('golfinho', function (ctx, t) {
    var b = Math.sin(t * 2.6) * 3;
    U.shadow(ctx, 0, 0, 34, 8, 0.1);
    ctx.save(); ctx.translate(0, b); ctx.rotate(-0.25);
    ctx.fillStyle = '#5f93c0';
    ctx.beginPath(); ctx.moveTo(30, -34); ctx.lineTo(50, -46); ctx.lineTo(48, -22); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, 0, -34, 38, 16, '#6ea3d1');
    U.ellipse(ctx, -2, -28, 30, 8, '#e4eef7');
    ctx.fillStyle = '#5f93c0';
    ctx.beginPath(); ctx.moveTo(-2, -48); ctx.lineTo(6, -66); ctx.lineTo(14, -48); ctx.closePath(); ctx.fill();
    U.ellipse(ctx, -6, -22, 10, 5, '#5f93c0', 0.5);
    U.ellipse(ctx, -40, -34, 10, 6, '#6ea3d1');                 // bico
    olho(ctx, -26, -38, 3.2);
    sorriso(ctx, -36, -32, 6, '#3f6f96');
    ctx.restore();
  });

  reg('polvo', function (ctx, t) {
    var b = Math.sin(t * 2.2) * 1.5;
    ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {                                 // tentáculos
      var x = -25 + i * 10, sway = Math.sin(t * 3 + i) * 4;
      ctx.strokeStyle = i % 2 ? '#8b5cf6' : '#7c4fe0'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(x, -34 + b);
      ctx.quadraticCurveTo(x + sway, -14 + b, x + sway * 2 + (i - 2.5) * 4, -2); ctx.stroke();
      U.circle(ctx, x + sway * 2 + (i - 2.5) * 4, -3, 4, '#b794f6');
    }
    U.circle(ctx, 0, -50 + b, 26, '#9b6ff7');
    U.ellipse(ctx, 0, -40 + b, 20, 10, '#b794f6');
    olho(ctx, -10, -52 + b, 4.5); olho(ctx, 10, -52 + b, 4.5);
    sorriso(ctx, 0, -42 + b, 5, '#5b3ab8');
    U.circle(ctx, -18, -36 + b, 3, 'rgba(255,255,255,0.35)'); U.circle(ctx, 18, -36 + b, 3, 'rgba(255,255,255,0.35)');
  });

  reg('cavalo-marinho', function (ctx, t) {
    var b = Math.sin(t * 2.4) * 2;
    U.shadow(ctx, 0, 0, 16, 5, 0.1);
    ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 9; ctx.lineCap = 'round';   // cauda enrolada
    ctx.beginPath(); ctx.moveTo(0, -30 + b);
    ctx.quadraticCurveTo(6, -6 + b, 16, -8 + b); ctx.quadraticCurveTo(24, -10 + b, 16, -18 + b); ctx.stroke();
    U.ellipse(ctx, 0, -46 + b, 13, 22, '#f7b733');
    ctx.strokeStyle = 'rgba(180,110,20,0.45)'; ctx.lineWidth = 1.5;
    for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-11, -60 + b + i * 8); ctx.lineTo(11, -60 + b + i * 8); ctx.stroke(); }
    U.ellipse(ctx, 10, -50 + b, 6, 10, '#ffd166', 0.2);          // barbatana
    ctx.strokeStyle = '#f7b733'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(0, -66 + b); ctx.quadraticCurveTo(-4, -80 + b, -14, -82 + b); ctx.stroke();
    U.ellipse(ctx, -20, -82 + b, 9, 4, '#f5a623');               // focinho
    U.circle(ctx, -10, -84 + b, 7, '#f7b733');
    [-8, -2, 4].forEach(function (x) { U.circle(ctx, x, -92 + b, 3, '#ffd166'); });
    olho(ctx, -11, -85 + b, 2.8);
  });

  reg('caranguejo', function (ctx, t) {
    var b = Math.sin(t * 3.4) * 1.2;
    U.shadow(ctx, 0, 0, 30, 7, 0.1);
    ctx.strokeStyle = '#d9412e'; ctx.lineWidth = 4; ctx.lineCap = 'round';   // pernas
    [-1, 1].forEach(function (sd) {
      for (var i = 0; i < 3; i++) {
        var y = -26 + i * 7 + b;
        ctx.beginPath(); ctx.moveTo(sd * 20, y); ctx.lineTo(sd * (34 + i * 2), y - 6); ctx.lineTo(sd * (40 + i * 2), y + 6); ctx.stroke();
      }
    });
    U.ellipse(ctx, 0, -24 + b, 26, 17, '#e8503b');
    U.ellipse(ctx, 0, -28 + b, 18, 9, '#f0705c');
    [-1, 1].forEach(function (sd) {                               // pinças
      ctx.strokeStyle = '#d9412e'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(sd * 22, -34 + b); ctx.lineTo(sd * 34, -48 + b); ctx.stroke();
      U.circle(ctx, sd * 38, -52 + b, 9, '#e8503b');
      ctx.fillStyle = '#fbe3d0';
      ctx.beginPath(); ctx.moveTo(sd * 40, -58 + b); ctx.lineTo(sd * 47, -60 + b); ctx.lineTo(sd * 44, -52 + b); ctx.closePath(); ctx.fill();
    });
    ctx.strokeStyle = '#b8321f'; ctx.lineWidth = 2.5;             // olhinhos em hastes
    ctx.beginPath(); ctx.moveTo(-8, -38 + b); ctx.lineTo(-10, -50 + b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, -38 + b); ctx.lineTo(10, -50 + b); ctx.stroke();
    olho(ctx, -10, -52 + b, 3.4); olho(ctx, 10, -52 + b, 3.4);
    sorriso(ctx, 0, -22 + b, 5, '#9c2a1b');
  });

})();
