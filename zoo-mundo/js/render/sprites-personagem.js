/* ==========================================================================
   ZOO MUNDO - Sprite do personagem infantil (4 direcoes + caminhada)
   Pes em (0,0), altura aproximada de 74px na escala 1.
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.SpritesPersonagem = (function () {
  'use strict';
  var U = ZM.Utils;

  /* Cabelo: so a parte de cima (fica sob o chapeu) + mechas visiveis nas laterais */
  function cabelo(ctx, p, dir, y) {
    var c = p.cabelo;
    ctx.save();
    ctx.beginPath(); ctx.rect(-22, y - 26, 44, 22); ctx.clip();   // topo da cabeca
    U.circle(ctx, 0, y - 1, 16, c);
    ctx.restore();

    if (dir === 'cima') { U.circle(ctx, 0, y + 2, 15, c); return; }

    switch (p.cabeloTipo) {
      case 'maria-chiquinha':
        U.circle(ctx, -16, y + 6, 6.5, c);
        U.circle(ctx, 16, y + 6, 6.5, c);
        U.ellipse(ctx, -14, y - 1, 4, 6, c);
        U.ellipse(ctx, 14, y - 1, 4, 6, c);
        break;
      case 'afro':
        U.circle(ctx, -14, y + 1, 8, c);
        U.circle(ctx, 14, y + 1, 8, c);
        break;
      case 'topete':
        U.ellipse(ctx, -13, y + 1, 4, 7, c);
        U.ellipse(ctx, 13, y + 1, 4, 7, c);
        U.ellipse(ctx, 6, y - 12, 8, 5, c, -0.4);
        break;
      default:
        U.ellipse(ctx, -13, y + 2, 4, 8, c);
        U.ellipse(ctx, 13, y + 2, 4, 8, c);
    }
  }

  function rosto(ctx, dir, y) {
    if (dir === 'cima') return;
    var dx = dir === 'esq' ? -4 : (dir === 'dir' ? 4 : 0);
    U.circle(ctx, dx - 5, y, 2.4, '#2c2119');
    if (dir === 'baixo') U.circle(ctx, dx + 5, y, 2.4, '#2c2119');
    ctx.strokeStyle = '#b5654a'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(dx, y + 4, 3.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    U.circle(ctx, dx - 10, y + 3, 3, 'rgba(240,120,110,0.30)');
    if (dir === 'baixo') U.circle(ctx, dx + 10, y + 3, 3, 'rgba(240,120,110,0.30)');
  }

  /**
   * @param {string} dir  'baixo' | 'cima' | 'esq' | 'dir'
   * @param {number} fase fase da caminhada (0 quando parado)
   */
  function desenhar(ctx, personagem, x, y, escala, dir, fase, andando, tempo) {
    var p = personagem;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(escala, escala);
    U.shadow(ctx, 0, 0, 15, 5, 0.2);

    var passo = andando ? Math.sin(fase) * 5 : 0;
    var b = andando ? Math.abs(Math.sin(fase)) * 2 : Math.sin((tempo || 0) * 2.4) * 1.2;

    // pernas
    ctx.fillStyle = '#3d4f63';
    U.roundRect(ctx, -9, -26 - b, 8, 20 + passo, 4); ctx.fill();
    U.roundRect(ctx, 1, -26 - b, 8, 20 - passo, 4); ctx.fill();
    ctx.fillStyle = '#2b3644';
    U.roundRect(ctx, -10, -8 - b + passo, 10, 6, 3); ctx.fill();
    U.roundRect(ctx, 0, -8 - b - passo, 10, 6, 3); ctx.fill();

    // mochila (visivel de costas)
    if (dir === 'cima') {
      U.roundRect(ctx, -12, -50 - b, 24, 22, 8); ctx.fillStyle = p.roupaAlt; ctx.fill();
      U.roundRect(ctx, -6, -44 - b, 12, 9, 4); ctx.fillStyle = U.shade(p.roupaAlt, -0.25); ctx.fill();
    }

    // corpo
    U.roundRect(ctx, -12, -48 - b, 24, 24, 9);
    ctx.fillStyle = p.roupa; ctx.fill();
    if (dir !== 'cima') {
      U.roundRect(ctx, -5, -48 - b, 10, 11, 4); ctx.fillStyle = p.roupaAlt; ctx.fill();
    }

    // bracos
    ctx.strokeStyle = p.pele; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-11, -44 - b); ctx.lineTo(-15, -32 - b - passo * 0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, -44 - b); ctx.lineTo(15, -32 - b + passo * 0.8); ctx.stroke();

    // cabeca
    var hy = -62 - b;
    U.circle(ctx, 0, hy, 14, p.pele);
    if (dir === 'esq') { ctx.save(); ctx.translate(-2, 0); }
    if (dir === 'dir') { ctx.save(); ctx.translate(2, 0); }
    cabelo(ctx, p, dir, hy - 3);
    rosto(ctx, dir, hy + 3);
    if (dir === 'esq' || dir === 'dir') ctx.restore();

    // chapeu de explorador
    ctx.fillStyle = p.chapeu;
    U.ellipse(ctx, 0, hy - 12, 22, 6.5, p.chapeu);
    U.roundRect(ctx, -11, hy - 24, 22, 14, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(-11, hy - 15, 22, 4);

    ctx.restore();
  }

  return { desenhar: desenhar };
})();
