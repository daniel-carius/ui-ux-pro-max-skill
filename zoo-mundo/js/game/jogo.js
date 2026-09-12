/* ==========================================================================
   ZOO MUNDO - Motor do jogo: camera, personagem, animais, particulas e loop
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Jogo = (function () {
  'use strict';
  var U = ZM.Utils;

  var canvas, ctx, dpr = 1;
  var mundo, jogador, animais = [], particulas = [], textos = [];
  var camera = { x: 0, y: 0, escala: 1 };
  var tempo = 0, ultimo = 0, rodando = false, pausado = false;
  var regiaoAtual = null, faixaRegiao = { texto: '', vida: 0 };
  var alvoProximo = null;
  var aoInteragir = function () {};
  var acumuladorSalvar = 0;
  var minimapa = null, minimapaCtx = null;

  var rastro = [];                 // caminho recente do jogador (a comitiva anda por ele)
  var aoEntregar = function () {};
  var aoColher = function () {};
  var aoAlimentar = function () {};
  var fontes = [];                 // props que dão comida
  var alvoComida = null;
  var RECARGA_FONTE = 25;          // segundos até a fonte dar comida de novo
  var RAIO_COLHEITA = 90;

  var RAIO_JOGADOR = 13;
  var PASSO_RASTRO = 9;            // distância entre pontos guardados do caminho
  var VAO_COMITIVA = 5;            // quantos pontos de distância entre um animal e outro
  var RAIO_INTERACAO = 105;
  var VELOCIDADE = 215;
  var PONTOS_ENTREGA = 50;

  /* ------------------------------ inicio ------------------------------ */
  function iniciar(elCanvas, elMinimapa) {
    canvas = elCanvas;
    ctx = canvas.getContext('2d');
    minimapa = elMinimapa;
    if (minimapa) minimapaCtx = minimapa.getContext('2d');
    mundo = ZM.Mundo.construir();
    fontes = mundo.props.filter(function (p) { return !!p.comida; });
    criarJogador();
    criarAnimais();
    camera.x = jogador.x; camera.y = jogador.y;
    redimensionar();
    limitarCamera();
    window.addEventListener('resize', redimensionar);
  }

  function redimensionar() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    camera.escala = U.clamp(h / 580, 0.72, 1.7);
  }

  function criarJogador() {
    var d = ZM.Estado.get();
    var praca = ZM.Mundo.dados.porRegiao.praca;
    var pos = d.jogador || { x: praca.cx + 120, y: praca.cy + 150 };
    jogador = {
      x: pos.x, y: pos.y, dir: 'baixo', fase: 0, andando: false,
      personagem: ZM.PERSONAGEM_BY_ID[d.personagem] || ZM.PERSONAGENS[0]
    };
  }

  function trocarPersonagem(id) {
    jogador.personagem = ZM.PERSONAGEM_BY_ID[id] || ZM.PERSONAGENS[0];
  }

  function posicaoLivre(x, y) {
    if (!ZM.Mundo.colide(x, y, 26)) return { x: x, y: y };
    for (var raio = 40; raio <= 240; raio += 40) {
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        var nx = x + Math.cos(a) * raio, ny = y + Math.sin(a) * raio;
        if (!ZM.Mundo.colide(nx, ny, 26)) return { x: nx, y: ny };
      }
    }
    return { x: x, y: y };
  }

  function criarAnimais() {
    animais = [];
    var contadorCasa = {};
    ZM.ANIMAIS.forEach(function (ref) {
      var regiaoId = ZM.Estado.regiaoDoAnimal(ref.id);
      var reg = ZM.Mundo.dados.porRegiao[regiaoId];
      var pos;
      if (regiaoId === ref.spawn.regiao) {
        pos = ZM.Mundo.pontoNaRegiao(regiaoId, ref.spawn.x, ref.spawn.y);
      } else {
        var k = (contadorCasa[regiaoId] = (contadorCasa[regiaoId] || 0) + 1);
        var ang = -Math.PI / 2 + k * 1.05;
        pos = { x: reg.cx + Math.cos(ang) * 250, y: reg.cy + Math.sin(ang) * 190 };
      }
      pos = posicaoLivre(pos.x, pos.y);
      animais.push({
        ref: ref, id: ref.id, regiao: regiaoId,
        baseX: pos.x, baseY: pos.y, x: pos.x, y: pos.y,
        fase: Math.random() * 10, brilho: 0,
        seguindo: ZM.Estado.estaSeguindo(ref.id), dir: 1
      });
    });
  }

  /* Colhe comida numa fonte do cenário (árvore, bambu, cais, pedra...) */
  function colher(fonte) {
    var f = fonte || alvoComida;
    if (!f || f.vazio) return false;
    var comida = ZM.COMIDA_BY_ID[f.comida];
    if (!ZM.Estado.guardarComida(f.comida)) {
      ZM.Audio.tocar('quase');
      textoFlutuante(f.x, f.y - 70, 'Mochila cheia de ' + comida.emoji + '!', '#ffffff');
      return false;
    }
    f.recargaAte = tempo + RECARGA_FONTE;
    f.vazio = true;
    ZM.Audio.tocar('colher');
    faiscas(f.x, f.y - 40, 12, comida.cor);
    textoFlutuante(f.x, f.y - 76, '+1 ' + comida.emoji, '#ffffff');
    aoColher(comida);
    return true;
  }

  /* Dá ao animal a comida que ele pediu: ele come e passa a acompanhar */
  function alimentar(id) {
    var a = buscar(id);
    var comidaId = ZM.Estado.pedidoDe(id) || a.ref.comida;
    if (!a || !ZM.Estado.temComida(comidaId)) return false;
    var comida = ZM.COMIDA_BY_ID[comidaId];
    ZM.Estado.usarComida(comidaId);
    ZM.Estado.marcarAlimentado(id);
    a.comendo = 1.4;
    ZM.Audio.tocar('comer');
    setTimeout(function () { ZM.Audio.tocar(a.ref.som); }, 500);
    faiscas(a.x, a.y - 40, 18, comida.cor);
    for (var i = 0; i < 5; i++) {
      particulas.push({ x: a.x + (Math.random() - 0.5) * 30, y: a.y - 60, vx: (Math.random() - 0.5) * 30, vy: -50 - Math.random() * 40,
        vida: 1.2, total: 1.2, cor: '#ff8fab', r: 6, forma: 'coracao', semGravidade: true });
    }
    textoFlutuante(a.x, a.y - 96, 'Nhac! ' + comida.emoji, '#ffffff');
    aoAlimentar(a.ref, comida);
    setTimeout(function () { chamarParaSeguir(id); }, 900);
    return true;
  }

  /* O animal começa a acompanhar o jogador */
  function chamarParaSeguir(id) {
    var a = buscar(id);
    if (!a) return;
    a.seguindo = true;
    ZM.Estado.chamarParaSeguir(id);
    ZM.Audio.tocar('seguindo');
    faiscas(a.x, a.y - 30, 14, '#7ee0c0');
    textoFlutuante(a.x, a.y - 80, 'Vamos juntos!', '#ffffff');
  }

  /* O animal para de acompanhar e fica onde está */
  function deixarAqui(id) {
    var a = buscar(id);
    if (!a) return;
    a.seguindo = false;
    ZM.Estado.pararDeSeguir(id);
    var pos = posicaoLivre(a.x, a.y);
    a.regiao = ZM.Mundo.regiaoEm(pos.x, pos.y).id;
    a.baseX = a.x = pos.x; a.baseY = a.y = pos.y;
  }

  /* O animal chegou na região dele: comemoração e recompensa */
  function chegouEmCasa(a) {
    var reg = ZM.Mundo.dados.porRegiao[a.ref.casa];
    var vizinhos = animais.filter(function (o) {
      return o.regiao === a.ref.casa && !o.seguindo && o !== a;
    }).length;
    var ang = -Math.PI / 2 + (vizinhos + 1) * 1.05;
    var pos = posicaoLivre(reg.cx + Math.cos(ang) * 250, reg.cy + Math.sin(ang) * 190);
    a.seguindo = false;
    a.regiao = a.ref.casa;
    a.baseX = a.x = pos.x; a.baseY = a.y = pos.y;
    a.brilho = 1;
    ZM.Estado.levarParaCasa(a.id);
    comemorar(jogador.x, jogador.y);
    textoFlutuante(jogador.x, jogador.y - 90, '+' + PONTOS_ENTREGA, '#ffd166');
    ZM.Estado.somarPontos(PONTOS_ENTREGA);
    ZM.Audio.tocar('casa');
    ZM.Audio.tocar(a.ref.som);
    aoEntregar(a.ref);
  }

  function buscar(id) {
    for (var i = 0; i < animais.length; i++) if (animais[i].id === id) return animais[i];
    return null;
  }

  /* --------------------------- efeitos visuais ------------------------ */
  function faiscas(x, y, n, cor) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 130;
      particulas.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
        vida: 0.7 + Math.random() * 0.6, total: 1.3,
        cor: cor || '#ffd166', r: 2 + Math.random() * 3.5,
        forma: Math.random() > 0.5 ? 'estrela' : 'circulo'
      });
    }
  }

  function textoFlutuante(x, y, texto, cor) {
    textos.push({ x: x, y: y, texto: texto, cor: cor || '#ffffff', vida: 1.5 });
  }

  function comemorar(x, y) {
    faiscas(x, y - 40, 46, '#ffd166');
    faiscas(x, y - 40, 26, '#7ee0c0');
    faiscas(x, y - 40, 26, '#ff8fab');
  }

  /* ------------------------------- loop ------------------------------- */
  function comecar() {
    if (rodando) return;
    rodando = true; ultimo = performance.now();
    requestAnimationFrame(quadro);
  }

  function pausar(v) { pausado = !!v; if (!v) ZM.Entrada.limpar(); }
  function estaPausado() { return pausado; }

  function quadro(agora) {
    if (!rodando) return;
    var dt = Math.min(0.05, (agora - ultimo) / 1000);
    ultimo = agora;
    tempo += dt;
    if (!pausado) atualizar(dt);
    desenhar();
    if (minimapaCtx) desenharMinimapa();
    requestAnimationFrame(quadro);
  }

  function atualizar(dt) {
    var v = ZM.Entrada.vetor();
    var vel = VELOCIDADE * dt;
    jogador.andando = (Math.abs(v.x) + Math.abs(v.y)) > 0.05;

    if (jogador.andando) {
      if (Math.abs(v.x) > Math.abs(v.y)) jogador.dir = v.x > 0 ? 'dir' : 'esq';
      else jogador.dir = v.y > 0 ? 'baixo' : 'cima';
      jogador.fase += dt * 11;

      var destino = ZM.Mundo.resolver(jogador.x + v.x * vel, jogador.y + v.y * vel, RAIO_JOGADOR);
      jogador.x = destino.x;
      jogador.y = destino.y;
    }

    // camera segue com suavidade, sem sair do mundo
    camera.x = U.lerp(camera.x, jogador.x, Math.min(1, dt * 7));
    camera.y = U.lerp(camera.y, jogador.y, Math.min(1, dt * 7));
    limitarCamera();

    // regiao atual
    var reg = ZM.Mundo.regiaoEm(jogador.x, jogador.y);
    if (!regiaoAtual || reg.id !== regiaoAtual.id) {
      regiaoAtual = reg;
      faixaRegiao = { texto: reg.ref.icone + '  ' + reg.ref.nome, vida: 2.6 };
    }
    if (faixaRegiao.vida > 0) faixaRegiao.vida -= dt;

    // rastro do jogador (a comitiva anda por onde ele andou)
    var ultimo = rastro[rastro.length - 1];
    if (!ultimo || U.dist(ultimo.x, ultimo.y, jogador.x, jogador.y) > PASSO_RASTRO) {
      rastro.push({ x: jogador.x, y: jogador.y });
      if (rastro.length > 400) rastro.shift();
    }

    // animais passeiam (ou acompanham o jogador)
    var lugarNaFila = 0;
    animais.forEach(function (a) {
      if (a.seguindo) {
        var indice = rastro.length - 1 - (lugarNaFila + 1) * VAO_COMITIVA;
        var alvoPos = indice >= 0 ? rastro[indice] : { x: jogador.x, y: jogador.y };
        var antesX = a.x;
        a.x = U.lerp(a.x, alvoPos.x, Math.min(1, dt * 9));
        a.y = U.lerp(a.y, alvoPos.y + 6, Math.min(1, dt * 9));
        if (Math.abs(a.x - antesX) > 0.4) a.dir = a.x > antesX ? 1 : -1;
        a.baseX = a.x; a.baseY = a.y;
        lugarNaFila++;
      } else {
        a.x = a.baseX + Math.sin(tempo * 0.45 + a.fase) * 26;
        a.y = a.baseY + Math.sin(tempo * 0.33 + a.fase * 1.7) * 14;
      }
      if (a.brilho > 0) a.brilho -= dt * 0.5;
    });

    // chegou em casa? (vale a região onde o jogador está)
    if (regiaoAtual) {
      animais.forEach(function (a) {
        if (a.seguindo && regiaoAtual.id === a.ref.casa) chegouEmCasa(a);
      });
    }

    // fontes de comida recarregam com o tempo
    for (var fi = 0; fi < fontes.length; fi++) {
      var fo = fontes[fi];
      if (fo.vazio && tempo >= (fo.recargaAte || 0)) fo.vazio = false;
    }

    // fonte de comida mais perto (só conta quando não há animal por perto)
    alvoComida = null;
    var melhorF = RAIO_COLHEITA;
    for (var fj = 0; fj < fontes.length; fj++) {
      var ft = fontes[fj];
      if (ft.vazio || !ZM.Estado.regiaoLiberada(ft.regiao)) continue;
      var df = U.dist(jogador.x, jogador.y, ft.x, ft.y - 10);
      if (df < melhorF) { melhorF = df; alvoComida = ft; }
    }

    animais.forEach(function (a) { if (a.comendo > 0) a.comendo -= dt; });

    // alvo de interacao
    alvoProximo = null;
    var melhor = RAIO_INTERACAO;
    animais.forEach(function (a) {
      if (a.seguindo || !ZM.Estado.regiaoLiberada(a.regiao)) return;
      var d = U.dist(jogador.x, jogador.y, a.x, a.y - 20);
      if (d < melhor) { melhor = d; alvoProximo = a; }
    });

    // animal e fonte ao alcance ao mesmo tempo: o animal vence, a não ser que a fonte esteja bem mais perto
    if (alvoProximo && alvoComida) {
      if (melhorF < melhor * 0.6) alvoProximo = null; else alvoComida = null;
    }

    // acoes
    if (ZM.Entrada.consumirAcao()) {
      if (alvoProximo) abrirEncontro(alvoProximo);
      else if (alvoComida) colher(alvoComida);
    }
    var clique = ZM.Entrada.consumirClique();
    if (clique) {
      var p = telaParaMundo(clique.x, clique.y);
      // toque direto numa fonte de comida vale mesmo com animal por perto
      var fonteTocada = null, melhorFT = 55;
      fontes.forEach(function (f) {
        if (f.vazio || !ZM.Estado.regiaoLiberada(f.regiao)) return;
        var d = U.dist(p.x, p.y, f.x, f.y - 30);
        if (d < melhorFT) { melhorFT = d; fonteTocada = f; }
      });
      var tocado = null, melhorD = 70;
      animais.forEach(function (a) {
        if (!a.seguindo && !ZM.Estado.regiaoLiberada(a.regiao)) return;
        var d = U.dist(p.x, p.y, a.x, a.y - 30);
        if (d < melhorD) { melhorD = d; tocado = a; }
      });
      if (tocado && (!fonteTocada || melhorD <= melhorFT)) {
        if (U.dist(jogador.x, jogador.y, tocado.x, tocado.y) <= RAIO_INTERACAO * 1.6) abrirEncontro(tocado);
        else textoFlutuante(tocado.x, tocado.y - 70, 'Chegue mais perto!', '#ffffff');
      } else if (fonteTocada) {
        if (U.dist(jogador.x, jogador.y, fonteTocada.x, fonteTocada.y) <= RAIO_COLHEITA * 1.6) colher(fonteTocada);
        else textoFlutuante(fonteTocada.x, fonteTocada.y - 70, 'Chegue mais perto!', '#ffffff');
      }
    }

    // particulas e textos
    for (var i = particulas.length - 1; i >= 0; i--) {
      var pt = particulas[i];
      pt.vida -= dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      if (!pt.semGravidade) pt.vy += 260 * dt;
      if (pt.vida <= 0) particulas.splice(i, 1);
    }
    for (var j = textos.length - 1; j >= 0; j--) {
      textos[j].vida -= dt; textos[j].y -= 26 * dt;
      if (textos[j].vida <= 0) textos.splice(j, 1);
    }

    // salvar posicao de tempos em tempos
    acumuladorSalvar += dt;
    if (acumuladorSalvar > 2) {
      acumuladorSalvar = 0;
      ZM.Estado.salvarPosicaoJogador(jogador.x, jogador.y);
      ZM.Estado.salvar();
    }
  }

  function limitarCamera() {
    var vw = canvas.clientWidth / camera.escala, vh = canvas.clientHeight / camera.escala;
    var M = ZM.Mundo.dados;
    camera.x = vw >= M.largura ? M.largura / 2 : U.clamp(camera.x, vw / 2, M.largura - vw / 2);
    camera.y = vh >= M.altura ? M.altura / 2 : U.clamp(camera.y, vh / 2, M.altura - vh / 2);
  }

  function abrirEncontro(a) {
    ZM.Estado.salvarPosicaoJogador(jogador.x, jogador.y);
    ZM.Estado.salvar();
    var pedido = ZM.Estado.pedidoDe(a.id);
    if (pedido && !a.seguindo && ZM.Estado.temComida(pedido)) {   // já sabe o que ele come: só entrega
      alimentar(a.id);
      return;
    }
    ZM.Audio.tocar('encontro');
    aoInteragir(a.ref, a.regiao);
  }

  /* ----------------------------- desenho ------------------------------ */
  function telaParaMundo(sx, sy) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    return {
      x: (sx - w / 2) / camera.escala + camera.x,
      y: (sy - h / 2) / camera.escala + camera.y
    };
  }

  function desenhar() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f2417';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(camera.escala, camera.escala);
    ctx.translate(-camera.x, -camera.y);

    var vw = w / camera.escala, vh = h / camera.escala;
    var vx = camera.x - vw / 2, vy = camera.y - vh / 2;

    // chao
    ctx.drawImage(ZM.Mundo.dados.chao, vx, vy, vw, vh, vx, vy, vw, vh);

    // neblina das regioes bloqueadas
    ZM.Mundo.dados.regioes.forEach(function (reg) {
      if (ZM.Estado.regiaoLiberada(reg.id)) return;
      if (reg.x > vx + vw || reg.x + reg.w < vx || reg.y > vy + vh || reg.y + reg.h < vy) return;
      ctx.save();
      ctx.fillStyle = 'rgba(18,32,54,0.42)';
      ctx.fillRect(reg.x, reg.y, reg.w, reg.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 18;
      for (var i = -reg.h; i < reg.w; i += 64) {
        ctx.beginPath(); ctx.moveTo(reg.x + i, reg.y); ctx.lineTo(reg.x + i + reg.h, reg.y + reg.h); ctx.stroke();
      }
      ctx.restore();
    });

    // objetos altos + animais + jogador (ordenados por profundidade)
    var fila = [];
    ZM.Mundo.dados.props.forEach(function (p) {
      if (p.x < vx - 120 || p.x > vx + vw + 120 || p.y < vy - 160 || p.y > vy + vh + 160) return;
      fila.push({ y: p.y, tipo: 'prop', o: p });
    });
    animais.forEach(function (a) {
      if (!a.seguindo && !ZM.Estado.regiaoLiberada(a.regiao)) return;
      if (a.x < vx - 120 || a.x > vx + vw + 120 || a.y < vy - 160 || a.y > vy + vh + 160) return;
      fila.push({ y: a.y, tipo: 'animal', o: a });
    });
    fila.push({ y: jogador.y, tipo: 'jogador', o: jogador });
    fila.sort(function (a, b) { return a.y - b.y; });

    fila.forEach(function (item) {
      if (item.tipo === 'prop') {
        var reg = ZM.Mundo.dados.porRegiao[item.o.regiao];
        ZM.Cenario.desenhar(ctx, item.o, reg.ref.paleta, tempo);
        if (item.o.comida) desenharFonte(item.o);
      } else if (item.tipo === 'animal') {
        desenharAnimal(item.o);
      } else {
        ZM.SpritesPersonagem.desenhar(ctx, jogador.personagem, jogador.x, jogador.y,
          1, jogador.dir, jogador.fase, jogador.andando, tempo);
      }
    });

    // particulas
    particulas.forEach(function (p) {
      var a = U.clamp(p.vida, 0, 1);
      ctx.globalAlpha = a;
      if (p.forma === 'estrela') estrela(ctx, p.x, p.y, p.r * 1.7, p.cor);
      else if (p.forma === 'coracao') coracao(ctx, p.x, p.y, p.r, p.cor);
      else U.circle(ctx, p.x, p.y, p.r, p.cor);
      ctx.globalAlpha = 1;
    });

    // textos flutuantes
    ctx.textAlign = 'center';
    textos.forEach(function (t) {
      ctx.globalAlpha = U.clamp(t.vida, 0, 1);
      ctx.font = '800 20px Fredoka, Nunito, sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,30,20,0.55)';
      ctx.strokeText(t.texto, t.x, t.y);
      ctx.fillStyle = t.cor; ctx.fillText(t.texto, t.x, t.y);
      ctx.globalAlpha = 1;
    });

    ctx.restore();

    // faixa com o nome da regiao
    if (faixaRegiao.vida > 0) {
      var alfa = U.clamp(faixaRegiao.vida, 0, 1);
      var faixaY = w < 760 ? 178 : 82;
      ctx.globalAlpha = alfa;
      ctx.textAlign = 'center';
      ctx.font = '800 ' + (w < 760 ? 24 : 30) + 'px Fredoka, Nunito, sans-serif';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(15,28,20,0.55)';
      ctx.strokeText(faixaRegiao.texto, w / 2, faixaY);
      ctx.fillStyle = '#fff8e7';
      ctx.fillText(faixaRegiao.texto, w / 2, faixaY);
      ctx.globalAlpha = 1;
    }
  }

  function desenharAnimal(a) {
    var descoberto = ZM.Estado.descoberto(a.id);
    var perdido = a.regiao !== a.ref.casa;
    var pulo = a.comendo > 0 ? Math.abs(Math.sin(tempo * 14)) * 8 : 0;
    ZM.SpritesAnimais.desenhar(a.ref.sprite, ctx, a.x, a.y - pulo, a.seguindo ? 0.78 : 0.86,
      tempo + a.fase, { espelhar: a.seguindo && a.dir < 0 });

    // indicadores
    var topo = a.y - 96;
    var pedido = ZM.Estado.pedidoDe(a.id);
    if (pedido && !a.seguindo) {
      var comida = ZM.COMIDA_BY_ID[pedido];
      var py = topo - 6 + Math.sin(tempo * 4 + a.fase) * 4;
      U.circle(ctx, a.x + 4, py, 17, '#ffffff');
      U.circle(ctx, a.x - 10, py + 16, 5, '#ffffff');
      U.circle(ctx, a.x - 17, py + 24, 3, '#ffffff');
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000'; ctx.fillText(comida.emoji, a.x + 4, py + 1);
      ctx.textBaseline = 'alphabetic';
      if (alvoProximo === a) aroAlvo(a);
      return;
    }
    if (a.seguindo) {
      var pulsa = 1 + Math.sin(tempo * 5 + a.fase) * 0.12;
      ctx.save();
      ctx.translate(a.x + 22, a.y - 74);
      ctx.scale(pulsa, pulsa);
      coracao(ctx, 0, 0, 7, '#ff8fab');
      ctx.restore();
      return;
    }
    if (!descoberto) {
      var pulo = Math.sin(tempo * 4 + a.fase) * 4;
      balaozinho(ctx, a.x, topo + pulo, perdido ? '#ff8fab' : '#ffd166', perdido ? '?' : '!');
    } else if (perdido) {
      balaozinho(ctx, a.x, topo + Math.sin(tempo * 4 + a.fase) * 4, '#ff8fab', '?');
    } else {
      ctx.globalAlpha = 0.9;
      estrela(ctx, a.x + 26, a.y - 78 + Math.sin(tempo * 3 + a.fase) * 3, 7, '#ffd166');
      ctx.globalAlpha = 1;
    }
    if (a.brilho > 0) {
      ctx.globalAlpha = a.brilho;
      U.circle(ctx, a.x, a.y - 30, 60 * (1.2 - a.brilho), 'rgba(255,236,170,0.35)');
      ctx.globalAlpha = 1;
    }
    if (alvoProximo === a) aroAlvo(a);
  }

  function aroAlvo(a) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 3; ctx.setLineDash([7, 7]);
    ctx.beginPath(); ctx.ellipse(a.x, a.y, 44, 18, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /* Fonte de comida: mostra a comida flutuando quando está disponível e perto */
  function desenharFonte(f) {
    if (f.vazio) return;
    if (Math.abs(f.x - jogador.x) > 190 || Math.abs(f.y - jogador.y) > 170) return;   // só as fontes bem perto, para não poluir a tela
    var comida = ZM.COMIDA_BY_ID[f.comida];
    var alturaTopo = { pedra: 34, capim: 36, arbusto: 42, bambu: 90, pesqueiro: 60, cozinha: 96, pier: 48, palmeira: 100 }[f.tipo] || 84;
    var y = f.y - alturaTopo * (f.s || 1) - 10 + Math.sin(tempo * 3 + f.x * 0.05) * 3;
    ctx.globalAlpha = 0.95;
    U.circle(ctx, f.x, y, 13, 'rgba(255,255,255,0.9)');
    ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(comida.emoji, f.x, y + 1);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
    if (alvoComida === f) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 3; ctx.setLineDash([7, 7]);
      ctx.beginPath(); ctx.ellipse(f.x, f.y, 34, 14, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function balaozinho(ctx, x, y, cor, simbolo) {
    U.circle(ctx, x, y, 15, cor);
    U.circle(ctx, x, y, 15, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.moveTo(x - 6, y + 11); ctx.lineTo(x + 6, y + 11); ctx.lineTo(x, y + 21); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2a12';
    ctx.font = '800 18px Fredoka, Nunito, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(simbolo, x, y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function coracao(ctx, x, y, r, cor) {
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.5, y - r * 0.4, x - r * 0.5, y - r * 1.3, x, y - r * 0.4);
    ctx.bezierCurveTo(x + r * 0.5, y - r * 1.3, x + r * 1.5, y - r * 0.4, x, y + r * 0.9);
    ctx.fill();
  }

  function estrela(ctx, x, y, r, cor) {
    ctx.fillStyle = cor;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var raio = i % 2 === 0 ? r : r * 0.45;
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      var px = x + Math.cos(ang) * raio, py = y + Math.sin(ang) * raio;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  /* ----------------------------- minimapa ----------------------------- */
  function desenharMinimapa() {
    var c = minimapa;
    var w = c.width, h = c.height;
    var ctx2 = minimapaCtx;
    ctx2.clearRect(0, 0, w, h);
    var escala = Math.min(w / ZM.Mundo.dados.largura, h / ZM.Mundo.dados.altura);
    var offX = (w - ZM.Mundo.dados.largura * escala) / 2;
    var offY = (h - ZM.Mundo.dados.altura * escala) / 2;
    ZM.Mundo.dados.regioes.forEach(function (reg) {
      var liberada = ZM.Estado.regiaoLiberada(reg.id);
      ctx2.fillStyle = liberada ? reg.ref.paleta.chao : 'rgba(255,255,255,0.14)';
      ctx2.fillRect(offX + reg.x * escala + 1, offY + reg.y * escala + 1, reg.w * escala - 2, reg.h * escala - 2);
      if (!liberada) {
        ctx2.fillStyle = 'rgba(255,255,255,0.55)';
        ctx2.font = '10px Nunito, sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText('🔒', offX + (reg.x + reg.w / 2) * escala, offY + (reg.y + reg.h / 2) * escala + 4);
      }
    });
    ctx2.fillStyle = '#ffffff';
    ctx2.beginPath();
    ctx2.arc(offX + jogador.x * escala, offY + jogador.y * escala, 3.5, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.strokeStyle = '#1b2c1f'; ctx2.lineWidth = 1.5; ctx2.stroke();
  }

  /* ---------------------------- integracao ---------------------------- */
  function aoEncontrarAnimal(fn) { aoInteragir = fn; }

  function atualizarRegioes() {
    ZM.Mundo.atualizarBarreiras();
  }

  function posicaoJogadorTela() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    return {
      x: w / 2 + (jogador.x - camera.x) * camera.escala,
      y: h / 2 + (jogador.y - camera.y) * camera.escala
    };
  }

  function jogadorMundo() { return { x: jogador.x, y: jogador.y }; }
  /* Ajuda de desenvolvimento/testes: leva o jogador direto a um ponto */
  function teleportar(x, y) {
    var pos = ZM.Mundo.resolver(x, y, RAIO_JOGADOR);
    jogador.x = pos.x; jogador.y = pos.y;
    camera.x = jogador.x; camera.y = jogador.y;
    rastro = [{ x: jogador.x, y: jogador.y }];
    animais.forEach(function (a) {              // a comitiva vem junto
      if (a.seguindo) { a.x = a.baseX = jogador.x; a.y = a.baseY = jogador.y + 6; }
    });
  }
  function animaisNoMundo() {
    return animais.map(function (a) { return { id: a.id, x: a.x, y: a.y, regiao: a.regiao }; });
  }
  function temAlvo() { return !!alvoProximo || !!alvoComida; }
  function alvoAtual() { return alvoProximo ? alvoProximo.id : null; }

  return {
    iniciar: iniciar, comecar: comecar, pausar: pausar, estaPausado: estaPausado,
    aoEncontrarAnimal: aoEncontrarAnimal,
    chamarParaSeguir: chamarParaSeguir, deixarAqui: deixarAqui,
    aoEntregarAnimal: function (fn) { aoEntregar = fn; },
    aoColherComida: function (fn) { aoColher = fn; },
    aoAlimentarAnimal: function (fn) { aoAlimentar = fn; },
    colher: colher, alimentar: alimentar,
    alvoComidaAtual: function () { return alvoComida ? { tipo: alvoComida.tipo, comida: alvoComida.comida, x: alvoComida.x, y: alvoComida.y } : null; },
    fontesDeComida: function () {
      return fontes.map(function (f) { return { tipo: f.tipo, comida: f.comida, x: f.x, y: f.y, regiao: f.regiao, vazio: !!f.vazio }; });
    },
    comitiva: function () {
      return animais.filter(function (a) { return a.seguindo; }).map(function (a) { return a.ref; });
    },
    faiscas: faiscas, comemorar: comemorar, textoFlutuante: textoFlutuante,
    atualizarRegioes: atualizarRegioes, trocarPersonagem: trocarPersonagem,
    criarAnimais: criarAnimais, jogadorMundo: jogadorMundo, temAlvo: temAlvo, alvoAtual: alvoAtual,
    posicaoJogadorTela: posicaoJogadorTela, redimensionar: redimensionar,
    animaisNoMundo: animaisNoMundo, teleportar: teleportar
  };
})();
