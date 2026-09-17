/* mapping.js — message -> dex image resolver
 *
 * Rules (see README):
 *  1) Same keyword always -> same image (never random)
 *  2) Similar words -> similar image (same group cluster)
 *  3) Novel / infinite input -> deterministic hash so the same text
 *     always returns the same image, and different texts spread across the set
 *
 * This is 100% client-side & deterministic so the deployed static app needs
 * no backend. The "semantic understanding" is approximated by the keyword +
 * group tables in manifest.js. See README for how to upgrade to real
 * embeddings later.
 */
(function () {
  "use strict";

  // --- text normalization -------------------------------------------------
  // lowercase, unicode-normalize, drop whitespace & punctuation, keep
  // Korean syllables + latin + digits. Makes "보고 싶어!" == "보고싶어".
  function normalize(s) {
    return (s || "")
      .toString()
      .normalize("NFC")
      .toLowerCase()
      .replace(/[\s​]+/g, "")
      .replace(/[^0-9a-z가-힣ㄱ-ㅣ]/g, "");
  }

  // stable 32-bit string hash (FNV-1a)
  function hash32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // --- build indexes once -------------------------------------------------
  const DEX = window.DEX || [];
  // keyword -> entry (first owner wins if duplicated). Normalized keys.
  const keywordIndex = new Map();
  // group -> [entries]
  const groupIndex = new Map();

  DEX.forEach(function (entry) {
    (entry.keywords || []).forEach(function (kw) {
      const k = normalize(kw);
      if (k && !keywordIndex.has(k)) keywordIndex.set(k, entry);
    });
    if (!groupIndex.has(entry.group)) groupIndex.set(entry.group, []);
    groupIndex.get(entry.group).push(entry);
  });

  // id -> entry (for length-rule lookups)
  const idIndex = {};
  DEX.forEach(function (e) { idIndex[e.id] = e; });

  // sorted keyword list (longest first) so more specific keywords win
  const keywordList = Array.from(keywordIndex.keys()).sort(function (a, b) {
    return b.length - a.length;
  });

  // length rules: if a message is long enough, return a fixed image regardless
  // of content. Highest satisfied `min` wins. Configured in index.html.
  function lengthMatch(message) {
    const rules = (window.CONFIG && window.CONFIG.lengthRules) || [];
    const len = (message || "").trim().length;
    let best = null;
    for (let i = 0; i < rules.length; i++) {
      if (len >= rules[i].min && idIndex[rules[i].id] && (!best || rules[i].min > best.min)) {
        best = rules[i];
      }
    }
    return best;
  }

  /**
   * resolve(message) -> { entry, matchedKeyword, group, viaFallback }
   */
  function resolve(message) {
    // 0) length reward — highest priority, content-independent
    const lr = lengthMatch(message);
    if (lr) {
      const e = idIndex[lr.id];
      return { entry: e, matchedKeyword: null, group: e.group, viaFallback: false, viaLength: true, lengthMin: lr.min };
    }

    const norm = normalize(message);
    if (!norm) {
      // empty-ish: deterministic pick so it still "works"
      const e = DEX[hash32("∅") % DEX.length];
      return { entry: e, matchedKeyword: null, group: e.group, viaFallback: true };
    }

    // 1) direct keyword ownership. Same keyword => same entry, every time.
    //    Ranking: longer (more specific) keyword wins; on a tie the keyword
    //    that appears EARLIEST in the message wins (closer to the user's intent).
    let best = null, bestLen = 0, bestIdx = Infinity;
    for (let i = 0; i < keywordList.length; i++) {
      const kw = keywordList[i];
      const idx = norm.indexOf(kw);
      if (idx === -1) continue;
      if (kw.length > bestLen || (kw.length === bestLen && idx < bestIdx)) {
        best = keywordIndex.get(kw);
        bestLen = kw.length;
        bestIdx = idx;
      }
      // keywordList is sorted desc by length; once we've locked a length and
      // scanned all keywords of that length we can stop when shorter appears
      if (bestLen > 0 && kw.length < bestLen) break;
    }
    if (best) {
      return {
        entry: best,
        matchedKeyword: best.keywords[0],
        group: best.group,
        viaFallback: false,
      };
    }

    // 2) no exact keyword — deterministic fallback across the whole set.
    //    Same text => same image, spread evenly, no randomness.
    const e = DEX[hash32(norm) % DEX.length];
    return { entry: e, matchedKeyword: null, group: e.group, viaFallback: true };
  }

  window.Mapping = { resolve: resolve, normalize: normalize, hash32: hash32 };
})();
