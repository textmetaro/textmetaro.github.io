/* app.js — text me orchestration */
(function () {
  "use strict";

  var DEX = window.DEX;
  var TOTAL = DEX.length;           // dex size (derived, not hardcoded)
  var byId = {};
  DEX.forEach(function (e) { byId[e.id] = e; });

  var CONFIG = window.CONFIG || {};
  var USE_REAL_IMAGES = !!CONFIG.useRealImages;
  var IMG_EXT = CONFIG.imageExt || "jpg";

  var INTRO_TEXT =
    "1. 원하는 내용을 작성해서 문자를 보내주세요.\n" +
    "2. 문자 내용에 따라서 다른 타로의 셀카를 받아요.\n" +
    "3. 도감에서 100장을 모을 수 있어요! (다 모으는 사람은 없을 것 같지만...🤔)";

  var STORE_KEY = "textme.v1";
  var SHARE_URL = CONFIG.shareUrl || (location.origin + location.pathname); // deployed URL for X
  var SHARE_TEXT = "text me — 문자를 보내면 답장으로 사진이 와요 🔮 너는 어떤 사진이 올까?";

  // ---- state ----
  var state = load() || { messages: [], collected: {}, flags: {} };

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); }
    catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- dom ----
  var $ = function (id) { return document.getElementById(id); };
  var screens = { splash: $("splash"), chat: $("chat") };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("sendBtn");

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle("active", k === name);
    });
  }

  // ---- splash starfield ----
  (function stars() {
    var cv = document.querySelector("#splash .stars");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    function resize() { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }
    resize();
    window.addEventListener("resize", resize);
    var pts = [];
    for (var i = 0; i < 70; i++) {
      pts.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, p: Math.random() * Math.PI * 2, s: Math.random() * 0.04 + 0.01 });
    }
    (function loop() {
      if (!screens.splash.classList.contains("active")) { requestAnimationFrame(loop); return; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.p += p.s;
        ctx.globalAlpha = 0.4 + Math.sin(p.p) * 0.4;
        ctx.fillStyle = i % 5 === 0 ? "#e9c979" : "#cbb9ff";
        ctx.beginPath();
        ctx.arc(p.x * cv.width, p.y * cv.height, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(loop);
    })();
  })();

  // ---- time helpers ----
  function fmtTime(ts) {
    var d = new Date(ts), h = d.getHours(), m = d.getMinutes();
    var ap = h < 12 ? "오전" : "오후";
    h = h % 12; if (h === 0) h = 12;
    return ap + " " + h + ":" + String(m).padStart(2, "0");
  }
  function dayLabel(ts) {
    var d = new Date(ts), now = new Date();
    var sod = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((sod(now) - sod(d)) / 86400000);
    if (diff === 0) return "오늘";
    if (diff === 1) return "어제";
    var wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + wd + "요일";
  }

  // ---- image element with real->placeholder fallback ----
  function imgSrc(entry) {
    var p = window.PHOTOS && window.PHOTOS[entry.id];
    return p ? p : ("images/" + entry.id + "." + IMG_EXT);
  }
  function makeImg(entry, cls) {
    var img = document.createElement("img");
    if (cls) img.className = cls;
    img.alt = entry.title;
    img.loading = "lazy";
    img.dataset.id = entry.id;
    if (!USE_REAL_IMAGES) {
      // photos not added yet -> use placeholder directly (no failed requests)
      img.dataset.placeholder = "1";
      img.src = Placeholder.dataURL(entry, 380, 570);
      return img;
    }
    img.src = imgSrc(entry); // real photo, falls back to placeholder on error
    img.addEventListener("error", function once() {
      img.removeEventListener("error", once);
      img.dataset.placeholder = "1";
      img.src = Placeholder.dataURL(entry, 380, 570);
    });
    return img;
  }

  // load the YouTube IFrame Player API once (lets us request HD)
  var ytApiPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise(function (resolve, reject) {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (prev) { try { prev(); } catch (e) {} }
        resolve(window.YT);
      };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = function () { reject(new Error("yt api load failed")); };
      document.head.appendChild(s);
      setTimeout(function () {
        if (!(window.YT && window.YT.Player)) reject(new Error("yt api timeout"));
      }, 6000);
    });
    return ytApiPromise;
  }

  // YouTube "lite embed": clean thumbnail; tap → large in-chat player with
  // native controls + a best-effort 1080p request. A bigger player is what
  // actually makes YouTube serve HD (quality can't be forced via URL params).
  function makeYouTube(videoId, vertical) {
    var wrap = document.createElement("div");
    wrap.className = "bubble in yt" + (vertical ? " v" : "");
    var thumb = document.createElement("div");
    thumb.className = "yt-thumb";
    // vertical (Shorts) → try the original-aspect thumb, else hqdefault
    thumb.style.backgroundImage =
      "url(https://i.ytimg.com/vi/" + videoId + (vertical ? "/oardefault.jpg" : "/hqdefault.jpg") + ")," +
      "url(https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg)";
    thumb.innerHTML = "<span class='yt-play'></span><span class='yt-badge'>▶ YouTube</span>";
    wrap.appendChild(thumb);

    function plainFallback(stage) {
      var f = document.createElement("iframe");
      f.src = "https://www.youtube.com/embed/" + videoId +
        "?autoplay=1&playsinline=1&rel=0&vq=hd1080&hd=1";
      f.setAttribute("frameborder", "0");
      f.allow = "autoplay; encrypted-media; picture-in-picture; web-share; fullscreen";
      f.allowFullscreen = true;
      stage.appendChild(f);
    }

    wrap.addEventListener("click", function () {
      wrap.classList.add("playing");           // expand to full chat width → HD
      var stage = document.createElement("div");
      stage.className = "yt-stage";
      var mount = document.createElement("div");
      stage.appendChild(mount);
      // tap-to-hide-UI: veil captures taps in clean mode; corner button toggles
      var veil = document.createElement("div");
      veil.className = "yt-veil";
      var uitog = document.createElement("button");
      uitog.type = "button"; uitog.className = "yt-uitoggle";
      function syncTog() { uitog.textContent = stage.classList.contains("clean") ? "UI 켜기" : "UI 끄기"; }
      syncTog();
      veil.addEventListener("click", function () { stage.classList.remove("clean"); syncTog(); });
      uitog.addEventListener("click", function (e) { e.stopPropagation(); stage.classList.toggle("clean"); syncTog(); });
      stage.appendChild(veil);
      stage.appendChild(uitog);
      wrap.innerHTML = "";
      wrap.appendChild(stage);
      scrollBottomIfNear();

      loadYT().then(function (YT) {
        var forceHD = function (p) { try { p.setPlaybackQuality("hd1080"); } catch (e) {} };
        new YT.Player(mount, {
          width: "100%", height: "100%", videoId: videoId,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: function (e) { forceHD(e.target); try { e.target.playVideo(); } catch (x) {} },
            onPlaybackQualityChange: function (e) { forceHD(e.target); },
          },
        });
      }).catch(function () { plainFallback(stage); });
    }, { once: true });
    return wrap;
  }

  // ---- render messages ----
  function render() {
    messagesEl.innerHTML = "";
    var lastTs = 0;
    var prevSide = null;   // "out"|"in" of previous bubble, for iMessage-like grouping
    state.messages.forEach(function (msg, i) {
      if (i === 0 || msg.ts - lastTs > 3600000 || new Date(msg.ts).getDate() !== new Date(lastTs).getDate()) {
        var sep = document.createElement("div");
        sep.className = "date-sep";
        sep.innerHTML = "<b>" + dayLabel(msg.ts) + "</b> <span class='time'>" + fmtTime(msg.ts) + "</span>";
        messagesEl.appendChild(sep);
        prevSide = null;   // fresh group after a date break
      }
      lastTs = msg.ts;

      var side = msg.kind === "user" ? "out" : "in";
      var row = document.createElement("div");
      row.className = "row " + side + (prevSide !== null && side !== prevSide ? " turn" : "");
      prevSide = side;
      if (msg.kind === "user") {
        var b = document.createElement("div");
        b.className = "bubble out";
        b.textContent = msg.text;
        row.appendChild(b);
        messagesEl.appendChild(row);
      } else if (msg.kind === "rtext") {
        var tb = document.createElement("div");
        tb.className = "bubble in" + (msg.intro ? " intro" : "");
        tb.textContent = msg.text;
        row.appendChild(tb);
        messagesEl.appendChild(row);
      } else if (msg.kind === "youtube") {
        row.appendChild(makeYouTube(msg.videoId, msg.vertical));
        messagesEl.appendChild(row);
      } else {
        var entry = byId[msg.imageId];
        if (!entry) return; // stale id (e.g. dex resized) — skip safely
        var wrap = document.createElement("div");
        wrap.className = "bubble in img";
        var rimg = makeImg(entry);
        rimg.addEventListener("load", scrollBottomIfNear); // pin to newest only if already near bottom
        wrap.appendChild(rimg);
        if (msg.first) {                              // first-discovery → small NEW badge
          var nb = document.createElement("span");
          nb.className = "new-badge";
          nb.innerHTML = "<img src='assets/new.png' alt='NEW'>";
          wrap.appendChild(nb);
        }
        (function (en) { wrap.addEventListener("click", function () { openViewer(en); }); })(entry);
        row.appendChild(wrap);
        messagesEl.appendChild(row);
      }
    });
    scrollBottom();
    updateBadge();
  }

  function scrollBottom() {
    requestAnimationFrame(function () { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }
  // true when the user is already near the bottom (so we don't yank them while
  // they're scrolling up to read history)
  function nearBottom() {
    return (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 140;
  }
  function scrollBottomIfNear() { if (nearBottom()) scrollBottom(); }

  // ---- send flow ----
  function canSend() { return inputEl.value.trim().length > 0; }
  function syncSend() { sendBtn.disabled = !canSend(); }

  function doSend() {
    var text = inputEl.value.trim();
    if (!text) return;
    Sound.send();
    var now = Date.now();
    state.messages.push({ kind: "user", text: text, ts: now });
    inputEl.value = "";
    inputEl.style.height = "auto";
    syncSend();
    render();
    save();

    // special multi-message reply (e.g. "text me") takes priority over photos
    var special = matchSpecial(text);
    if (special) { playSpecial(special.messages.slice()); return; }

    // reply sequence: brief pause → "상대 입력중" indicator → delivered
    var typing = document.createElement("div");
    typing.className = "typing-row";
    typing.innerHTML = "<div class='typing-bubble'><span></span><span></span><span></span></div>";

    var preDelay = 450 + Math.random() * 250;   // before they "start typing"
    var typeDelay = 1100 + Math.random() * 700;  // how long they "type"

    setTimeout(function () {
      messagesEl.appendChild(typing);
      scrollBottom();
    }, preDelay);

    setTimeout(function () {
      typing.remove();
      var res = Mapping.resolve(text);
      var entry = res.entry;
      var ts = Date.now();
      state.messages.push({ kind: "reply", imageId: entry.id, ts: ts });

      // collection (first capture records what summoned it)
      var isNew = !state.collected[entry.id];
      if (isNew) {
        var label = res.viaLength ? (res.lengthMin + "자 이상 ✍️") : text;
        state.collected[entry.id] = { label: label, ts: ts, _new: true };
      }
      // mark this reply as a first-discovery so the chat photo shows a NEW! badge
      state.messages[state.messages.length - 1].first = isNew;
      save();
      render();
      Sound.receive();
      if (isNew) {
        toast("도감에 새 사진이 추가됐어요! 📖");
        maybeComplete();
      }
    }, preDelay + typeDelay);
  }

  // ---- special replies (keyword-triggered multi-message easter eggs) ----
  function looseNorm(s) { return (s || "").toLowerCase().replace(/\s+/g, ""); }
  function matchSpecial(text) {
    var loose = looseNorm(text);
    var rules = CONFIG.specialReplies || [];
    for (var i = 0; i < rules.length; i++) {
      var ms = rules[i].match || [];
      for (var j = 0; j < ms.length; j++) {
        var key = looseNorm(ms[j]);
        if (key && loose.indexOf(key) !== -1) return rules[i];
      }
    }
    return null;
  }
  function makeTyping() {
    var t = document.createElement("div");
    t.className = "typing-row";
    t.innerHTML = "<div class='typing-bubble'><span></span><span></span><span></span></div>";
    return t;
  }
  function playSpecial(queue) {
    function step() {
      if (!queue.length) return;
      var m = queue.shift();
      var typing = makeTyping();
      messagesEl.appendChild(typing);
      scrollBottom();
      setTimeout(function () {
        typing.remove();
        if (m.type === "youtube") {
          var pick = m.pool ? m.pool[Math.floor(Math.random() * m.pool.length)]
                            : { id: m.videoId, vertical: false };
          state.messages.push({ kind: "youtube", videoId: pick.id, vertical: !!pick.vertical, ts: Date.now() });
        } else {
          state.messages.push({ kind: "rtext", text: m.text, ts: Date.now() });
        }
        save();
        render();
        Sound.receive();
        setTimeout(step, 480);
      }, 700 + Math.random() * 450);
    }
    step();
  }

  // ---- toast ----
  var toastEl = $("toast"), toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  // ---- badge ----
  // count only ids that still exist in DEX (guards against a resized dex)
  function collectedCount() {
    var n = 0;
    for (var id in state.collected) if (byId[id]) n++;
    return n;
  }
  // notification badge = number of newly discovered photos not yet seen in dex
  function unseenCount() {
    var n = 0;
    for (var id in state.collected) if (byId[id] && state.collected[id]._new) n++;
    return n;
  }
  function updateBadge() {
    var n = unseenCount();
    var badge = $("dexBadge");
    badge.textContent = n;
    badge.hidden = n === 0;
  }

  // ---- dex ----
  var dexEl = $("dex");
  function openDex() {
    buildDex();                 // shows NEW ribbons for unseen finds
    dexEl.classList.add("active");
    clearNew();                 // seeing the dex clears the notification badge
    updateBadge();
  }
  function closeDex() { dexEl.classList.remove("active"); scrollBottom(); }
  function clearNew() {
    // once viewed, drop NEW markers (badge → 0)
    Object.keys(state.collected).forEach(function (id) { state.collected[id]._new = false; });
    save();
  }
  function sizeDexRows() {
    var grid = $("dexGrid");
    var cs = getComputedStyle(grid);
    var padL = parseFloat(cs.paddingLeft) || 0;
    var padR = parseFloat(cs.paddingRight) || 0;
    var gap = parseFloat(cs.columnGap) || 8;
    var inner = grid.clientWidth - padL - padR;
    var colW = (inner - gap * 2) / 3;
    grid.style.gridAutoRows = Math.round(colW * 1.5) + "px";
  }
  window.addEventListener("resize", function () {
    if (dexEl.classList.contains("active")) sizeDexRows();
  });

  function buildDex() {
    var grid = $("dexGrid");
    grid.innerHTML = "";
    sizeDexRows();
    var n = collectedCount();
    $("dexCount").textContent = n + " / " + TOTAL;
    var pct = Math.round(n / TOTAL * 100);
    $("dexPct").textContent = pct + "%";
    $("dexFill").style.width = pct + "%";
    $("dexSub").textContent = n === 0 ? "모은 사진을 모아봐요" : (TOTAL - n) + "장 남았어요";

    DEX.forEach(function (entry) {
      var col = state.collected[entry.id];
      var cell = document.createElement("div");
      cell.className = "cell " + (col ? "unlocked" : "locked");
      if (col && col._new) cell.className += " new";
      if (col) {
        cell.appendChild(makeImg(entry));   // photo only, no text label
        (function (en) { cell.addEventListener("click", function () { openViewer(en); }); })(entry);
      }
      // locked cells stay empty (no number / no "?")
      grid.appendChild(cell);
    });
  }

  // ---- viewer ----
  var viewer = $("viewer"), viewerImg = $("viewerImg"), currentEntry = null;
  function openViewer(entry) {
    currentEntry = entry;
    viewerImg.onerror = null;
    if (!USE_REAL_IMAGES) {
      viewerImg.dataset.placeholder = "1";
      viewerImg.src = Placeholder.dataURL(entry, 700, 1050);
    } else {
      viewerImg.dataset.placeholder = "";
      viewerImg.src = imgSrc(entry);
      viewerImg.onerror = function () {
        viewerImg.onerror = null;
        viewerImg.dataset.placeholder = "1";
        viewerImg.src = Placeholder.dataURL(entry, 700, 1050);
      };
    }
    $("viewerTitle").textContent = "";   // no text — photo only
    $("viewerKw").textContent = "";
    viewer.classList.add("active");
  }
  function closeViewer() { viewer.classList.remove("active"); }

  // build a Blob of the currently shown image (real photo or placeholder)
  function currentBlob(cb) {
    var entry = currentEntry;
    var real = viewerImg.dataset.placeholder === "1" ? null : viewerImg;
    var canvas = Placeholder.exportCanvas(entry, real, 900, 1350);
    canvas.toBlob(function (blob) { cb(blob); }, "image/png");
  }

  function downloadPhoto() {
    currentBlob(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "textme_" + currentEntry.id + ".png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast("사진을 저장했어요 ⤓");
    });
  }

  function sharePhoto() {
    currentBlob(function (blob) {
      var file = new File([blob], "textme_" + currentEntry.id + ".png", { type: "image/png" });
      var data = {
        title: "text me",
        text: SHARE_TEXT + "\n" + SHARE_URL,
        files: [file],
      };
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share(data).catch(function () {});
      } else if (navigator.share) {
        navigator.share({ title: "text me", text: SHARE_TEXT, url: SHARE_URL }).catch(function () {});
      } else {
        shareToX();
      }
    });
  }

  function shareToX() {
    var url = "https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(SHARE_TEXT) + "&url=" + encodeURIComponent(SHARE_URL);
    window.open(url, "_blank", "noopener");
  }

  // ---- overlay popups ----
  var overlay = $("overlay"), overlayCard = $("overlayCard");
  function closeOverlay() { overlay.classList.remove("active"); }

  function showGuide() {
    overlayCard.innerHTML =
      '<div class="tarot-emoji">🔮</div>' +
      '<h2>어서와, 낯선 손님</h2>' +
      '<ul class="guide-list">' +
        '<li><span class="g-emoji">✍️</span><span>하고 싶은 말을 적어서 <b class="hi">문자를 보내보세요.</b></span></li>' +
        '<li><span class="g-emoji">📷</span><span>답장으로 <b class="hi">사진</b>이 도착합니다.</span></li>' +
        '<li><span class="g-emoji">🃏</span><span>보내는 말에 따라 <b class="hi">다른 사진</b>이 도착해요!</span></li>' +
        '<li><span class="g-emoji">📖</span><span>' + TOTAL + '장 도감을 다 모으는 사람이 있을까….</span></li>' +
      '</ul>' +
      '<button class="btn-primary" id="guideOk">시작하기</button>' +
      '<div class="foot">보낸 문자는 이 브라우저에 계속 저장돼요</div>';
    overlay.classList.add("active");
    $("guideOk").addEventListener("click", function () {
      state.flags.guideSeen = true; save();
      closeOverlay();
      inputEl.focus();
    });
  }

  function maybeComplete() {
    if (collectedCount() >= TOTAL && !state.flags.completeSeen) {
      state.flags.completeSeen = true; save();
      setTimeout(showComplete, 500);
    }
  }
  // completion: just blue+purple confetti (no text / no popup)
  function showComplete() {
    Confetti.burst($("confetti"), {
      count: 260,
      colors: ["#4f7bff", "#6f8cff", "#8f7bff", "#a879ff", "#c0a0ff", "#3a6bff"],
    });
    Sound.celebrate();
  }

  // ---- input: typing sound + haptic + autogrow ----
  // TickTock-style key categorization: delete / modifier / click (else silent)
  function keyKind(k) {
    if (!k) return null;
    if (k === "Backspace" || k === "Delete") return "delete";
    if (k === "Enter" || k === " " || k === "Spacebar" || k === "Shift") return "modifier";
    if (k.length === 1) return "click";                    // printable char
    if (k === "Process" || k === "Unidentified" || k === "Dead") return "click"; // IME/한글 조합
    return null;                                            // Ctrl/Alt/Meta/arrows/F-keys…
  }
  inputEl.addEventListener("keydown", function (e) {
    var kind = keyKind(e.key);
    if (kind) Sound.key(kind);
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      doSend();
    }
  });
  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
    syncSend();
  });

  sendBtn.addEventListener("click", doSend);

  // ---- wire buttons ----
  $("startBtn").addEventListener("click", function () {
    Sound.unlock();
    show("chat");
    // first entry: drop a welcome/guide message already in the thread (once)
    if (!state.flags.introShown) {
      state.messages.push({ kind: "rtext", text: INTRO_TEXT, ts: Date.now(), intro: true });
      state.flags.introShown = true;
      save();
    }
    render();
    inputEl.focus();
  });
  $("openDex").addEventListener("click", openDex);
  $("closeDex").addEventListener("click", closeDex);
  $("viewerClose").addEventListener("click", closeViewer);
  $("downloadBtn").addEventListener("click", downloadPhoto);
  $("shareBtn").addEventListener("click", sharePhoto);
  $("xShareBtn").addEventListener("click", shareToX);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });

  // ---- contact profile photo (nav avatar) ----
  (function setAvatar() {
    var a = $("navAvatar");
    if (a && CONFIG.avatar) {
      a.textContent = "";
      a.classList.add("has-img");
      a.style.backgroundImage = "url('" + encodeURI(CONFIG.avatar) + "')";
    }
  })();

  // ---- boot ----
  // refresh any already-saved intro message to the latest wording
  (function migrateIntro() {
    var changed = false;
    state.messages.forEach(function (m) {
      if (m.intro && m.text !== INTRO_TEXT) { m.text = INTRO_TEXT; changed = true; }
    });
    if (changed) save();
  })();

  // If returning user already has messages, keep them; splash still shows first.
  render();
  updateBadge();
})();
