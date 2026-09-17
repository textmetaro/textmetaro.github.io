/* confetti.js — tiny dependency-free canvas confetti burst */
(function () {
  "use strict";
  const defaultColors = ["#e9c979", "#b9a7f2", "#0a7cff", "#ff6ba6", "#5ee0c0", "#ffd93b"];

  function burst(canvas, opts) {
    opts = opts || {};
    const colors = opts.colors || defaultColors;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.classList.add("active"); // make visible BEFORE measuring (display:none → 0 size)
    function size() {
      var p = canvas.parentElement;
      var w = (p && p.clientWidth) || window.innerWidth;
      var h = (p && p.clientHeight) || window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    size();
    const W = canvas.width, H = canvas.height;
    const N = opts.count || 160;
    const parts = [];
    for (let i = 0; i < N; i++) {
      parts.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.3,
        y: H * 0.28 + (Math.random() - 0.5) * 40,
        vx: (Math.random() - 0.5) * 14 * dpr,
        vy: (Math.random() * -10 - 4) * dpr,
        g: (0.25 + Math.random() * 0.2) * dpr,
        s: (5 + Math.random() * 6) * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
      });
    }
    canvas.classList.add("active");
    let frame = 0;
    const maxFrames = opts.duration || 220;

    function tick() {
      ctx.clearRect(0, 0, W, H);
      frame++;
      let alive = false;
      for (const p of parts) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.99;
        p.rot += p.vr;
        const fade = Math.max(0, 1 - frame / maxFrames);
        if (p.y < H + 40 && fade > 0) alive = true;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
        ctx.restore();
      }
      if (alive && frame < maxFrames) {
        requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, W, H);
        canvas.classList.remove("active");
      }
    }
    requestAnimationFrame(tick);
  }

  window.Confetti = { burst: burst };
})();
