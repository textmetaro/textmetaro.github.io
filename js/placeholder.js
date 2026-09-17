/* placeholder.js — generates tarot-card style placeholder images on a <canvas>
 * so the app is fully playable before real photos exist.
 *
 * Drop a real photo at images/{id}.jpg (or .png) and it overrides the
 * placeholder automatically — see Img.resolveSrc().
 */
(function () {
  "use strict";

  const cache = new Map(); // key `${id}@${w}x${h}` -> dataURL

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx, entry, w, h) {
    const hue = entry.hue || 260;
    // background gradient
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue}, 55%, 24%)`);
    g.addColorStop(1, `hsl(${(hue + 40) % 360}, 60%, 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // subtle starfield
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    let seed = 0;
    for (let i = 0; i < entry.id.length; i++) seed += entry.id.charCodeAt(i);
    let rnd = seed * 9301 + 49297;
    function r() { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; }
    const stars = Math.round((w * h) / 4200);
    for (let i = 0; i < stars; i++) {
      const sx = r() * w, sy = r() * h, sr = r() * (w / 300) + 0.3;
      ctx.globalAlpha = 0.15 + r() * 0.5;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ornate border
    const pad = Math.round(w * 0.06);
    ctx.strokeStyle = `hsla(${(hue + 30) % 360}, 70%, 78%, 0.9)`;
    ctx.lineWidth = Math.max(1.5, w * 0.008);
    roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, w * 0.05);
    ctx.stroke();
    ctx.strokeStyle = `hsla(${(hue + 30) % 360}, 70%, 78%, 0.35)`;
    ctx.lineWidth = Math.max(1, w * 0.004);
    roundRect(ctx, pad * 1.5, pad * 1.5, w - pad * 3, h - pad * 3, w * 0.04);
    ctx.stroke();

    // big emoji symbol
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(w * 0.34)}px "Apple Color Emoji","Segoe UI Emoji",serif`;
    ctx.fillText(entry.emoji || "✦", w / 2, h * 0.44);

    // (no text — image-only aesthetic; placeholder is just a fallback)
  }

  function dataURL(entry, w, h) {
    w = w || 600; h = h || 900;
    const key = entry.id + "@" + w + "x" + h;
    if (cache.has(key)) return cache.get(key);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    draw(ctx, entry, w, h);
    const url = c.toDataURL("image/png");
    cache.set(key, url);
    return url;
  }

  // Draw to a canvas at export resolution, preferring a real loaded photo.
  // realImg: an HTMLImageElement that finished loading, or null.
  function exportCanvas(entry, realImg, w, h) {
    w = w || 900; h = h || 1350;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (realImg && realImg.naturalWidth > 0) {
      // cover-fit the real photo
      const ir = realImg.naturalWidth / realImg.naturalHeight;
      const cr = w / h;
      let dw, dh, dx, dy;
      if (ir > cr) { dh = h; dw = h * ir; dx = (w - dw) / 2; dy = 0; }
      else { dw = w; dh = w / ir; dx = 0; dy = (h - dh) / 2; }
      ctx.drawImage(realImg, dx, dy, dw, dh);
    } else {
      draw(ctx, entry, w, h);
    }
    return c;
  }

  window.Placeholder = { dataURL: dataURL, exportCanvas: exportCanvas };
})();
