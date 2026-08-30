/* ==========================================================================
   ZOO MUNDO - Elementos de cenario (arvores, pedras, placas, fonte...)
   Objetos "altos" sao desenhados por frame com ordenacao por profundidade.
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Cenario = (function () {
  'use strict';
  var U = ZM.Utils;

  function tronco(ctx, x, y, largura, altura, cor) {
    U.roundRect(ctx, x - largura / 2, y - altura, largura, altura, largura * 0.35);
    ctx.fillStyle = cor; ctx.fill();
  }

  var D = {};

  /* Arvore redonda (praca) */
  D.arvore = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 24 * o.s, 8 * o.s, 0.16);
    tronco(ctx, o.x, o.y, 12 * o.s, 34 * o.s, pal.tronco);
    var y = o.y - 40 * o.s;
    U.circle(ctx, o.x - 16 * o.s, y + 6 * o.s, 20 * o.s, pal.folha);
    U.circle(ctx, o.x + 16 * o.s, y + 6 * o.s, 20 * o.s, pal.folha);
    U.circle(ctx, o.x, y - 10 * o.s, 26 * o.s, pal.folhaAlt);
    U.circle(ctx, o.x - 8 * o.s, y - 16 * o.s, 14 * o.s, U.rgba('#ffffff', 0.18));
  };

  /* Acacia (savana africana) */
  D.acacia = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 34 * o.s, 9 * o.s, 0.16);
    ctx.strokeStyle = pal.tronco; ctx.lineWidth = 9 * o.s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 34 * o.s); ctx.stroke();
    ctx.lineWidth = 5 * o.s;
    ctx.beginPath(); ctx.moveTo(o.x, o.y - 28 * o.s); ctx.lineTo(o.x - 20 * o.s, o.y - 44 * o.s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(o.x, o.y - 28 * o.s); ctx.lineTo(o.x + 20 * o.s, o.y - 44 * o.s); ctx.stroke();
    var cy = o.y - 52 * o.s;
    U.ellipse(ctx, o.x, cy, 46 * o.s, 16 * o.s, pal.folha);
    U.ellipse(ctx, o.x - 18 * o.s, cy - 9 * o.s, 26 * o.s, 12 * o.s, pal.folhaAlt);
    U.ellipse(ctx, o.x + 20 * o.s, cy - 7 * o.s, 24 * o.s, 11 * o.s, pal.folhaAlt);
  };

  /* Eucalipto (outback australiano) */
  D.eucalipto = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 20 * o.s, 7 * o.s, 0.15);
    ctx.strokeStyle = pal.tronco; ctx.lineWidth = 8 * o.s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.quadraticCurveTo(o.x - 6 * o.s, o.y - 40 * o.s, o.x - 2 * o.s, o.y - 66 * o.s); ctx.stroke();
    ctx.lineWidth = 4 * o.s;
    ctx.beginPath(); ctx.moveTo(o.x - 3 * o.s, o.y - 52 * o.s); ctx.lineTo(o.x + 18 * o.s, o.y - 64 * o.s); ctx.stroke();
    var cy = o.y - 74 * o.s;
    U.ellipse(ctx, o.x - 12 * o.s, cy, 22 * o.s, 15 * o.s, pal.folha, -0.2);
    U.ellipse(ctx, o.x + 14 * o.s, cy + 4 * o.s, 20 * o.s, 13 * o.s, pal.folha, 0.25);
    U.ellipse(ctx, o.x, cy - 12 * o.s, 24 * o.s, 14 * o.s, pal.folhaAlt);
  };

  /* Arvore densa da floresta tropical */
  D.selva = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 30 * o.s, 9 * o.s, 0.18);
    tronco(ctx, o.x, o.y, 14 * o.s, 44 * o.s, pal.tronco);
    var y = o.y - 54 * o.s;
    U.circle(ctx, o.x - 22 * o.s, y, 24 * o.s, pal.folha);
    U.circle(ctx, o.x + 22 * o.s, y, 22 * o.s, pal.folha);
    U.circle(ctx, o.x, y - 18 * o.s, 30 * o.s, pal.folhaAlt);
    U.circle(ctx, o.x + 6 * o.s, y - 4 * o.s, 20 * o.s, pal.folha);
  };

  /* Bambuzal */
  D.bambu = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 20 * o.s, 7 * o.s, 0.14);
    for (var i = -1; i <= 1; i++) {
      var bx = o.x + i * 12 * o.s, h = (74 + Math.abs(i) * -14) * o.s;
      ctx.fillStyle = i === 0 ? '#a8bd5e' : '#93ab52';
      U.roundRect(ctx, bx - 4 * o.s, o.y - h, 8 * o.s, h, 4 * o.s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1.5;
      for (var k = 1; k < 4; k++) {
        ctx.beginPath(); ctx.moveTo(bx - 4 * o.s, o.y - h * k / 4); ctx.lineTo(bx + 4 * o.s, o.y - h * k / 4); ctx.stroke();
      }
      U.ellipse(ctx, bx - 10 * o.s, o.y - h - 2 * o.s, 12 * o.s, 5 * o.s, pal.folha, -0.5);
      U.ellipse(ctx, bx + 10 * o.s, o.y - h + 4 * o.s, 12 * o.s, 5 * o.s, pal.folhaAlt, 0.5);
    }
  };

  /* Cerejeira */
  D.sakura = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 26 * o.s, 8 * o.s, 0.15);
    tronco(ctx, o.x, o.y, 11 * o.s, 36 * o.s, '#8a6a4a');
    var y = o.y - 46 * o.s;
    U.circle(ctx, o.x - 16 * o.s, y, 19 * o.s, '#f3b3ce');
    U.circle(ctx, o.x + 16 * o.s, y, 19 * o.s, '#f3b3ce');
    U.circle(ctx, o.x, y - 14 * o.s, 23 * o.s, '#ffc9de');
  };

  /* Pinheiro nevado */
  D.pinheiro = function (ctx, o) {
    U.shadow(ctx, o.x, o.y, 20 * o.s, 7 * o.s, 0.12);
    tronco(ctx, o.x, o.y, 9 * o.s, 20 * o.s, '#7c6350');
    for (var i = 0; i < 3; i++) {
      var yy = o.y - (18 + i * 20) * o.s, w = (30 - i * 7) * o.s;
      ctx.fillStyle = '#2f6b52';
      ctx.beginPath(); ctx.moveTo(o.x - w, yy); ctx.lineTo(o.x, yy - 26 * o.s); ctx.lineTo(o.x + w, yy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(o.x - w * 0.55, yy - 12 * o.s); ctx.lineTo(o.x, yy - 26 * o.s); ctx.lineTo(o.x + w * 0.55, yy - 12 * o.s); ctx.closePath(); ctx.fill();
    }
  };

  /* Iceberg / bloco de gelo */
  D.iceberg = function (ctx, o) {
    U.shadow(ctx, o.x, o.y, 30 * o.s, 9 * o.s, 0.10);
    ctx.fillStyle = '#dcefff';
    ctx.beginPath();
    ctx.moveTo(o.x - 34 * o.s, o.y);
    ctx.lineTo(o.x - 12 * o.s, o.y - 46 * o.s);
    ctx.lineTo(o.x + 8 * o.s, o.y - 22 * o.s);
    ctx.lineTo(o.x + 30 * o.s, o.y - 40 * o.s);
    ctx.lineTo(o.x + 38 * o.s, o.y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(o.x - 34 * o.s, o.y); ctx.lineTo(o.x - 12 * o.s, o.y - 46 * o.s);
    ctx.lineTo(o.x - 4 * o.s, o.y); ctx.closePath(); ctx.fill();
  };

  /* Pedra */
  D.pedra = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 20 * o.s, 6 * o.s, 0.15);
    var cor = o.cor || '#a8a49c';
    U.ellipse(ctx, o.x, o.y - 10 * o.s, 22 * o.s, 15 * o.s, cor);
    U.ellipse(ctx, o.x - 6 * o.s, o.y - 15 * o.s, 12 * o.s, 8 * o.s, U.shade(cor, 0.22));
    U.ellipse(ctx, o.x + 10 * o.s, o.y - 6 * o.s, 10 * o.s, 6 * o.s, U.shade(cor, -0.18));
  };

  /* Arbusto */
  D.arbusto = function (ctx, o, pal) {
    U.shadow(ctx, o.x, o.y, 18 * o.s, 6 * o.s, 0.12);
    var c = o.cor || pal.folha;
    U.circle(ctx, o.x - 11 * o.s, o.y - 10 * o.s, 12 * o.s, c);
    U.circle(ctx, o.x + 11 * o.s, o.y - 10 * o.s, 12 * o.s, c);
    U.circle(ctx, o.x, o.y - 18 * o.s, 15 * o.s, U.shade(c, 0.12));
    if (o.flores) {
      U.circle(ctx, o.x - 6 * o.s, o.y - 22 * o.s, 3 * o.s, '#ffd166');
      U.circle(ctx, o.x + 8 * o.s, o.y - 16 * o.s, 3 * o.s, '#ff8fab');
    }
  };

  /* Capim alto da savana */
  D.capim = function (ctx, o, pal, t) {
    var sway = Math.sin((t || 0) * 1.6 + o.x * 0.01) * 3 * o.s;
    ctx.strokeStyle = o.cor || '#c2ad63';
    ctx.lineWidth = 3 * o.s; ctx.lineCap = 'round';
    for (var i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(o.x + i * 5 * o.s, o.y);
      ctx.quadraticCurveTo(o.x + i * 6 * o.s + sway, o.y - 16 * o.s, o.x + i * 7 * o.s + sway * 1.6, o.y - 26 * o.s);
      ctx.stroke();
    }
  };

  /* Fonte central da praca */
  D.fonte = function (ctx, o, pal, t) {
    U.shadow(ctx, o.x, o.y, 46, 14, 0.16);
    U.ellipse(ctx, o.x, o.y - 12, 52, 26, '#d9d2c4');
    U.ellipse(ctx, o.x, o.y - 16, 44, 21, '#eae4d8');
    U.ellipse(ctx, o.x, o.y - 16, 38, 17, '#5cc7e8');
    U.ellipse(ctx, o.x, o.y - 18, 30, 12, U.rgba('#ffffff', 0.25));
    U.roundRect(ctx, o.x - 6, o.y - 46, 12, 30, 6); ctx.fillStyle = '#eae4d8'; ctx.fill();
    U.circle(ctx, o.x, o.y - 50, 9, '#eae4d8');
    for (var i = 0; i < 6; i++) {
      var a = (t * 2 + i) % 2;
      var ang = i / 6 * Math.PI * 2;
      U.circle(ctx, o.x + Math.cos(ang) * (10 + a * 16), o.y - 48 + a * 26 + Math.sin(ang) * 3, 3 - a, U.rgba('#9fe4f7', 0.9 - a * 0.4));
    }
  };

  /* Placa de madeira com texto (altura se ajusta ao texto) */
  D.placa = function (ctx, o, pal) {
    var w = o.largura || 150;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 12px Nunito, sans-serif';
    var sub = o.sub || textoDaPlaca(o.destino);
    var linhas = sub ? quebrar(ctx, sub, w - 26, 3) : [];
    var h = 26 + linhas.length * 14;

    U.shadow(ctx, o.x, o.y, w * 0.35, 7, 0.16);
    ctx.fillStyle = '#8a6236';
    ctx.fillRect(o.x - 6, o.y - 34, 5, 34);
    ctx.fillRect(o.x + 1, o.y - 34, 5, 34);
    U.roundRect(ctx, o.x - w / 2, o.y - 34 - h, w, h, 10);
    ctx.fillStyle = '#a37851'; ctx.fill();
    U.roundRect(ctx, o.x - w / 2 + 5, o.y - 30 - h, w - 10, h - 9, 7);
    ctx.fillStyle = '#bb8d61'; ctx.fill();

    ctx.fillStyle = '#fff4e2';
    ctx.font = '700 16px Fredoka, Nunito, sans-serif';
    ctx.fillText(o.titulo || '', o.x, o.y - 30 - h + 12);
    ctx.font = '600 12px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(255,244,226,0.92)';
    for (var i = 0; i < linhas.length; i++) {
      ctx.fillText(linhas[i], o.x, o.y - 30 - h + 30 + i * 14);
    }
    ctx.textBaseline = 'alphabetic';
  };

  /* Texto da placa: dica quando a regiao esta liberada, meta quando esta fechada */
  function textoDaPlaca(regiaoId) {
    var r = ZM.REGION_BY_ID[regiaoId];
    if (!r) return '';
    if (ZM.Estado.regiaoLiberada(regiaoId)) return r.dica;
    if (r.unlock.tipo === 'descobertas') {
      var faltam = Math.max(0, r.unlock.valor - ZM.Estado.totalDescobertos());
      return faltam > 0
        ? 'Descubra mais ' + faltam + (faltam === 1 ? ' animal' : ' animais') + ' para desbloquear.'
        : 'Explore mais para desbloquear esta região.';
    }
    return 'Explore mais para desbloquear esta região.';
  }

  function quebrar(ctx, texto, maxW, maxLinhas) {
    var palavras = String(texto).split(' '), linha = '', linhas = [];
    for (var i = 0; i < palavras.length; i++) {
      var teste = linha ? linha + ' ' + palavras[i] : palavras[i];
      if (ctx.measureText(teste).width > maxW && linha) { linhas.push(linha); linha = palavras[i]; }
      else linha = teste;
    }
    if (linha) linhas.push(linha);
    if (maxLinhas && linhas.length > maxLinhas) {
      linhas = linhas.slice(0, maxLinhas);
      linhas[maxLinhas - 1] = linhas[maxLinhas - 1].replace(/[.,;]?$/, '...');
    }
    return linhas;
  }

  /* Portao entre regioes (fechado com tabuas quando a regiao esta travada) */
  D.portao = function (ctx, o) {
    var w = o.largura || 90;
    var aberto = !o.porta || (ZM.Estado.regiaoLiberada(o.porta.a) && ZM.Estado.regiaoLiberada(o.porta.b));
    U.shadow(ctx, o.x, o.y, w * 0.4, 6, 0.14);
    ctx.fillStyle = '#8a6236';
    ctx.fillRect(o.x - w / 2, o.y - 60, 9, 60);
    ctx.fillRect(o.x + w / 2 - 9, o.y - 60, 9, 60);
    if (!aberto) {
      ctx.save();
      ctx.translate(o.x, o.y - 32);
      ctx.fillStyle = '#a37851';
      [-14, 4].forEach(function (dy) {
        ctx.save(); ctx.rotate(dy > 0 ? 0.06 : -0.06);
        U.roundRect(ctx, -w / 2 + 4, dy, w - 8, 13, 5); ctx.fill();
        ctx.restore();
      });
      ctx.restore();
    }
    U.roundRect(ctx, o.x - w / 2 - 6, o.y - 74, w + 12, 20, 8);
    ctx.fillStyle = aberto ? '#a37851' : '#8d6544'; ctx.fill();
    ctx.fillStyle = '#fff4e2'; ctx.font = '700 14px Fredoka, Nunito, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(aberto ? (o.titulo || '') : '🔒', o.x, o.y - 63);
    ctx.textBaseline = 'alphabetic';
  };

  /* Arco decorativo asiatico */
  D.arco = function (ctx, o) {
    U.shadow(ctx, o.x, o.y, 46, 10, 0.14);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(o.x - 40, o.y - 70, 12, 70);
    ctx.fillRect(o.x + 28, o.y - 70, 12, 70);
    ctx.fillRect(o.x - 48, o.y - 78, 96, 12);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(o.x - 54, o.y - 92, 108, 12);
  };

  function desenhar(ctx, obj, pal, t) {
    var fn = D[obj.tipo];
    if (fn) fn(ctx, obj, pal, t || 0);
  }

  return { desenhar: desenhar, tipos: D };
})();
