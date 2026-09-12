/* ==========================================================================
   ZOO MUNDO - Utilitarios gerais
   ========================================================================== */
window.ZM = window.ZM || {};
ZM.Utils = (function () {
  'use strict';

  /* Gerador de numeros pseudo-aleatorios com semente (mapa sempre igual) */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function shuffle(arr, rand) {
    var r = rand || Math.random, a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pick(arr, rand) { return arr[Math.floor((rand || Math.random)() * arr.length)]; }

  /* Cores -------------------------------------------------------------- */
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function shade(hex, amount) {
    var c = hexToRgb(hex);
    var f = amount < 0 ? 0 : 255, p = Math.abs(amount);
    return 'rgb(' + Math.round(lerp(c.r, f, p)) + ',' + Math.round(lerp(c.g, f, p)) + ',' + Math.round(lerp(c.b, f, p)) + ')';
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  /* Canvas ------------------------------------------------------------- */
  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function ellipse(ctx, x, y, rx, ry, color, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, Math.PI * 2);
    if (color) { ctx.fillStyle = color; ctx.fill(); }
  }
  function circle(ctx, x, y, r, color) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (color) { ctx.fillStyle = color; ctx.fill(); }
  }
  function shadow(ctx, x, y, rx, ry, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 0.18 : alpha;
    ellipse(ctx, x, y, rx, ry, '#1d2a12');
    ctx.restore();
  }

  /* Colisao circulo x retangulo (resolve empurrando para fora) ---------- */
  function circleRectOverlap(cx, cy, r, rect) {
    var nx = clamp(cx, rect.x, rect.x + rect.w);
    var ny = clamp(cy, rect.y, rect.y + rect.h);
    return dist2(cx, cy, nx, ny) < r * r;
  }

  return {
    rng: rng, clamp: clamp, lerp: lerp, dist: dist, dist2: dist2,
    shuffle: shuffle, pick: pick, hexToRgb: hexToRgb, shade: shade, rgba: rgba,
    roundRect: roundRect, ellipse: ellipse, circle: circle, shadow: shadow,
    circleRectOverlap: circleRectOverlap
  };
})();
