/* ==========================================================================
   ZOO MUNDO - Construcao do mapa (regioes, chao, cenario, barreiras)
   O mundo e uma grade de celulas; cada regiao ocupa uma celula.
   Para acrescentar uma regiao basta adicionar em data/regioes.js.
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Mundo = (function () {
  'use strict';
  var U = ZM.Utils;

  var CEL_W = 1200, CEL_H = 900;
  var ESPESSURA = 26;      // espessura das cercas
  var PORTAO = 190;        // largura da passagem entre regioes

  var mundo = {
    largura: 0, altura: 0,
    regioes: [],            // {ref, x, y, w, h, centro}
    porRegiao: {},
    props: [],              // objetos altos (desenhados por frame)
    paredes: [],            // retangulos de colisao
    chao: null,             // canvas pre-renderizado
    portas: []              // {a, b, x, y, orientacao}
  };

  function retanguloDaRegiao(r) {
    return { x: r.col * CEL_W, y: r.row * CEL_H, w: CEL_W, h: CEL_H };
  }

  /* -------------------------- geracao do mapa ------------------------- */
  function construir() {
    var cols = 0, rows = 0;
    ZM.REGIONS.forEach(function (r) { cols = Math.max(cols, r.col + 1); rows = Math.max(rows, r.row + 1); });
    mundo.largura = cols * CEL_W;
    mundo.altura = rows * CEL_H;

    mundo.regioes = ZM.REGIONS.map(function (r) {
      var rect = retanguloDaRegiao(r);
      var o = { ref: r, id: r.id, x: rect.x, y: rect.y, w: rect.w, h: rect.h,
                cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 };
      mundo.porRegiao[r.id] = o;
      return o;
    });

    mundo.portas = calcularPortas();
    mundo.props = [];
    mundo.regioes.forEach(function (reg) { gerarCenario(reg); });
    gerarPlacas();
    mundo.chao = pintarChao();
    atualizarBarreiras();
    return mundo;
  }

  /* Portas entre regioes vizinhas (uma no meio de cada borda compartilhada) */
  function calcularPortas() {
    var portas = [];
    mundo.regioes.forEach(function (a) {
      mundo.regioes.forEach(function (b) {
        if (a.ref.col === b.ref.col - 1 && a.ref.row === b.ref.row) {
          portas.push({ a: a.id, b: b.id, x: b.x, y: a.cy, orientacao: 'v' });
        }
        if (a.ref.row === b.ref.row - 1 && a.ref.col === b.ref.col) {
          portas.push({ a: a.id, b: b.id, x: a.cx, y: b.y, orientacao: 'h' });
        }
      });
    });
    return portas;
  }

  function portasDaRegiao(id) {
    return mundo.portas.filter(function (p) { return p.a === id || p.b === id; });
  }

  /* Barreiras: bordas do mundo + cercas entre regioes.
     A passagem fica aberta apenas quando AS DUAS regioes estao liberadas. */
  function atualizarBarreiras() {
    var p = [];
    var W = mundo.largura, H = mundo.altura, e = ESPESSURA;
    p.push({ x: -e, y: -e, w: W + e * 2, h: e + 10 });
    p.push({ x: -e, y: H - 10, w: W + e * 2, h: e + 10 });
    p.push({ x: -e, y: -e, w: e + 10, h: H + e * 2 });
    p.push({ x: W - 10, y: -e, w: e + 10, h: H + e * 2 });

    mundo.portas.forEach(function (porta) {
      var aberta = ZM.Estado.regiaoLiberada(porta.a) && ZM.Estado.regiaoLiberada(porta.b);
      if (porta.orientacao === 'v') {
        var topo = Math.floor(porta.y / CEL_H) * CEL_H;
        var vaoY = porta.y - PORTAO / 2;
        if (aberta) {
          p.push({ x: porta.x - e / 2, y: topo, w: e, h: vaoY - topo });
          p.push({ x: porta.x - e / 2, y: vaoY + PORTAO, w: e, h: topo + CEL_H - (vaoY + PORTAO) });
        } else {
          p.push({ x: porta.x - e / 2, y: topo, w: e, h: CEL_H });
        }
      } else {
        var esq = Math.floor(porta.x / CEL_W) * CEL_W;
        var vaoX = porta.x - PORTAO / 2;
        if (aberta) {
          p.push({ x: esq, y: porta.y - e / 2, w: vaoX - esq, h: e });
          p.push({ x: vaoX + PORTAO, y: porta.y - e / 2, w: esq + CEL_W - (vaoX + PORTAO), h: e });
        } else {
          p.push({ x: esq, y: porta.y - e / 2, w: CEL_W, h: e });
        }
      }
    });

    mundo.paredes = p;
    return p;
  }

  /* ------------------------------ cenario ----------------------------- */
  function ocupado(x, y, raio, lista) {
    for (var i = 0; i < lista.length; i++) {
      if (U.dist(x, y, lista[i].x, lista[i].y) < raio + (lista[i].raioLivre || 40)) return true;
    }
    return false;
  }

  function pontosProtegidos(reg) {
    var pts = [{ x: reg.cx, y: reg.cy, raioLivre: 120 }];
    portasDaRegiao(reg.id).forEach(function (porta) {
      pts.push({ x: porta.x, y: porta.y, raioLivre: 150 });
      // corredor entre a porta e o centro
      for (var k = 0.25; k < 1; k += 0.25) {
        pts.push({ x: U.lerp(porta.x, reg.cx, k), y: U.lerp(porta.y, reg.cy, k), raioLivre: 80 });
      }
    });
    ZM.ANIMAIS.forEach(function (a) {
      if (a.spawn.regiao === reg.id) {
        pts.push({ x: reg.x + a.spawn.x * reg.w, y: reg.y + a.spawn.y * reg.h, raioLivre: 90 });
      }
    });
    return pts;
  }

  var RECEITAS = {
    praca:    [{ tipo: 'arvore', n: 14, s: [0.9, 1.2], r: 20 }, { tipo: 'arbusto', n: 16, s: [0.8, 1.1], r: 0, flores: true }],
    savana:   [{ tipo: 'acacia', n: 11, s: [0.9, 1.25], r: 16 }, { tipo: 'pedra', n: 9, s: [0.8, 1.3], r: 20, cor: '#b6a184' }, { tipo: 'capim', n: 26, s: [0.8, 1.3], r: 0 }, { tipo: 'arbusto', n: 7, s: [0.8, 1.1], r: 0, cor: '#9aa76a' }],
    outback:  [{ tipo: 'eucalipto', n: 10, s: [0.85, 1.2], r: 15 }, { tipo: 'pedra', n: 12, s: [0.9, 1.5], r: 24, cor: '#c1663f' }, { tipo: 'arbusto', n: 12, s: [0.7, 1.0], r: 0, cor: '#9db878' }, { tipo: 'capim', n: 16, s: [0.7, 1.1], r: 0, cor: '#c99a6a' }],
    floresta: [{ tipo: 'selva', n: 20, s: [0.9, 1.3], r: 20 }, { tipo: 'arbusto', n: 20, s: [0.9, 1.3], r: 0 }, { tipo: 'pedra', n: 5, s: [0.8, 1.1], r: 20, cor: '#8d9a86' }],
    bambuzal: [{ tipo: 'bambu', n: 16, s: [0.9, 1.3], r: 14 }, { tipo: 'sakura', n: 6, s: [0.9, 1.2], r: 18 }, { tipo: 'pedra', n: 6, s: [0.8, 1.2], r: 20, cor: '#9fa9a0' }, { tipo: 'arco', n: 1, s: [1, 1], r: 40 }],
    gelo:     [{ tipo: 'iceberg', n: 10, s: [0.9, 1.4], r: 26 }, { tipo: 'pinheiro', n: 8, s: [0.9, 1.2], r: 16 }, { tipo: 'pedra', n: 5, s: [0.8, 1.1], r: 20, cor: '#cddcea' }]
  };

  function gerarCenario(reg) {
    var rand = U.rng(reg.ref.col * 977 + reg.ref.row * 131 + 7);
    var protegidos = pontosProtegidos(reg);
    var criados = [];
    var receita = RECEITAS[reg.ref.bioma] || RECEITAS.praca;

    if (reg.id === 'praca') {
      var fonte = { tipo: 'fonte', x: reg.cx, y: reg.cy + 10, s: 1, regiao: reg.id, raio: 46, raioLivre: 90 };
      mundo.props.push(fonte); criados.push(fonte);
    }

    receita.forEach(function (grupo) {
      for (var i = 0, tentativas = 0; i < grupo.n && tentativas < grupo.n * 25; tentativas++) {
        var x = reg.x + 70 + rand() * (reg.w - 140);
        var y = reg.y + 70 + rand() * (reg.h - 140);
        if (ocupado(x, y, 40, protegidos) || ocupado(x, y, 46, criados)) continue;
        var obj = {
          tipo: grupo.tipo, x: x, y: y,
          s: U.lerp(grupo.s[0], grupo.s[1], rand()),
          regiao: reg.id, raio: grupo.r, raioLivre: 44,
          cor: grupo.cor, flores: grupo.flores && rand() > 0.4
        };
        mundo.props.push(obj); criados.push(obj);
        i++;
      }
    });
  }

  /* Placas: nome da regiao e avisos de area bloqueada */
  function gerarPlacas() {
    mundo.portas.forEach(function (porta) {
      [[porta.a, porta.b], [porta.b, porta.a]].forEach(function (par) {
        var origem = mundo.porRegiao[par[0]], destino = mundo.porRegiao[par[1]];
        var dx = destino.cx - origem.cx, dy = destino.cy - origem.cy;
        var n = Math.sqrt(dx * dx + dy * dy);
        var px = porta.x - (dx / n) * 120, py = porta.y - (dy / n) * 110;
        mundo.props.push({
          tipo: 'placa', x: px, y: py, s: 1, regiao: par[0], raio: 16, raioLivre: 60,
          destino: par[1],
          titulo: destino.ref.icone + ' ' + destino.ref.nomeCurto,
          sub: destino.ref.unlock.tipo === 'embreve'
            ? 'Explore mais para desbloquear esta região.'
            : destino.ref.dica,
          largura: 168, altura: 62
        });
      });
      mundo.props.push({
        tipo: 'portao', x: porta.x, y: porta.y, s: 1, regiao: porta.a, raio: 0,
        largura: PORTAO + 20, titulo: '🌿', porta: porta
      });
    });
  }

  /* --------------------------- chao assado ---------------------------- */
  function pintarChao() {
    var c = document.createElement('canvas');
    c.width = mundo.largura; c.height = mundo.altura;
    var ctx = c.getContext('2d');

    mundo.regioes.forEach(function (reg) {
      var pal = reg.ref.paleta;
      var rand = U.rng(reg.ref.col * 331 + reg.ref.row * 57 + 3);
      ctx.fillStyle = pal.chao;
      ctx.fillRect(reg.x, reg.y, reg.w, reg.h);

      // manchas de textura
      for (var i = 0; i < 190; i++) {
        var x = reg.x + rand() * reg.w, y = reg.y + rand() * reg.h;
        U.ellipse(ctx, x, y, 30 + rand() * 70, 18 + rand() * 40,
          U.rgba(rand() > 0.5 ? pal.chaoAlt : pal.chaoDetalhe, 0.5), rand() * 3);
      }

      // agua
      if (reg.ref.bioma === 'savana') lago(ctx, reg.x + reg.w * 0.62, reg.y + reg.h * 0.78, 150, 78, pal);
      if (reg.ref.bioma === 'outback') lago(ctx, reg.x + reg.w * 0.5, reg.y + reg.h * 0.76, 130, 60, pal);
      if (reg.ref.bioma === 'floresta') lago(ctx, reg.x + reg.w * 0.5, reg.y + reg.h * 0.6, 240, 90, pal);
      if (reg.ref.bioma === 'gelo') {
        lago(ctx, reg.x + reg.w * 0.3, reg.y + reg.h * 0.35, 190, 110, pal);
        lago(ctx, reg.x + reg.w * 0.72, reg.y + reg.h * 0.7, 150, 90, pal);
      }

      // caminhos ate as portas
      ctx.lineCap = 'round';
      portasDaRegiao(reg.id).forEach(function (porta) {
        ctx.strokeStyle = pal.caminhoBorda; ctx.lineWidth = 62;
        ctx.beginPath(); ctx.moveTo(reg.cx, reg.cy); ctx.lineTo(porta.x, porta.y); ctx.stroke();
        ctx.strokeStyle = pal.caminho; ctx.lineWidth = 52;
        ctx.beginPath(); ctx.moveTo(reg.cx, reg.cy); ctx.lineTo(porta.x, porta.y); ctx.stroke();
      });

      // praca central em pedra
      if (reg.id === 'praca') {
        U.ellipse(ctx, reg.cx, reg.cy, 190, 150, pal.caminhoBorda);
        U.ellipse(ctx, reg.cx, reg.cy, 178, 140, pal.caminho);
        ctx.strokeStyle = U.rgba('#ffffff', 0.35); ctx.lineWidth = 3;
        for (var k = 1; k <= 3; k++) {
          ctx.beginPath(); ctx.ellipse(reg.cx, reg.cy, 60 * k, 46 * k, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // detalhes baixinhos: tufos, flores, pedrinhas
      for (var j = 0; j < 240; j++) {
        var dx = reg.x + rand() * reg.w, dy = reg.y + rand() * reg.h;
        var t = rand();
        if (t < 0.55) {
          ctx.strokeStyle = U.rgba(pal.folha, 0.55); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
          for (var b = -1; b <= 1; b++) {
            ctx.beginPath(); ctx.moveTo(dx + b * 4, dy); ctx.lineTo(dx + b * 5, dy - 7 - rand() * 4); ctx.stroke();
          }
        } else if (t < 0.8) {
          U.circle(ctx, dx, dy, 2 + rand() * 2, U.rgba(rand() > 0.5 ? '#ffffff' : '#ffd166', 0.7));
        } else {
          U.ellipse(ctx, dx, dy, 4 + rand() * 4, 3 + rand() * 2, U.rgba('#000000', 0.06));
        }
      }

      // cercas visuais nas bordas da regiao
      cerca(ctx, reg);
    });

    return c;
  }

  function lago(ctx, x, y, rx, ry, pal) {
    U.ellipse(ctx, x, y, rx + 12, ry + 10, U.rgba(pal.caminhoBorda, 0.6));
    U.ellipse(ctx, x, y, rx, ry, pal.agua);
    U.ellipse(ctx, x - rx * 0.2, y - ry * 0.25, rx * 0.55, ry * 0.35, U.rgba('#ffffff', 0.22));
  }

  function cerca(ctx, reg) {
    var pal = reg.ref.paleta;
    ctx.fillStyle = U.rgba(pal.folha, 0.9);
    var e = ESPESSURA;
    [[reg.x, reg.y, reg.w, e], [reg.x, reg.y + reg.h - e, reg.w, e],
     [reg.x, reg.y, e, reg.h], [reg.x + reg.w - e, reg.y, e, reg.h]].forEach(function (r) {
      ctx.fillStyle = U.rgba(pal.folha, 0.85);
      ctx.fillRect(r[0], r[1], r[2], r[3]);
      ctx.fillStyle = U.rgba('#0d3b1f', 0.18);
      ctx.fillRect(r[0], r[1], r[2], Math.min(6, r[3]));
    });
    // vaos das portas ficam mais claros (indicam passagem)
    portasDaRegiao(reg.id).forEach(function (porta) {
      if (porta.orientacao === 'v') {
        ctx.fillStyle = pal.caminho;
        ctx.fillRect(porta.x - 30, porta.y - PORTAO / 2, 60, PORTAO);
      } else {
        ctx.fillStyle = pal.caminho;
        ctx.fillRect(porta.x - PORTAO / 2, porta.y - 30, PORTAO, 60);
      }
    });
  }

  /* ---------------------------- consultas ----------------------------- */
  function regiaoEm(x, y) {
    for (var i = 0; i < mundo.regioes.length; i++) {
      var r = mundo.regioes[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return mundo.porRegiao.praca;
  }

  function pontoNaRegiao(regiaoId, nx, ny) {
    var r = mundo.porRegiao[regiaoId];
    return { x: r.x + nx * r.w, y: r.y + ny * r.h };
  }

  function colide(x, y, raio) {
    var i;
    for (i = 0; i < mundo.paredes.length; i++) {
      if (U.circleRectOverlap(x, y, raio, mundo.paredes[i])) return true;
    }
    for (i = 0; i < mundo.props.length; i++) {
      var p = mundo.props[i];
      if (!p.raio) continue;
      if (Math.abs(p.x - x) > 200 || Math.abs(p.y - y) > 200) continue;
      var dy = (p.y - 6) - y;
      var dx = p.x - x;
      if (dx * dx + dy * dy < (p.raio * p.s + raio) * (p.raio * p.s + raio)) return true;
    }
    return false;
  }

  /* Resolve a colisao empurrando o circulo para fora dos obstaculos.
     Permite "deslizar" ao encostar em arvores, cercas e na fonte. */
  function resolver(x, y, raio) {
    var pos = { x: x, y: y };
    for (var passo = 0; passo < 3; passo++) {
      var mexeu = false;
      var i;

      for (i = 0; i < mundo.props.length; i++) {
        var pr = mundo.props[i];
        if (!pr.raio) continue;
        if (Math.abs(pr.x - pos.x) > 260 || Math.abs(pr.y - pos.y) > 260) continue;
        var py = pr.y - 6;
        var alcance = pr.raio * pr.s + raio;
        var dx = pos.x - pr.x, dy = pos.y - py;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < alcance) {
          if (d < 0.0001) { dx = 0; dy = -1; d = 1; }
          pos.x = pr.x + (dx / d) * alcance;
          pos.y = py + (dy / d) * alcance;
          mexeu = true;
        }
      }

      for (i = 0; i < mundo.paredes.length; i++) {
        var r = mundo.paredes[i];
        if (!U.circleRectOverlap(pos.x, pos.y, raio, r)) continue;
        var nx = U.clamp(pos.x, r.x, r.x + r.w);
        var ny = U.clamp(pos.y, r.y, r.y + r.h);
        var vx = pos.x - nx, vy = pos.y - ny;
        var dd = Math.sqrt(vx * vx + vy * vy);
        if (dd > 0.0001) {
          pos.x = nx + (vx / dd) * raio;
          pos.y = ny + (vy / dd) * raio;
        } else {
          // centro dentro do retangulo: sai pelo lado mais proximo
          var esq = pos.x - r.x, dir = (r.x + r.w) - pos.x;
          var cima = pos.y - r.y, baixo = (r.y + r.h) - pos.y;
          var menor = Math.min(esq, dir, cima, baixo);
          if (menor === esq) pos.x = r.x - raio;
          else if (menor === dir) pos.x = r.x + r.w + raio;
          else if (menor === cima) pos.y = r.y - raio;
          else pos.y = r.y + r.h + raio;
        }
        mexeu = true;
      }

      if (!mexeu) break;
    }
    return pos;
  }

  return {
    construir: construir, atualizarBarreiras: atualizarBarreiras, resolver: resolver,
    regiaoEm: regiaoEm, pontoNaRegiao: pontoNaRegiao, colide: colide,
    dados: mundo, CEL_W: CEL_W, CEL_H: CEL_H, PORTAO: PORTAO
  };
})();
