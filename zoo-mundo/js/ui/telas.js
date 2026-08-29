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
    ZM.Jogo.comecar();
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

    var meta = ZM.Estado.proximaMeta();
    var el = document.getElementById('meta-atual');
    if (meta && meta.faltam > 0) {
      el.textContent = '🎯 Descubra mais ' + meta.faltam + (meta.faltam === 1 ? ' animal' : ' animais') +
        ' para abrir: ' + meta.regiao.icone + ' ' + meta.regiao.nomeCurto;
    } else if (ZM.Estado.totalDescobertos() < ZM.Estado.totalAnimais()) {
      el.textContent = '🎯 Ajude todos os animais perdidos a voltarem para casa!';
    } else {
      el.textContent = '🏆 Você descobriu todos os animais! Novas regiões em breve.';
    }
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
  }

  return { iniciar: iniciar, mostrar: mostrar, atualizarHUD: atualizarHUD, verificarProgresso: verificarProgresso };
})();
