/* ==========================================================================
   ZOO MUNDO - Ponto de entrada
   ========================================================================== */
(function () {
  'use strict';

  function boot() {
    ZM.Estado.carregar();

    var canvas = document.getElementById('mapa');
    ZM.Jogo.iniciar(canvas, document.getElementById('minimapa'));

    ZM.Entrada.iniciar(
      canvas,
      document.getElementById('zona-joystick'),
      document.getElementById('joy-base'),
      document.getElementById('joy-topo'),
      document.getElementById('btn-acao')
    );

    // Encontro com animal -> abre o quiz; ao fechar, atualiza HUD e progresso
    ZM.Jogo.aoEncontrarAnimal(function (animal, regiaoId) {
      ZM.Encontro.abrir(animal, regiaoId, function () {
        ZM.Telas.verificarProgresso();
      });
    });

    // animal entregue na região dele
    ZM.Jogo.aoEntregarAnimal(function (animal) {
      ZM.Telas.animalEntregue(animal);
    });

    ZM.Telas.iniciar();
    ZM.Telas.atualizarHUD();

    // destaque do botao de acao quando ha animal por perto
    setInterval(function () {
      var btn = document.getElementById('btn-acao');
      if (!btn) return;
      btn.classList.toggle('destaque', ZM.Jogo.temAlvo() && !ZM.Jogo.estaPausado());
    }, 180);

    // som liberado no primeiro toque (politica dos navegadores)
    ['pointerdown', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, function despertar() {
        ZM.Audio.despertar();
        window.removeEventListener(ev, despertar);
      }, { once: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
