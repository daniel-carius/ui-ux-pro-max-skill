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
  /* Sons sintetizados.
     Cada nota aceita: f (frequencia), t (onda: sine/square/sawtooth/triangle/ruido),
     d (duracao), v (volume), delay, sweep (frequencia final), vib (vibrato Hz),
     vibAmp (profundidade do vibrato), q (ressonancia do filtro no ruido). */
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
    seguindo:    [{ f: 587, t: 'sine', d: 0.09, v: 0.4 }, { f: 784, t: 'sine', d: 0.14, v: 0.4, delay: 0.08 }],

    /* ---------------------- vozes dos animais ---------------------- */
    /* África */
    rugido:      [{ f: 260, t: 'ruido', d: 0.55, v: 0.55, sweep: 90, q: 7 }, { f: 120, t: 'sawtooth', d: 0.5, v: 0.22, sweep: 70 }],
    trombeta:    [{ f: 320, t: 'sawtooth', d: 0.45, v: 0.28, sweep: 720, vib: 7, vibAmp: 40 }],
    sopro:       [{ f: 500, t: 'ruido', d: 0.3, v: 0.35, sweep: 900, q: 3 }],
    relincho:    [{ f: 620, t: 'sawtooth', d: 0.12, v: 0.22, vib: 22, vibAmp: 60 }, { f: 460, t: 'sawtooth', d: 0.22, v: 0.22, delay: 0.11, sweep: 300, vib: 18, vibAmp: 40 }],
    bufo:        [{ f: 220, t: 'ruido', d: 0.3, v: 0.5, sweep: 70, q: 4 }],
    bocejo:      [{ f: 190, t: 'sawtooth', d: 0.5, v: 0.25, sweep: 320, vib: 5, vibAmp: 20 }],
    /* Oceania */
    pulo:        [{ f: 300, t: 'sine', d: 0.16, v: 0.32, sweep: 880 }, { f: 500, t: 'sine', d: 0.12, v: 0.22, delay: 0.16, sweep: 1200 }],
    ronco:       [{ f: 120, t: 'sawtooth', d: 0.4, v: 0.3, sweep: 90, vib: 9, vibAmp: 22 }],
    fungada:     [{ f: 800, t: 'ruido', d: 0.13, v: 0.4, sweep: 300, q: 2 }, { f: 700, t: 'ruido', d: 0.15, v: 0.35, delay: 0.16, sweep: 260, q: 2 }],
    tambor:      [{ f: 95, t: 'sine', d: 0.2, v: 0.5, sweep: 60 }, { f: 85, t: 'sine', d: 0.22, v: 0.45, delay: 0.19, sweep: 55 }],
    grunhido:    [{ f: 300, t: 'ruido', d: 0.26, v: 0.45, sweep: 130, q: 6 }],
    agua:        [{ f: 900, t: 'sine', d: 0.14, v: 0.3, sweep: 1700 }, { f: 1200, t: 'sine', d: 0.12, v: 0.22, delay: 0.13, sweep: 2200 }],
    /* Brasil */
    rosnado:     [{ f: 200, t: 'ruido', d: 0.45, v: 0.5, sweep: 80, q: 8 }, { f: 90, t: 'sawtooth', d: 0.4, v: 0.2, sweep: 60 }],
    grasnado:    [{ f: 900, t: 'sawtooth', d: 0.2, v: 0.22, sweep: 500, vib: 26, vibAmp: 120 }, { f: 780, t: 'sawtooth', d: 0.22, v: 0.2, delay: 0.24, sweep: 420, vib: 26, vibAmp: 110 }],
    assobio:     [{ f: 1300, t: 'sine', d: 0.13, v: 0.28, sweep: 1900 }, { f: 1500, t: 'sine', d: 0.16, v: 0.26, delay: 0.14, sweep: 1000 }],
    chiado:      [{ f: 1100, t: 'ruido', d: 0.14, v: 0.3, sweep: 700, q: 5 }, { f: 1000, t: 'ruido', d: 0.16, v: 0.28, delay: 0.15, sweep: 600, q: 5 }],
    guincho:     [{ f: 1400, t: 'square', d: 0.09, v: 0.16, sweep: 2100 }, { f: 1700, t: 'square', d: 0.09, v: 0.14, delay: 0.1, sweep: 2400 }, { f: 1500, t: 'square', d: 0.12, v: 0.14, delay: 0.2, sweep: 1900 }],
    /* Ásia */
    mastigada:   [{ f: 400, t: 'ruido', d: 0.1, v: 0.35, sweep: 180, q: 3 }, { f: 380, t: 'ruido', d: 0.1, v: 0.32, delay: 0.14, sweep: 170, q: 3 }, { f: 360, t: 'ruido', d: 0.12, v: 0.3, delay: 0.28, sweep: 160, q: 3 }],
    'rugido-grave': [{ f: 180, t: 'ruido', d: 0.6, v: 0.6, sweep: 60, q: 9 }, { f: 80, t: 'sawtooth', d: 0.55, v: 0.24, sweep: 50 }],
    chilro:      [{ f: 1600, t: 'sine', d: 0.1, v: 0.24, sweep: 2300, vib: 30, vibAmp: 120 }, { f: 1800, t: 'sine', d: 0.1, v: 0.2, delay: 0.12, sweep: 2600 }],
    grito:       [{ f: 420, t: 'sawtooth', d: 0.35, v: 0.24, sweep: 900, vib: 12, vibAmp: 70 }],
    canto:       [{ f: 1000, t: 'sawtooth', d: 0.28, v: 0.2, sweep: 620, vib: 9, vibAmp: 90 }, { f: 900, t: 'sawtooth', d: 0.3, v: 0.18, delay: 0.32, sweep: 560, vib: 9, vibAmp: 80 }],
    resmungo:    [{ f: 240, t: 'sawtooth', d: 0.42, v: 0.26, sweep: 150, vib: 14, vibAmp: 34 }],
    /* Polar */
    'rugido-polar': [{ f: 230, t: 'ruido', d: 0.5, v: 0.5, sweep: 75, q: 6 }, { f: 100, t: 'triangle', d: 0.45, v: 0.24, sweep: 65 }],
    grasno:      [{ f: 700, t: 'square', d: 0.12, v: 0.16, sweep: 380 }, { f: 620, t: 'square', d: 0.14, v: 0.15, delay: 0.15, sweep: 340 }, { f: 560, t: 'square', d: 0.16, v: 0.14, delay: 0.31, sweep: 300 }],
    latido:      [{ f: 500, t: 'ruido', d: 0.12, v: 0.45, sweep: 180, q: 6 }, { f: 460, t: 'ruido', d: 0.14, v: 0.4, delay: 0.18, sweep: 160, q: 6 }],
    'bufo-grave':[{ f: 150, t: 'ruido', d: 0.45, v: 0.55, sweep: 55, q: 5 }],
    ganido:      [{ f: 900, t: 'sawtooth', d: 0.16, v: 0.2, sweep: 1500, vib: 16, vibAmp: 80 }, { f: 1100, t: 'sawtooth', d: 0.16, v: 0.18, delay: 0.17, sweep: 700 }],
    'bufo-rena': [{ f: 300, t: 'ruido', d: 0.28, v: 0.4, sweep: 120, q: 4 }, { f: 200, t: 'triangle', d: 0.2, v: 0.18, delay: 0.3, sweep: 140 }]
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

  var bufferRuido = null;
  function ruidoBranco(c) {
    if (bufferRuido) return bufferRuido;
    var tamanho = c.sampleRate * 2;
    bufferRuido = c.createBuffer(1, tamanho, c.sampleRate);
    var dados = bufferRuido.getChannelData(0);
    for (var i = 0; i < tamanho; i++) dados[i] = Math.random() * 2 - 1;
    return bufferRuido;
  }

  function tocarNota(n, quando) {
    var c = garantirContexto();
    if (!c) return;
    var t0 = quando + (n.delay || 0);
    var dur = n.d || 0.15;
    var vol = (n.v === undefined ? 0.4 : n.v) * volumeMaster;
    var gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.03, dur * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    gain.connect(c.destination);

    if (n.t === 'ruido') {
      // sopros, rugidos e bufos: ruido passando por um filtro que "desce"
      var fonte = c.createBufferSource();
      fonte.buffer = ruidoBranco(c);
      fonte.loop = true;
      var filtro = c.createBiquadFilter();
      filtro.type = 'bandpass';
      filtro.Q.value = n.q || 4;
      filtro.frequency.setValueAtTime(n.f, t0);
      if (n.sweep) filtro.frequency.exponentialRampToValueAtTime(Math.max(40, n.sweep), t0 + dur);
      fonte.connect(filtro); filtro.connect(gain);
      fonte.start(t0); fonte.stop(t0 + dur + 0.05);
      return;
    }

    var osc = c.createOscillator();
    osc.type = n.t || 'sine';
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(30, n.sweep), t0 + dur);
    if (n.vib) {                                   // vibrato: dá vida a pios e uivos
      var lfo = c.createOscillator(), lfoGain = c.createGain();
      lfo.frequency.value = n.vib;
      lfoGain.gain.value = n.vibAmp || 30;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
    osc.connect(gain);
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
