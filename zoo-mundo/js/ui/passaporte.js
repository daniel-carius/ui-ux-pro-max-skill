/* ==========================================================================
   ZOO MUNDO - Passaporte do Explorador (progresso por regiao + carimbos)
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Passaporte = (function () {
  'use strict';

  function abrir() {
    montar();
    ZM.Audio.tocar('ui');
    ZM.UI.abrirModal('modal-passaporte');
  }

  function montar() {
    var lista = document.getElementById('passaporte-lista');
    var resumo = document.getElementById('passaporte-resumo');
    lista.innerHTML = '';
    var d = ZM.Estado.get();
    resumo.textContent = '⭐ ' + d.pontos + ' pontos · 🐾 ' + ZM.Estado.totalDescobertos() +
      ' de ' + ZM.Estado.totalAnimais() + ' animais descobertos';

    ZM.REGIONS.forEach(function (r) {
      if (r.id === 'praca') return;                   // a praca e o ponto de encontro
      var moram = ZM.animaisDaRegiao(r.id);
      var p = ZM.Estado.progressoRegiao(r.id);
      var liberada = ZM.Estado.regiaoLiberada(r.id);

      var cartao = document.createElement('div');
      cartao.className = 'cartao-regiao' + (liberada ? '' : ' bloqueada');

      var h = document.createElement('h3');
      h.textContent = r.icone + ' ' + r.nomeCurto;
      cartao.appendChild(h);

      var sub = document.createElement('p');
      sub.textContent = liberada ? r.continente : 'Explore mais para desbloquear esta região.';
      cartao.appendChild(sub);

      if (moram.length) {
        var barra = document.createElement('div');
        barra.className = 'barra';
        var i = document.createElement('i');
        i.style.width = (p.total ? (p.feitos / p.total) * 100 : 0) + '%';
        barra.appendChild(i);
        cartao.appendChild(barra);

        var cont = document.createElement('div');
        cont.className = 'contagem';
        cont.textContent = p.feitos + ' / ' + p.total + ' animais descobertos';
        cartao.appendChild(cont);

        var mini = document.createElement('div');
        mini.className = 'miniaturas';
        moram.forEach(function (a) {
          var achado = ZM.Estado.descoberto(a.id);
          mini.appendChild(ZM.UI.canvasAnimal(a.sprite, 42, { silhueta: !achado, cor: '#cdc2ad', zoom: 0.95 }));
        });
        cartao.appendChild(mini);

        if (p.completa) {
          var carimbo = document.createElement('div');
          carimbo.className = 'carimbo';
          carimbo.textContent = 'REGIÃO COMPLETA';
          cartao.appendChild(carimbo);
        }
      } else {
        var embreve = document.createElement('div');
        embreve.className = 'contagem';
        embreve.textContent = '🔒 Em breve, novos animais!';
        cartao.appendChild(embreve);
      }

      lista.appendChild(cartao);
    });
  }

  return { abrir: abrir, montar: montar };
})();
