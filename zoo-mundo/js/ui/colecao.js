/* ==========================================================================
   ZOO MUNDO - Meu Zoologico: colecao de animais descobertos
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Colecao = (function () {
  'use strict';

  function abrir() {
    montar();
    ZM.Audio.tocar('ui');
    ZM.UI.abrirModal('modal-colecao');
  }

  function montar() {
    var grade = document.getElementById('colecao-grade');
    var resumo = document.getElementById('colecao-resumo');
    var detalhe = document.getElementById('colecao-detalhe');
    grade.innerHTML = '';
    detalhe.classList.add('oculto');
    resumo.textContent = '🐾 ' + ZM.Estado.totalDescobertos() + ' de ' + ZM.Estado.totalAnimais() +
      ' animais · toque em um card para conhecer melhor';

    ZM.ANIMAIS.forEach(function (a) {
      var achado = ZM.Estado.descoberto(a.id);
      var cartao = document.createElement('button');
      cartao.className = 'cartao-animal' + (achado ? '' : ' desconhecido');
      cartao.appendChild(ZM.UI.canvasAnimal(a.sprite, 104, { silhueta: !achado, cor: '#b9ae9a' }));
      var nome = document.createElement('div');
      nome.textContent = achado ? a.nome : '???';
      cartao.appendChild(nome);
      var tag = document.createElement('span');
      tag.className = 'tag-regiao';
      tag.textContent = achado ? ZM.REGION_BY_ID[a.casa].icone + ' ' + ZM.REGION_BY_ID[a.casa].nomeCurto : 'Não descoberto';
      cartao.appendChild(tag);
      if (achado) {
        cartao.onclick = function () { mostrarDetalhe(a); };
      } else {
        cartao.disabled = true;
      }
      grade.appendChild(cartao);
    });
  }

  function mostrarDetalhe(a) {
    ZM.Audio.tocar(a.som);
    var d = document.getElementById('colecao-detalhe');
    d.innerHTML = '';
    d.classList.remove('oculto');

    var topo = document.createElement('div');
    topo.className = 'detalhe-topo';
    topo.appendChild(ZM.UI.canvasAnimal(a.sprite, 120));

    var info = document.createElement('div');
    var h = document.createElement('h3');
    h.textContent = a.nome.toUpperCase() + ' ' + a.emoji;
    info.appendChild(h);

    [['Região', ZM.REGION_BY_ID[a.casa].icone + ' ' + ZM.REGION_BY_ID[a.casa].nomeCurto],
     ['Continente', a.continente],
     ['Habitat', a.habitat],
     ['Alimentação', a.alimentacao]].forEach(function (linha) {
      var l = document.createElement('div');
      l.className = 'ficha-linha';
      l.innerHTML = '<span>' + linha[0] + '</span><span>' + linha[1] + '</span>';
      info.appendChild(l);
    });
    topo.appendChild(info);
    d.appendChild(topo);

    var cur = document.createElement('div');
    cur.className = 'curiosidade';
    cur.style.marginTop = '14px';
    cur.innerHTML = '<b>💡 Curiosidade</b>' + a.curiosidade;
    d.appendChild(cur);

    d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return { abrir: abrir, montar: montar };
})();
