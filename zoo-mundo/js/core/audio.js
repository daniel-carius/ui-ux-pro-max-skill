/* ==========================================================================
   ZOO MUNDO - Gerenciador de audio
   Arquitetura pronta para arquivos de som: basta registrar uma URL em
   ZM.Audio.registrar('descoberta', 'assets/audio/descoberta.mp3').
   Enquanto nao houver arquivo, um som sintetizado (WebAudio) e tocado.
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Audio = (function () {
  'use strict';

  var ctx = null;
  var ligado = true;
  var volumeMaster = 0.35;
  var arquivos = {};   // nome -> HTMLAudioElement
  var buffers = {};

  /* Sons sintetizados: nome -> lista de notas {freq, tipo, dur, delay, vol, sweep} */
  var SINTESE = {
    ui:          [{ f: 520, t: 'sine',     d: 0.07, v: 0.5 }],
    passo:       [{ f: 140, t: 'triangle', d: 0.05, v: 0.18 }],
    encontro:    [{ f: 660, t: 'sine', d: 0.10, v: 0.5 }, { f: 880, t: 'sine', d: 0.14, v: 0.5, delay: 0.09 }],
    correto:     [{ f: 523, t: 'sine', d: 0.10, v: 0.5 }, { f: 659, t: 'sine', d: 0.10, v: 0.5, delay: 0.09 }, { f: 784, t: 'sine', d: 0.20, v: 0.5, delay: 0.18 }],
    quase:       [{ f: 392, t: 'sine', d: 0.12, v: 0.4 }, { f: 349, t: 'sine', d: 0.16, v: 0.4, delay: 0.10 }],
    descoberta:  [{ f: 659, t: 'triangle', d: 0.10, v: 0.5 }, { f: 880, t: 'triangle', d: 0.10, v: 0.5, delay: 0.10 }, { f: 1174, t: 'triangle', d: 0.26, v: 0.45, delay: 0.20 }],
    casa:        [{ f: 440, t: 'sine', d: 0.12, v: 0.45 }, { f: 587, t: 'sine', d: 0.12, v: 0.45, delay: 0.11 }, { f: 880, t: 'sine', d: 0.28, v: 0.4, delay: 0.22 }],
    desbloqueio: [{ f: 392, t: 'square', d: 0.12, v: 0.3 }, { f: 523, t: 'square', d: 0.12, v: 0.3, delay: 0.12 }, { f: 659, t: 'square', d: 0.12, v: 0.3, delay: 0.24 }, { f: 1046, t: 'square', d: 0.45, v: 0.3, delay: 0.36 }],
    carimbo:     [{ f: 180, t: 'square', d: 0.09, v: 0.4 }, { f: 90, t: 'square', d: 0.18, v: 0.4, delay: 0.06 }],
    /* vozes dos animais (placeholders alegres, um por animal) */
    rugido:      [{ f: 150, t: 'sawtooth', d: 0.42, v: 0.35, sweep: 70 }],
    trombeta:    [{ f: 300, t: 'sawtooth', d: 0.32, v: 0.28, sweep: 560 }],
    sopro:       [{ f: 420, t: 'triangle', d: 0.22, v: 0.25, sweep: 320 }],
    relincho:    [{ f: 500, t: 'sawtooth', d: 0.10, v: 0.22 }, { f: 380, t: 'sawtooth', d: 0.16, v: 0.22, delay: 0.10 }],
    bufo:        [{ f: 110, t: 'square', d: 0.24, v: 0.3, sweep: 80 }],
    bocejo:      [{ f: 200, t: 'sine', d: 0.36, v: 0.3, sweep: 130 }],
    pulo:        [{ f: 320, t: 'sine', d: 0.14, v: 0.3, sweep: 720 }],
    ronco:       [{ f: 130, t: 'triangle', d: 0.34, v: 0.25, sweep: 100 }],
    fungada:     [{ f: 260, t: 'triangle', d: 0.14, v: 0.25 }, { f: 210, t: 'triangle', d: 0.14, v: 0.25, delay: 0.12 }],
    tambor:      [{ f: 90, t: 'sine', d: 0.18, v: 0.4 }, { f: 80, t: 'sine', d: 0.20, v: 0.35, delay: 0.16 }],
    grunhido:    [{ f: 240, t: 'sawtooth', d: 0.20, v: 0.22, sweep: 140 }],
    agua:        [{ f: 700, t: 'sine', d: 0.16, v: 0.25, sweep: 1300 }]
  };

  function garantirContexto() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tocarNota(n, quando) {
    var c = garantirContexto();
    if (!c) return;
    var osc = c.createOscillator();
    var gain = c.createGain();
    var t0 = quando + (n.delay || 0);
    var dur = n.d || 0.15;
    osc.type = n.t || 'sine';
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, n.sweep), t0 + dur);
    var vol = (n.v === undefined ? 0.4 : n.v) * volumeMaster;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /* API publica -------------------------------------------------------- */
  function registrar(nome, url) { arquivos[nome] = url; }

  function tocar(nome) {
    if (!ligado || !nome) return;
    if (arquivos[nome]) {                       // som em arquivo, quando existir
      try {
        var el = buffers[nome] || (buffers[nome] = new Audio(arquivos[nome]));
        el.currentTime = 0; el.volume = volumeMaster * 2;
        var p = el.play(); if (p && p.catch) p.catch(function () {});
        return;
      } catch (e) { /* cai para sintese */ }
    }
    var notas = SINTESE[nome];
    if (!notas) return;
    var c = garantirContexto();
    if (!c) return;
    var agora = c.currentTime + 0.01;
    for (var i = 0; i < notas.length; i++) tocarNota(notas[i], agora);
  }

  function alternar() { ligado = !ligado; if (ligado) tocar('ui'); return ligado; }
  function estaLigado() { return ligado; }
  function definirLigado(v) { ligado = !!v; }
  function despertar() { garantirContexto(); }

  return {
    registrar: registrar, tocar: tocar, alternar: alternar,
    estaLigado: estaLigado, definirLigado: definirLigado, despertar: despertar
  };
})();
