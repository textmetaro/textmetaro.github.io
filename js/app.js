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
    "1. 원하는 내용을 문자로 보내주세요.\n" +
    "2. 문자 내용에 따라서 다른 타로의 셀카를 받아요.\n" +
    "3. 도감에서 144장을 모을 수 있어요! (다 모으라고 만든건 아니지만...🤔)";

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

  function setTheme(color) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", color);
  }
  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle("active", k === name);
    });
    // keep the browser bars white everywhere (in-app browsers read theme-color
    // only once at load and won't switch, so a per-screen navy would stick)
    setTheme("#ffffff");
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

  // YouTube: AUTOPLAY MUTED right away (muted autoplay is allowed on mobile
  // without a gesture), then a tap unmutes with sound (a user gesture, so it's
  // allowed). Loops so short fancams keep playing.
  function makeYouTube(videoId, vertical) {
    var wrap = document.createElement("div");
    wrap.className = "bubble in yt playing" + (vertical ? " v" : "");
    var stage = document.createElement("div");
    stage.className = "yt-stage";

    var f = document.createElement("iframe");
    f.src = "https://www.youtube.com/embed/" + videoId +
      "?playsinline=1&rel=0&modestbranding=1&loop=1&playlist=" + videoId +
      "&autoplay=1&mute=1&enablejsapi=1";      // muted autoplay (works on phones)
    f.setAttribute("frameborder", "0");
    f.setAttribute("allowfullscreen", "");
    f.allow = "autoplay; encrypted-media; picture-in-picture; web-share; fullscreen";
    stage.appendChild(f);

    // "탭하여 소리 켜기" hint; tapping unmutes WITHOUT reloading (keeps playing)
    var hint = document.createElement("button");
    hint.type = "button"; hint.className = "yt-unmute";
    hint.innerHTML = "<span>🔇</span> 탭하여 소리 켜기";
    var muted = true;
    var veil = document.createElement("div");
    veil.className = "yt-veil";
    function cmd(func, args) {
      try { f.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*"); } catch (e) {}
    }
    function unmute() {
      if (!muted) return;
      muted = false;
      stage.classList.add("unmuted");
      cmd("unMute"); cmd("setVolume", [100]); cmd("playVideo");  // no reload → no pause
      veil.remove(); hint.remove();    // hand control back to the native player
    }
    veil.addEventListener("click", unmute);
    hint.addEventListener("click", function (e) { e.stopPropagation(); unmute(); });
    stage.appendChild(veil);
    stage.appendChild(hint);

    wrap.appendChild(stage);
    return wrap;
  }

  // ---- render messages (incremental — never rebuilds existing rows, so photos
  // that already loaded stay put and don't flicker) ----
  var _lastTs = 0, _prevSide = null, _firstRow = true;

  function buildRow(msg) {
    var frag = document.createDocumentFragment();
    if (_firstRow || msg.ts - _lastTs > 3600000 || new Date(msg.ts).getDate() !== new Date(_lastTs).getDate()) {
      var sep = document.createElement("div");
      sep.className = "date-sep";
      sep.innerHTML = "<b>" + dayLabel(msg.ts) + "</b> <span class='time'>" + fmtTime(msg.ts) + "</span>";
      frag.appendChild(sep);
      _prevSide = null;
    }
    _firstRow = false;
    _lastTs = msg.ts;

    var side = msg.kind === "user" ? "out" : "in";
    var row = document.createElement("div");
    row.className = "row " + side + (_prevSide !== null && side !== _prevSide ? " turn" : "");
    _prevSide = side;

    if (msg.kind === "user") {
      var b = document.createElement("div");
      b.className = "bubble out";
      b.textContent = msg.text;
      row.appendChild(b);
    } else if (msg.kind === "rtext") {
      var tb = document.createElement("div");
      tb.className = "bubble in" + (msg.intro ? " intro" : "");
      tb.textContent = msg.text;
      row.appendChild(tb);
    } else if (msg.kind === "youtube") {
      row.appendChild(makeYouTube(msg.videoId, msg.vertical));
    } else {
      var entry = byId[msg.imageId];
      if (!entry) return frag; // stale id — skip the row
      var wrap = document.createElement("div");
      wrap.className = "bubble in img";
      var rimg = makeImg(entry);
      rimg.loading = "eager";
      rimg.addEventListener("load", scrollBottomIfPinned);
      wrap.appendChild(rimg);
      if (msg.first) {
        var nb = document.createElement("span");
        nb.className = "new-badge";
        nb.innerHTML = "<img src='assets/new.png' alt='NEW'>";
        wrap.appendChild(nb);
      }
      (function (en) { wrap.addEventListener("click", function () { openViewer(en); }); })(entry);
      row.appendChild(wrap);
    }
    frag.appendChild(row);
    return frag;
  }

  function appendMessage(msg) {
    messagesEl.appendChild(buildRow(msg));
    scrollBottomIfPinned();
    updateBadge();
  }
  function renderAll() {
    messagesEl.innerHTML = "";
    _lastTs = 0; _prevSide = null; _firstRow = true;
    state.messages.forEach(function (m) { messagesEl.appendChild(buildRow(m)); });
    scrollBottomIfPinned();
    updateBadge();
  }

  function scrollBottom() {
    requestAnimationFrame(function () { messagesEl.scrollTop = messagesEl.scrollHeight; });
  }
  // "pinned" = user is at/near the bottom. Reply photos load async and grow the
  // list; we keep pinning to the bottom while pinned, but never yank the user if
  // they've scrolled up to read history.
  var pinned = true;
  messagesEl.addEventListener("scroll", function () {
    pinned = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 160;
  });
  function scrollBottomIfPinned() { if (pinned) scrollBottom(); }

  // ---- send flow ----
  function canSend() { return inputEl.value.trim().length > 0; }
  function syncSend() { sendBtn.disabled = !canSend(); }

  function doSend() {
    var text = inputEl.value.trim();
    if (!text) return;
    Sound.send();
    pinned = true;                    // follow to the bottom for the reply
    var now = Date.now();
    state.messages.push({ kind: "user", text: text, ts: now });
    inputEl.value = "";
    inputEl.style.height = "auto";
    syncSend();
    appendMessage(state.messages[state.messages.length - 1]);
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
      scrollBottomIfPinned();
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
      appendMessage(state.messages[state.messages.length - 1]);

      // fire the "띵" sound exactly when the photo actually appears (not before),
      // then the toast right after — so it doesn't feel out of order.
      var lastRow = messagesEl.lastElementChild;
      var img = lastRow && lastRow.querySelector(".bubble.img img");
      var done = false;
      function onShown() {
        if (done) return; done = true;
        Sound.receive();
        if (isNew) {
          setTimeout(function () { toast("도감에 새 사진이 추가됐어요! 📖"); }, 220);
          maybeComplete();
        }
      }
      if (img && !(img.complete && img.naturalWidth > 0)) {
        img.addEventListener("load", onShown, { once: true });
        img.addEventListener("error", onShown, { once: true });
        setTimeout(onShown, 2500);   // safety net if load/error never fires
      } else {
        onShown();                    // already loaded (cached) → in sync
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
      scrollBottomIfPinned();
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
        appendMessage(state.messages[state.messages.length - 1]);
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
  function closeDex() { dexEl.classList.remove("active"); pinned = true; scrollBottom(); }
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
    viewer.classList.add("active");   // photo only; long-press the image to save
  }
  function closeViewer() { viewer.classList.remove("active"); }

  // dex "공유하기" → open X composer with the post pre-written (n = collected count).
  // The OG image appears via the shared URL's Open Graph card.
  function shareDex() {
    var n = collectedCount();
    var text = "Hello BRIIZE 📞🧡\n타로에게 문자하고 " + n + "장의 셀카를 모았어요!";
    var url = "https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(text) + "&url=" + encodeURIComponent(SHARE_URL);
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
    renderAll();
    // no auto-focus — don't pop the keyboard on entry (avoids the layout jump)
  });
  $("openDex").addEventListener("click", openDex);
  $("closeDex").addEventListener("click", closeDex);
  $("dexShare").addEventListener("click", shareDex);
  $("viewerClose").addEventListener("click", closeViewer);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });

  // ---- keyboard: keep the app fitted to the VISUAL viewport so the header
  // stays put and only the composer rides up with the keyboard (iMessage-like) ----
  (function keyboardFit() {
    var vv = window.visualViewport;
    var app = $("app");
    if (!vv || !app) return;
    var lastH = 0, lastTop = -1;
    function fit() {
      var h = Math.round(vv.height);
      var top = Math.round(vv.offsetTop);   // stays 0 because body is fixed (can't scroll)
      if (h === lastH && top === lastTop) return;
      lastH = h; lastTop = top;
      app.style.height = h + "px";          // header stays at the top; only the bottom shrinks
      app.style.top = top + "px";
      if (screens.chat.classList.contains("active") && pinned) scrollBottom();
    }
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
  })();

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

  setTheme("#ffffff");   // white bars everywhere (initial meta is white too)

  // If returning user already has messages, keep them; splash still shows first.
  renderAll();
  updateBadge();
})();
