/* ==========================================================================
   ZOO MUNDO - Encontro com o animal: quiz, resgate e recompensas
   Fluxo: descobrir -> "Que animal e esse?" -> "De onde ele e?" -> recompensa
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Encontro = (function () {
  'use strict';
  var U = ZM.Utils;

  var PONTOS_ANIMAL = 100;
  var PONTOS_PRIMEIRA = 25;
  /* Os pontos por levar o animal em casa são dados no mapa, quando ele chega lá. */

  var alvo = null, regiaoEncontro = null, ganhos = 0, semErro = true, aoTerminar = null;

  function conteudo() { return document.getElementById('encontro-conteudo'); }

  function abrir(animal, regiaoId, callback) {
    alvo = animal; regiaoEncontro = regiaoId; ganhos = 0; semErro = true;
    aoTerminar = callback || function () {};
    ZM.UI.abrirModal('modal-encontro');
    if (ZM.Estado.descoberto(animal.id)) reencontro();
    else passoNome();
  }

  /* ----------------------------- telas -------------------------------- */
  function palco(altura) {
    var div = document.createElement('div');
    div.className = 'palco-animal';
    div.appendChild(ZM.UI.canvasAnimalAnimado(alvo.sprite, 320, altura || 190));
    div.appendChild(ZM.UI.botaoSom(alvo));
    return div;
  }

  function limpar() { conteudo().innerHTML = ''; }

  function titulo(texto, classe) {
    var h = document.createElement('h2');
    h.className = classe || 'titulo-modal';
    h.textContent = texto;
    return h;
  }

  function pergunta(texto) {
    var p = document.createElement('p');
    p.className = 'pergunta';
    p.textContent = texto;
    return p;
  }

  function caixaOpcoes(opcoes, duas, aoEscolher) {
    var box = document.createElement('div');
    box.className = 'opcoes' + (duas ? ' duas' : '');
    opcoes.forEach(function (op) {
      var b = document.createElement('button');
      b.className = 'opcao';
      b.innerHTML = (op.icone ? '<span>' + op.icone + '</span>' : '') + '<span>' + op.rotulo + '</span>';
      b.onclick = function () { aoEscolher(op, b, box); };
      box.appendChild(b);
    });
    return box;
  }

  /* 1) Que animal e esse? */
  function passoNome() {
    limpar();
    var c = conteudo();
    c.appendChild(titulo('Você encontrou um animal!'));
    c.appendChild(palco());
    c.appendChild(pergunta('Que animal é esse?'));

    var outros = U.shuffle(ZM.ANIMAIS.filter(function (a) { return a.id !== alvo.id; })).slice(0, 2);
    var opcoes = U.shuffle([alvo].concat(outros)).map(function (a) {
      return { rotulo: a.nome, icone: a.emoji, certo: a.id === alvo.id };
    });

    c.appendChild(caixaOpcoes(opcoes, false, function (op, botao, box) {
      if (op.certo) {
        botao.classList.add('certa');
        ZM.Audio.tocar('correto');
        if (semErro) ganhos += PONTOS_PRIMEIRA;
        setTimeout(passoRegiao, 620);
        Array.prototype.forEach.call(box.children, function (b) { b.disabled = true; });
      } else {
        semErro = false;
        botao.classList.add('quase');
        botao.disabled = true;
        ZM.Audio.tocar('quase');
        mensagemRapida(box, 'Quase! Vamos tentar de novo? 😊');
      }
    }));
  }

  /* 2) De qual regiao ele e? */
  function passoRegiao() {
    limpar();
    var c = conteudo();
    var acertouPrimeira = true;
    c.appendChild(titulo('É o ' + artigo(alvo) + alvo.nome + '! ' + alvo.emoji));
    c.appendChild(palco());
    c.appendChild(pergunta('De qual região ele é?'));

    var casa = ZM.REGION_BY_ID[alvo.casa];
    var outras = U.shuffle(ZM.REGIONS.filter(function (r) {
      return r.id !== alvo.casa && r.id !== 'praca';
    })).slice(0, 3);
    var opcoes = U.shuffle([casa].concat(outras)).map(function (r) {
      return { rotulo: r.nomeCurto, icone: r.icone, certo: r.id === alvo.casa };
    });

    c.appendChild(caixaOpcoes(opcoes, true, function (op, botao, box) {
      if (op.certo) {
        botao.classList.add('certa');
        ZM.Audio.tocar('correto');
        if (semErro && acertouPrimeira) ganhos += PONTOS_PRIMEIRA;
        Array.prototype.forEach.call(box.children, function (b) { b.disabled = true; });
        setTimeout(passoResultado, 620);
      } else {
        acertouPrimeira = false; semErro = false;
        botao.classList.add('quase');
        botao.disabled = true;
        ZM.Audio.tocar('quase');
        mensagemRapida(box, 'Quase! Esse animal vive em outro lugar. 🌍');
      }
    }));
  }

  function mensagemRapida(box, texto) {
    var antigo = box.parentNode.querySelector('.feedback.tenta');
    if (antigo) antigo.remove();
    var f = document.createElement('div');
    f.className = 'feedback tenta';
    f.textContent = texto;
    box.parentNode.insertBefore(f, box);
  }

  /* 3) Resultado: descoberta, ficha e (se preciso) resgate */
  function passoResultado() {
    var perdido = regiaoEncontro !== alvo.casa;
    var novo = !ZM.Estado.descoberto(alvo.id);

    limpar();
    var c = conteudo();
    c.appendChild(titulo('Isso mesmo! 🎉'));
    c.appendChild(palco(150));

    var f = document.createElement('div');
    f.className = 'feedback bom';
    f.textContent = 'Isso mesmo! ' + artigoMaiusculo(alvo) + alvo.nome + ' vive ' + preposicao(alvo.casa) + ' ' +
      ZM.REGION_BY_ID[alvo.casa].nomeCurto + '.';
    c.appendChild(f);

    c.appendChild(fichaAnimal());
    c.appendChild(curiosidade());

    if (novo) {
      ganhos += PONTOS_ANIMAL;
      ZM.Estado.descobrir(alvo.id);
      ZM.Audio.tocar('descoberta');
      var pos = ZM.Jogo.jogadorMundo();
      ZM.Jogo.comemorar(pos.x, pos.y);
    }

    if (perdido && ZM.Estado.precisaComer(alvo.id)) {
      var fome = document.createElement('div');
      fome.className = 'feedback perdido';
      fome.textContent = 'Ele está perdido, mas está com fome e não quer sair daí!';
      c.appendChild(fome);
      c.appendChild(recompensas());
      var acoesFome = document.createElement('div');
      acoesFome.className = 'acoes-modal';
      var descobrirComida = document.createElement('button');
      descobrirComida.className = 'btn btn-amarelo';
      descobrirComida.innerHTML = '🍽️ O que ele come?';
      descobrirComida.onclick = passoComida;
      acoesFome.appendChild(descobrirComida);
      var depoisFome = document.createElement('button');
      depoisFome.className = 'btn btn-texto';
      depoisFome.textContent = 'Agora não';
      depoisFome.onclick = encerrar;
      acoesFome.appendChild(depoisFome);
      c.appendChild(acoesFome);
    } else if (perdido) {
      var casaAberta = ZM.Estado.regiaoLiberada(alvo.casa);
      var aviso = document.createElement('div');
      aviso.className = 'feedback perdido';
      aviso.textContent = 'Esse animal está perdido! Vamos ajudá-lo a voltar para casa?';
      c.appendChild(aviso);

      var comoFunciona = document.createElement('p');
      comoFunciona.className = 'instrucao';
      comoFunciona.innerHTML = casaAberta
        ? '🐾 Ele vai andar atrás de você. Leve-o até <b>' + ZM.REGION_BY_ID[alvo.casa].icone + ' ' +
          ZM.REGION_BY_ID[alvo.casa].nomeCurto + '</b> e ele volta para a família dele!'
        : '🐾 Ele vai andar atrás de você. A porta ' + preposicao(alvo.casa) + ' <b>' +
          ZM.REGION_BY_ID[alvo.casa].nomeCurto + '</b> ainda está fechada — ele fica com você até você abrir!';
      c.appendChild(comoFunciona);
      c.appendChild(recompensas());

      var acoes = document.createElement('div');
      acoes.className = 'acoes-modal';
      var levar = document.createElement('button');
      levar.className = 'btn btn-amarelo';
      levar.innerHTML = '🐾 Vamos juntos!';
      levar.onclick = function () {
        ZM.Jogo.chamarParaSeguir(alvo.id);
        encerrar();
      };
      acoes.appendChild(levar);

      var depois = document.createElement('button');
      depois.className = 'btn btn-texto';
      depois.textContent = 'Agora não';
      depois.onclick = encerrar;
      acoes.appendChild(depois);
      c.appendChild(acoes);
    } else {
      c.appendChild(recompensas());
      var acoes2 = document.createElement('div');
      acoes2.className = 'acoes-modal';
      var ok = document.createElement('button');
      ok.className = 'btn';
      ok.textContent = 'CONTINUAR EXPLORANDO';
      ok.onclick = encerrar;
      acoes2.appendChild(ok);
      c.appendChild(acoes2);
    }
  }

  /* 4) Animal tímido: descobrir o que ele come */
  function passoComida() {
    limpar();
    var c = conteudo();
    var acertouPrimeira = true;
    c.appendChild(titulo('Hmm, que fome! ' + alvo.emoji));
    c.appendChild(palco(150));
    c.appendChild(pergunta('O que será que ' + artigo(alvo) + alvo.nome.toLowerCase() + ' come?'));

    var certa = ZM.COMIDA_BY_ID[alvo.comida];
    var outras = U.shuffle(ZM.COMIDAS.filter(function (co) { return co.id !== alvo.comida; })).slice(0, 2);
    var opcoes = U.shuffle([certa].concat(outras)).map(function (co) {
      return { rotulo: co.nome.charAt(0).toUpperCase() + co.nome.slice(1), icone: co.emoji, certo: co.id === alvo.comida };
    });

    c.appendChild(caixaOpcoes(opcoes, false, function (op, botao, box) {
      if (op.certo) {
        botao.classList.add('certa');
        ZM.Audio.tocar('correto');
        if (acertouPrimeira) ganhos += PONTOS_PRIMEIRA;
        Array.prototype.forEach.call(box.children, function (b) { b.disabled = true; });
        ZM.Estado.registrarPedido(alvo.id, alvo.comida);
        setTimeout(passoEntrega, 620);
      } else {
        acertouPrimeira = false; semErro = false;
        botao.classList.add('quase');
        botao.disabled = true;
        ZM.Audio.tocar('quase');
        mensagemRapida(box, 'Quase! Ele não come isso. 😊');
      }
    }));
  }

  /* 5) Tem a comida na mochila? Entrega; senão, vai procurar */
  function passoEntrega() {
    limpar();
    var c = conteudo();
    var comida = ZM.COMIDA_BY_ID[alvo.comida];
    var tem = ZM.Estado.temComida(alvo.comida);
    c.appendChild(titulo(tem ? 'Você tem ' + comida.emoji + '!' : 'Precisamos de ' + comida.emoji + ' ' + comida.nome));
    c.appendChild(palco(150));

    var f = document.createElement('div');
    f.className = 'feedback bom';
    f.textContent = 'Isso mesmo! ' + artigoMaiusculo(alvo) + alvo.nome + ' come ' + comida.nome + ' ' + comida.emoji;
    c.appendChild(f);

    var instrucao = document.createElement('p');
    instrucao.className = 'instrucao';
    instrucao.innerHTML = tem
      ? '🎒 Você já tem ' + comida.emoji + ' na mochila. Dê para ele e ele vai com você!'
      : '🎒 Você ainda não tem ' + comida.nome + '. Procure <b>' + comida.dica + '</b> e volte aqui: é só entregar!';
    c.appendChild(instrucao);
    c.appendChild(recompensas());

    var acoes = document.createElement('div');
    acoes.className = 'acoes-modal';
    var principal = document.createElement('button');
    principal.className = 'btn btn-amarelo';
    principal.innerHTML = tem ? 'Dar ' + comida.emoji + ' ' + comida.nome : 'VOU PROCURAR! 🔍';
    principal.onclick = function () {
      if (tem) ZM.Jogo.alimentar(alvo.id);
      encerrar();
    };
    acoes.appendChild(principal);
    c.appendChild(acoes);
  }

  /* Reencontro com animal ja descoberto */
  function reencontro() {
    limpar();
    var c = conteudo();
    var perdido = regiaoEncontro !== alvo.casa;
    var acompanhando = ZM.Estado.estaSeguindo(alvo.id);
    var casa = ZM.REGION_BY_ID[alvo.casa];

    c.appendChild(titulo(acompanhando
      ? 'Estou com você! ' + alvo.emoji
      : 'Oi de novo, ' + alvo.nome + '! ' + alvo.emoji));
    c.appendChild(palco(160));
    ZM.Audio.tocar(alvo.som);

    if (acompanhando) {
      var rumo = document.createElement('div');
      rumo.className = 'feedback bom';
      rumo.innerHTML = 'Estamos indo para ' + casa.icone + ' <b>' + casa.nomeCurto + '</b>' +
        (ZM.Estado.regiaoLiberada(alvo.casa) ? '.' : ' — assim que a região abrir!');
      c.appendChild(rumo);
    } else {
      c.appendChild(fichaAnimal());
      c.appendChild(curiosidade());
    }

    var acoes = document.createElement('div');
    acoes.className = 'acoes-modal';

    if (acompanhando) {
      var soltar = document.createElement('button');
      soltar.className = 'btn btn-texto';
      soltar.textContent = 'Deixar aqui';
      soltar.onclick = function () {
        ZM.Jogo.deixarAqui(alvo.id);
        encerrar();
      };
      acoes.appendChild(soltar);
    } else if (perdido && ZM.Estado.precisaComer(alvo.id)) {
      var pedido = ZM.Estado.pedidoDe(alvo.id);
      var aviso2 = document.createElement('div');
      aviso2.className = 'feedback perdido';
      if (pedido) {
        var co = ZM.COMIDA_BY_ID[pedido];
        aviso2.innerHTML = 'Ainda estou com fome de ' + co.emoji + ' <b>' + co.nome + '</b>! Procure ' + co.dica + '.';
      } else {
        aviso2.textContent = 'Ele está com fome e não quer sair daí. O que será que ele come?';
      }
      c.insertBefore(aviso2, c.lastChild);
      if (!pedido) {
        var descobrir = document.createElement('button');
        descobrir.className = 'btn btn-amarelo';
        descobrir.innerHTML = '🍽️ O que ele come?';
        descobrir.onclick = passoComida;
        acoes.appendChild(descobrir);
      }
    } else if (perdido) {
      var aviso = document.createElement('div');
      aviso.className = 'feedback perdido';
      aviso.textContent = 'Ele ainda está longe de casa. Vamos juntos?';
      c.insertBefore(aviso, c.lastChild);
      var levar = document.createElement('button');
      levar.className = 'btn btn-amarelo';
      levar.innerHTML = '🐾 Vamos juntos!';
      levar.onclick = function () {
        ZM.Jogo.chamarParaSeguir(alvo.id);
        encerrar();
      };
      acoes.appendChild(levar);
    }

    var ok = document.createElement('button');
    ok.className = 'btn';
    ok.textContent = acompanhando ? 'CONTINUAR' : 'TCHAU!';
    ok.onclick = encerrar;
    acoes.appendChild(ok);
    c.appendChild(acoes);
  }

  /* ----------------------------- blocos ------------------------------- */
  function fichaAnimal() {
    var d = document.createElement('div');
    d.className = 'ficha';
    [['Região', ZM.REGION_BY_ID[alvo.casa].nomeCurto + ' ' + ZM.REGION_BY_ID[alvo.casa].icone],
     ['Continente', alvo.continente],
     ['Habitat', alvo.habitat],
     ['Alimentação', alvo.alimentacao]].forEach(function (linha) {
      var l = document.createElement('div');
      l.className = 'ficha-linha';
      l.innerHTML = '<span>' + linha[0] + '</span><span>' + linha[1] + '</span>';
      d.appendChild(l);
    });
    return d;
  }

  function curiosidade() {
    var d = document.createElement('div');
    d.className = 'curiosidade';
    d.innerHTML = '<b>💡 Você sabia?</b>' + alvo.curiosidade;
    return d;
  }

  function recompensas() {
    var d = document.createElement('div');
    d.className = 'recompensa';
    if (ganhos > 0) {
      var p = document.createElement('div');
      p.className = 'premio';
      p.textContent = '⭐ +' + ganhos + ' pontos';
      d.appendChild(p);
    }
    var a = document.createElement('div');
    a.className = 'premio';
    a.textContent = '🐾 ' + ZM.Estado.totalDescobertos() + ' / ' + ZM.Estado.totalAnimais() + ' animais';
    d.appendChild(a);
    return d;
  }

  /* --------------------------- encerramento --------------------------- */
  function encerrar() {
    ZM.Audio.tocar('ui');
    if (ganhos > 0) {
      ZM.Estado.somarPontos(ganhos);
      var pos = ZM.Jogo.jogadorMundo();
      ZM.Jogo.textoFlutuante(pos.x, pos.y - 80, '+' + ganhos, '#ffd166');
      ganhos = 0;
    }
    ZM.UI.fecharModal('modal-encontro');
    aoTerminar();
  }

  /* ------------------------------ textos ------------------------------ */
  function artigo(a) {
    return (a.artigo || 'o') + ' ';
  }
  function artigoMaiusculo(a) {
    return ((a.artigo || 'o') === 'a' ? 'A' : 'O') + ' ';
  }
  function preposicao(regiaoId) {
    var r = ZM.REGION_BY_ID[regiaoId];
    return (r && r.prep) || 'na';
  }

  return { abrir: abrir };
})();
