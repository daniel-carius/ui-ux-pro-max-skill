/* ==========================================================================
   ZOO MUNDO - Telas (inicial, escolha de personagem) + HUD + progressao
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Telas = (function () {
  'use strict';

  var escolhido = null;

  function mostrar(id) {
    ZM.UI.$$('.tela').forEach(function (t) { t.classList.remove('ativa'); });
    document.getElementById(id).classList.add('ativa');
    if (id === 'tela-jogo') ZM.Jogo.redimensionar();
  }

  /* ------------------------------ inicio ------------------------------ */
  function iniciar() {
    var d = ZM.Estado.get();
    escolhido = d.personagem || ZM.PERSONAGENS[0].id;
    ZM.Audio.definirLigado(d.som !== false);

    animarTitulo();
    montarPersonagens();

    if (ZM.Estado.temSave()) {
      document.getElementById('btn-continuar').classList.remove('oculto');
      document.getElementById('btn-recomecar').classList.remove('oculto');
      document.getElementById('btn-comecar').textContent = 'NOVA AVENTURA';
    }

    document.getElementById('btn-comecar').onclick = function () {
      ZM.Audio.despertar(); ZM.Audio.tocar('ui');
      mostrar('tela-personagem');
    };

    document.getElementById('btn-continuar').onclick = function () {
      ZM.Audio.despertar(); ZM.Audio.tocar('ui');
      entrarNoJogo();
    };

    document.getElementById('btn-recomecar').onclick = function () {
      if (!confirm('Começar do zero? Todo o progresso salvo será apagado.')) return;
      ZM.Estado.reiniciar();
      ZM.Jogo.criarAnimais();
      ZM.Jogo.atualizarRegioes();
      location.reload();
    };

    document.getElementById('btn-jogar').onclick = function () {
      ZM.Audio.tocar('ui');
      ZM.Estado.definirPersonagem(escolhido);
      ZM.Jogo.trocarPersonagem(escolhido);
      entrarNoJogo();
    };

    document.getElementById('btn-passaporte').onclick = ZM.Passaporte.abrir;
    document.getElementById('btn-colecao').onclick = ZM.Colecao.abrir;

    var btnSom = document.getElementById('btn-som');
    btnSom.textContent = ZM.Audio.estaLigado() ? '🔊' : '🔇';
    btnSom.onclick = function () {
      var ligado = ZM.Audio.alternar();
      btnSom.textContent = ligado ? '🔊' : '🔇';
      ZM.Estado.get().som = ligado;
      ZM.Estado.salvar();
    };

    ZM.UI.$$('[data-fechar]').forEach(function (b) {
      b.onclick = function () {
        ZM.Audio.tocar('ui');
        ZM.UI.fecharModal(b.getAttribute('data-fechar'));
      };
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') ZM.UI.fecharTodos();
      if (document.getElementById('tela-jogo').classList.contains('ativa') && !document.querySelector('.modal.ativo')) {
        if (e.key === 'p' || e.key === 'P') ZM.Passaporte.abrir();
        if (e.key === 'z' || e.key === 'Z') ZM.Colecao.abrir();
      }
    });

    window.addEventListener('beforeunload', function () {
      ZM.Estado.salvar();
    });
  }

  function entrarNoJogo() {
    ZM.Estado.marcarIniciado();
    ZM.Jogo.trocarPersonagem(ZM.Estado.get().personagem);
    mostrar('tela-jogo');
    atualizarHUD();
    atualizarComitiva();
    atualizarMochila();
    ZM.Jogo.comecar();
    // um save antigo pode já ter o bastante para abrir regiões novas
    setTimeout(verificarProgresso, 600);
    var dica = document.getElementById('dica-teclas');
    setTimeout(function () { dica.style.opacity = '0'; }, 7000);
  }

  /* -------------------------- tela de titulo -------------------------- */
  function animarTitulo() {
    var c = document.getElementById('canvas-titulo');
    var ctx = c.getContext('2d');
    var elenco = ['leao', 'canguru', 'elefante', 'coala'];
    var inicio = performance.now();
    (function quadro(agora) {
      var t = (agora - inicio) / 1000;
      ctx.clearRect(0, 0, c.width, c.height);
      elenco.forEach(function (id, i) {
        var x = 90 + i * 155;
        var y = 168 + Math.sin(t * 2 + i) * 5;
        ZM.SpritesAnimais.desenhar(id, ctx, x, y, 0.92, t + i * 2);
      });
      requestAnimationFrame(quadro);
    })(inicio);
  }

  /* ----------------------- escolha de personagem ---------------------- */
  function montarPersonagens() {
    var grade = document.getElementById('grade-personagens');
    grade.innerHTML = '';
    ZM.PERSONAGENS.forEach(function (p) {
      var cartao = document.createElement('button');
      cartao.className = 'cartao-personagem' + (p.id === escolhido ? ' escolhido' : '');
      cartao.appendChild(ZM.UI.canvasPersonagem(p, 118, 'baixo'));
      var nome = document.createElement('div');
      nome.textContent = p.nome;
      cartao.appendChild(nome);
      cartao.onclick = function () {
        escolhido = p.id;
        ZM.Audio.tocar('ui');
        ZM.UI.$$('.cartao-personagem').forEach(function (el) { el.classList.remove('escolhido'); });
        cartao.classList.add('escolhido');
        ZM.Jogo.trocarPersonagem(p.id);
        atualizarHUD();
      };
      grade.appendChild(cartao);
    });
  }

  /* ------------------------------- HUD -------------------------------- */
  function atualizarHUD() {
    var d = ZM.Estado.get();
    document.getElementById('hud-pontos').textContent = d.pontos;
    document.getElementById('hud-animais').textContent =
      ZM.Estado.totalDescobertos() + ' / ' + ZM.Estado.totalAnimais();

    var caixa = document.querySelector('.hud-avatar');
    caixa.innerHTML = '';
    caixa.appendChild(ZM.UI.canvasPersonagem(ZM.PERSONAGEM_BY_ID[d.personagem] || ZM.PERSONAGENS[0], 56, 'baixo'));

    var nivel = ZM.Estado.nivelAtual();
    var elNivel = document.getElementById('hud-nivel');
    if (elNivel) elNivel.textContent = nivel.icone + ' ' + nivel.nome;

    var meta = ZM.Estado.proximaMeta();
    var el = document.getElementById('meta-atual');
    var pedidos = Object.keys(d.pedidos || {}).filter(function (id) { return !ZM.Estado.estaSeguindo(id); });
    if (pedidos.length) {
      var pa = ZM.ANIMAL_BY_ID[pedidos[0]], pc = ZM.COMIDA_BY_ID[d.pedidos[pedidos[0]]];
      el.textContent = '🎯 Leve ' + pc.emoji + ' ' + pc.nome + ' para ' + (pa.artigo === 'a' ? 'a ' : 'o ') + pa.nome +
        (ZM.Estado.temComida(pc.id) ? ' — você já tem!' : ' (' + pc.dica + ')');
    } else if (meta && meta.faltam > 0) {
      el.textContent = '🎯 Descubra mais ' + meta.faltam + (meta.faltam === 1 ? ' animal' : ' animais') +
        ' para abrir: ' + meta.regiao.icone + ' ' + meta.regiao.nomeCurto;
    } else if (ZM.Estado.totalDescobertos() < ZM.Estado.totalAnimais()) {
      el.textContent = '🎯 Ajude todos os animais perdidos a voltarem para casa!';
    } else {
      el.textContent = '🏆 Você descobriu todo o Zoo Mundo! Que explorador!';
    }
  }

  /* Painel dos animais que estão indo para casa com o jogador */
  function atualizarComitiva() {
    var caixa = document.getElementById('comitiva');
    if (!caixa) return;
    var lista = ZM.Jogo.comitiva();
    var d = ZM.Estado.get();
    var pedidos = Object.keys(d.pedidos || {}).filter(function (id) { return !ZM.Estado.estaSeguindo(id); });
    caixa.innerHTML = '';
    if (!lista.length && !pedidos.length) return;

    if (lista.length) {
      var titulo = document.createElement('div');
      titulo.className = 'comitiva-titulo';
      titulo.textContent = lista.length === 1 ? '🏠 Levando para casa' : '🏠 Levando ' + lista.length + ' amigos para casa';
      caixa.appendChild(titulo);
    }

    lista.forEach(function (a) {
      var casa = ZM.REGION_BY_ID[a.casa];
      var aberta = ZM.Estado.regiaoLiberada(a.casa);
      var item = document.createElement('div');
      item.className = 'comitiva-item' + (aberta ? '' : ' fechada');
      item.appendChild(ZM.UI.canvasAnimal(a.sprite, 34, { sombra: false, zoom: 0.95 }));
      var texto = document.createElement('div');
      texto.innerHTML = '<b>' + a.nome + '</b><br><span class="destino">' +
        (aberta ? '→ ' + casa.icone + ' ' + casa.nomeCurto : '🔒 ' + casa.nomeCurto + ' ainda fechada') + '</span>';
      item.appendChild(texto);
      caixa.appendChild(item);
    });

    if (pedidos.length) {
      var t2 = document.createElement('div');
      t2.className = 'comitiva-titulo';
      t2.textContent = '🍽️ Está com fome';
      caixa.appendChild(t2);
      pedidos.forEach(function (id) {
        var a = ZM.ANIMAL_BY_ID[id], co = ZM.COMIDA_BY_ID[d.pedidos[id]];
        if (!a || !co) return;
        var item = document.createElement('div');
        item.className = 'comitiva-item pedido';
        item.appendChild(ZM.UI.canvasAnimal(a.sprite, 34, { sombra: false, zoom: 0.95 }));
        var texto = document.createElement('div');
        texto.innerHTML = '<b>' + a.nome + '</b><br><span class="destino">quer ' + co.emoji + ' ' + co.nome +
          (ZM.Estado.temComida(co.id) ? ' · você tem!' : '') + '</span>';
        item.appendChild(texto);
        caixa.appendChild(item);
      });
    }
  }

  /* Mochila com as comidas colhidas */
  function atualizarMochila() {
    var caixa = document.getElementById('mochila');
    if (!caixa) return;
    var m = ZM.Estado.get().mochila || {};
    var ids = Object.keys(m).filter(function (id) { return m[id] > 0; });
    caixa.innerHTML = '';
    if (!ids.length) return;
    var t = document.createElement('div');
    t.className = 'mochila-titulo';
    t.textContent = '🎒 Mochila';
    caixa.appendChild(t);
    ids.forEach(function (id) {
      var co = ZM.COMIDA_BY_ID[id];
      if (!co) return;
      var item = document.createElement('div');
      item.className = 'mochila-item';
      item.innerHTML = '<span class="emoji">' + co.emoji + '</span><b>' + co.nome + '</b><span>×' + m[id] + '</span>';
      caixa.appendChild(item);
    });
  }

  /* --------------------------- progressao ----------------------------- */
  function verificarProgresso() {
    var novidades = ZM.Estado.verificarProgresso();
    novidades.forEach(function (n) {
      if (n.tipo === 'regiao') {
        ZM.Jogo.atualizarRegioes();
        ZM.UI.aviso({
          icone: n.regiao.icone,
          titulo: 'NOVA REGIÃO DESCOBERTA!',
          texto: n.regiao.nome + ' está aberta. ' + n.regiao.dica,
          botao: 'VAMOS EXPLORAR!',
          som: 'desbloqueio',
          confete: 90
        });
      } else {
        ZM.UI.aviso({
          icone: '🏅',
          titulo: 'REGIÃO COMPLETA!',
          texto: 'Você encontrou todos os animais ' + (n.regiao.prep || 'na') + ' ' + n.regiao.nomeCurto +
            '. Um carimbo novo no seu passaporte!',
          botao: 'VER PASSAPORTE',
          som: 'carimbo',
          confete: 120,
          aoFechar: ZM.Passaporte.abrir
        });
      }
    });
    atualizarHUD();
    atualizarComitiva();
  }

  /* Subiu de nível */
  function subiuDeNivel(nivel) {
    ZM.UI.aviso({
      icone: nivel.icone,
      titulo: 'VOCÊ SUBIU DE NÍVEL!',
      texto: 'Agora você é ' + nivel.nome + '! ' + (nivel.proximo
        ? 'Faltam ' + (nivel.proximo.pontos - ZM.Estado.get().pontos) + ' pontos para ' + nivel.proximo.nome + '.'
        : 'Você chegou ao nível mais alto!'),
      botao: 'UAU!',
      som: 'nivel',
      confete: 80
    });
    atualizarHUD();
  }

  /* Colheu comida / deu comida */
  function colheuComida(comida) {
    atualizarMochila();
    atualizarComitiva();
    atualizarHUD();
  }
  function alimentou(animal, comida) {
    atualizarMochila();
    atualizarComitiva();
    atualizarHUD();
    ZM.UI.mensagem((animal.artigo === 'a' ? 'A ' : 'O ') + animal.nome + ' adorou ' + comida.emoji + ' e agora vai com você!');
    setTimeout(atualizarComitiva, 1000);
  }

  /* Chamado quando um animal chega na região dele */
  function animalEntregue(animal) {
    var casa = ZM.REGION_BY_ID[animal.casa];
    ZM.UI.confete(40);
    atualizarHUD();
    atualizarComitiva();
    ZM.UI.mensagem((animal.artigo === 'a' ? 'A ' : 'O ') + animal.nome + ' chegou em casa! ' +
      casa.icone + ' +50 pontos');
    verificarProgresso();
  }

  return {
    iniciar: iniciar, mostrar: mostrar, atualizarHUD: atualizarHUD,
    verificarProgresso: verificarProgresso, atualizarComitiva: atualizarComitiva,
    atualizarMochila: atualizarMochila, animalEntregue: animalEntregue,
    subiuDeNivel: subiuDeNivel, colheuComida: colheuComida, alimentou: alimentou
  };
})();
