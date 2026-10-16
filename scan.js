// MileMark "Scan odometer": reads the digits on this device with an offline OCR engine (tesseract.js, bundled in /ocr).
// Nothing is uploaded; there are no network calls other than loading the bundled files from this site.
(() => {
  const DIR = "ocr/", abs = p => new URL(p, document.baseURI).href;
  let wp = null, curParams = "";

  // ---------- engine ----------
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src)); document.head.appendChild(s); }); }
  function engine() {
    if (!wp) wp = (async () => {
      if (!window.Tesseract) await loadScript(DIR + "tesseract.min.js");
      return Tesseract.createWorker("eng", 1, { workerPath: abs(DIR + "worker.min.js"), corePath: abs(DIR), langPath: abs(DIR), workerBlobURL: false, cacheMethod: "none", gzip: true });
    })().catch(e => { wp = null; throw e; });
    return wp;
  }
  async function setP(w, p) { const k = JSON.stringify(p); if (k !== curParams) { await w.setParameters(p); curParams = k; } }
  const DIGITS = { tessedit_char_whitelist: "0123456789.", user_defined_dpi: "300" };
  const ANY = { tessedit_char_whitelist: "", user_defined_dpi: "300" };
  async function ocr(w, canvas, psm, wl) { await setP(w, { ...(wl ? DIGITS : ANY), tessedit_pageseg_mode: String(psm) }); return (await w.recognize(canvas)).data; }

  // Download the engine in the background so it also works offline later (the service worker keeps the files).
  async function warm() {
    try {
      const c = navigator.connection || {}; if (c.saveData || c.type === "cellular" || /^(slow-2g|2g|3g)$/.test(c.effectiveType || "")) return false;
      const simd = await simdOk();
      const list = ["tesseract.min.js", "worker.min.js", simd ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js", "eng.traineddata.gz"];
      await Promise.all(list.map(f => fetch(DIR + f).then(r => r.arrayBuffer())));
      return true;
    } catch (e) { return false; }
  }
  const simdOk = async () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } };

  // ---------- image preprocessing ----------
  async function decode(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { try { return await createImageBitmap(blob); } catch (e2) {} } }
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
  }
  function toCanvas(src, maxSide, minSide) {
    let w = src.width, h = src.height, k = Math.min(1, maxSide / Math.max(w, h)); if (Math.min(w, h) * k < minSide) k = Math.min(minSide / Math.min(w, h), 2.5);
    const c = document.createElement("canvas"); c.width = Math.max(8, Math.round(w * k)); c.height = Math.max(8, Math.round(h * k));
    const x = c.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height); return c;
  }
  function gray(c) {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return g;
  }
  function boxBlur(g, w, h, r) { // separable running-sum blur
    const t = new Float32Array(g.length), o = new Float32Array(g.length), n = 2 * r + 1;
    for (let y = 0; y < h; y++) { let s = 0, b = y * w; for (let x = -r; x <= r; x++) s += g[b + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { t[b + x] = s / n; s += g[b + Math.min(w - 1, x + r + 1)] - g[b + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { o[y * w + x] = s / n; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
    return o;
  }
  function pct(a, p) { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
  // Flatten uneven lighting/glare (subtract the local average), stretch contrast, optionally invert or threshold.
  function flatV(c) {
    const w = c.width, h = c.height, g = gray(c), bg = boxBlur(g, w, h, Math.max(12, Math.round(Math.max(w, h) / 12))), d = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) d[i] = g[i] - bg[i];
    const lo = pct(d, 0.01), hi = pct(d, 0.99), sc = 255 / Math.max(20, hi - lo), v = new Float32Array(g.length);
    for (let i = 0; i < v.length; i++) v[i] = Math.max(0, Math.min(255, (d[i] - lo) * sc)); return { v, w, h };
  }
  function prep(c, mode) {
    let { v, w, h } = flatV(c); const out = document.createElement("canvas"); out.width = w; out.height = h;
    const x = out.getContext("2d", { willReadFrequently: true }), im = x.createImageData(w, h), p = im.data;
    if (mode.inv) for (let i = 0; i < v.length; i++) v[i] = 255 - v[i];
    if (mode.bin) { const th = otsu(v); for (let i = 0; i < v.length; i++) v[i] = v[i] > th ? 255 : 0; }
    if (mode.fuse) v = fuse(v, w, h, mode.fuse);
    for (let i = 0, j = 0; j < v.length; i += 4, j++) { p[i] = p[i + 1] = p[i + 2] = v[j]; p[i + 3] = 255; }
    x.putImageData(im, 0, 0); return out;
  }
  function otsu(v) { const hist = new Array(256).fill(0); for (let i = 0; i < v.length; i++) hist[v[i] | 0]++; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sb = 0, wb = 0, mx = 0, th = 128; for (let i = 0; i < 256; i++) { wb += hist[i]; if (!wb) continue; const wf = v.length - wb; if (!wf) break; sb += i * hist[i]; const mb = sb / wb, mf = (sum - sb) / wf, b = wb * wf * (mb - mf) ** 2; if (b > mx) { mx = b; th = i; } } return th; }
  // Seven-segment digits are made of separate bars; a small grey-level "erode" on a light background (darken-neighbourhood) joins them into solid strokes.
  function fuse(v, w, h, r) { const t = new Float32Array(v.length), o = new Float32Array(v.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)); m = Math.min(m, v[y * w + xx]); } t[y * w + x] = m; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 255; for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)); m = Math.min(m, t[yy * w + x]); } o[y * w + x] = m; }
    return o; }
  function rotated(c, deg) {
    if (!deg) return c; const a = deg * Math.PI / 180, w = c.width, h = c.height, s = Math.abs(Math.sin(a)), co = Math.abs(Math.cos(a)), W = Math.round(w * co + h * s), H = Math.round(w * s + h * co);
    const o = document.createElement("canvas"); o.width = W; o.height = H; const x = o.getContext("2d"); x.fillStyle = "#808080"; x.fillRect(0, 0, W, H);
    x.translate(W / 2, H / 2); x.rotate(a); x.drawImage(c, -w / 2, -h / 2); return o;
  }
  function crop(c, b, pad, targetH) {
    const h = b.y1 - b.y0, px = Math.round(h * pad * 1.4), py = Math.round(h * pad), x0 = Math.max(0, b.x0 - px), y0 = Math.max(0, b.y0 - py), x1 = Math.min(c.width, b.x1 + px), y1 = Math.min(c.height, b.y1 + py);
    const k = targetH / Math.max(1, y1 - y0), B = 24, o = document.createElement("canvas"); o.width = Math.round((x1 - x0) * k) + 2 * B; o.height = Math.round((y1 - y0) * k) + 2 * B;
    const x = o.getContext("2d"); x.fillStyle = "#808080"; x.fillRect(0, 0, o.width, o.height); x.imageSmoothingQuality = "high"; x.drawImage(c, x0, y0, x1 - x0, y1 - y0, B, B, (x1 - x0) * k, (y1 - y0) * k);
    return { canvas: o, k, B, x0, y0 };
  }


  // ---------- seven-segment (LCD / LED) reader ----------
  // The OCR engine cannot read seven-segment digits, so these are decoded directly: find digit-sized blobs, line them up,
  // undo the italic slant, and test which of the seven bars are lit.
  const PAT = { "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg" };
  const SEGS = { a: [.25, .75, .035, .085], g: [.25, .75, .465, .535], d: [.25, .75, .915, .965], f: [.03, .17, .14, .43], b: [.83, .97, .14, .43], e: [.03, .17, .57, .86], c: [.83, .97, .57, .86] };
  const ORDER = "abcdefg";
  function labelBlobs(m, w, h) { // 8-connected labelling of a dilated mask
    const lab = new Int32Array(w * h), st = []; let n = 0; const boxes = [null];
    for (let i = 0; i < m.length; i++) { if (!m[i] || lab[i]) continue; n++; let x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0; st.push(i); lab[i] = n;
      while (st.length) { const j = st.pop(), x = j % w, y = (j - x) / w; cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const k = yy * w + xx; if (m[k] && !lab[k]) { lab[k] = n; st.push(k); } } } }
      boxes.push({ x0, y0, x1, y1, cnt }); }
    return { lab, boxes };
  }
  function dilate(m, w, h, rx, ry) { const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
    for (let y = 0; y < h; y++) { let last = -1e9; const b = y * w; for (let x = 0; x < w; x++) { if (m[b + x]) last = x; if (x - last <= rx) t[b + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[b + x]) last = x; if (last - x <= rx) t[b + x] = 1; } }
    for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= ry) o[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= ry) o[y * w + x] = 1; } }
    return o; }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  function segRead(c, inv, adapt) {
    const wc = c.width > 1000 || c.height > 1000 ? toCanvas(c, 1000, 1) : c, { v, w, h } = flatV(wc), vv = inv ? v.map(x => 255 - x) : v, th = otsu(vv);
    const m = new Uint8Array(w * h); let ink = 0;
    if (adapt) { const lm = boxBlur(vv, w, h, Math.max(8, Math.round(Math.max(w, h) * 0.04))); for (let i = 0; i < m.length; i++) if (vv[i] < lm[i] - 28) { m[i] = 1; ink++; } }
    else for (let i = 0; i < m.length; i++) if (vv[i] < th) { m[i] = 1; ink++; }
    if (ink > 0.4 * m.length || ink < 80) return [];
    // decimal points: small square blobs about as wide as a segment is thick. Take them out first so they don't glue onto a digit.
    const dots = [], L0 = labelBlobs(m, w, h); { const th0 = []; for (let id = 1; id < L0.boxes.length; id++) { const b = L0.boxes[id], bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1; if (b.cnt > 30 && Math.max(bw, bh) >= 2.2 * Math.min(bw, bh)) th0.push(Math.min(bw, bh)); }
      const t = th0.length ? med(th0) : 0;
      if (t) for (let id = 1; id < L0.boxes.length; id++) { const b = L0.boxes[id], bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1; if (bw >= 0.6 * t && bh >= 0.6 * t && bw <= 1.8 * t && bh <= 1.8 * t && Math.max(bw, bh) <= 1.5 * Math.min(bw, bh) && b.cnt >= bw * bh * 0.55) { dots.push(b); for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (L0.lab[y * w + x] === id) m[y * w + x] = 0; } } }
    const rx = Math.max(1, Math.round(Math.min(w, h) * 0.006)), ry = Math.max(2, Math.round(Math.min(w, h) * 0.03)), { lab, boxes } = labelBlobs(dilate(m, w, h, rx, ry), w, h);
    // pixel lists of plausible digit blobs (from the un-dilated mask)
    const px = new Map(); for (let id = 1; id < boxes.length; id++) { const b = boxes[id], bh = b.y1 - b.y0 + 1, bw = b.x1 - b.x0 + 1; if (bh >= 14 && bh < h * 0.7 && bw >= 3 && bw <= bh * 1.2 && b.cnt > bh * 2) px.set(id, []); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (m[i]) { const l = px.get(lab[i]); if (l) l.push(x, y); } }
    const comps = [...px.entries()].filter(([id, p]) => p.length > 40).map(([id, p]) => { let x0 = w, y0 = h, x1 = 0, y1 = 0; for (let k = 0; k < p.length; k += 2) { if (p[k] < x0) x0 = p[k]; if (p[k] > x1) x1 = p[k]; if (p[k + 1] < y0) y0 = p[k + 1]; if (p[k + 1] > y1) y1 = p[k + 1]; }
      return { id, p, b: { x0, y0, x1, y1 }, h: y1 - y0 + 1, cy: (y0 + y1) / 2 }; });
    // dots: small square blobs near a baseline
    const lines = [], taken = new Set();
    for (const s of comps.sort((a, b) => b.h - a.h)) { if (taken.has(s)) continue;
      let ln = comps.filter(o => !taken.has(o) && Math.abs(o.h - s.h) < s.h * 0.28 && Math.abs(o.cy - s.cy) < s.h * 0.5); ln.sort((a, b) => a.b.x0 - b.b.x0);
      // keep the chain around the seed with small gaps
      let i0 = ln.indexOf(s), a = i0, b = i0; while (a > 0 && ln[a].b.x0 - ln[a - 1].b.x1 < s.h * 1.1) a--; while (b < ln.length - 1 && ln[b + 1].b.x0 - ln[b].b.x1 < s.h * 1.1) b++;
      ln = ln.slice(a, b + 1); ln.forEach(o => taken.add(o)); if (ln.length >= 4 && ln.length <= 9) lines.push(ln); }
    const out = [];
    for (const ln of lines) {
      const H = med(ln.map(o => o.h)), yc = med(ln.map(o => o.cy));
      // slant: the shear that makes the digits narrowest
      let bs = 0, bw = 1e9; for (let s = -0.06; s <= 0.32; s += 0.02) { let tot = 0; for (const o of ln) { let a = 1e9, b = -1e9; for (let k = 0; k < o.p.length; k += 2) { const x = o.p[k] - s * (yc - o.p[k + 1]); if (x < a) a = x; if (x > b) b = x; } tot += b - a; } if (tot < bw - 1e-6) { bw = tot; bs = s; } }
      const bx = ln.map(o => { let a = 1e9, b = -1e9; for (let k = 0; k < o.p.length; k += 2) { const x = o.p[k] - bs * (yc - o.p[k + 1]); if (x < a) a = x; if (x > b) b = x; } return { a, b, w: b - a }; });
      const tallest = Math.max(...ln.map(o => o.h)), tl = ln.filter(o => o.h >= tallest * 0.9), y0 = Math.min(...tl.map(o => o.b.y0)), y1 = Math.max(...tl.map(o => o.b.y1)), HH = Math.max(8, y1 - y0 + 1), mw = Math.max(...bx.map(q => q.w)), full = bx.filter(q => q.w >= mw * 0.7).map(q => q.w);
      const W = full.length && mw > HH * 0.3 ? med(full) : HH * 0.55;
      let digits = "", dsum = 0, exact = 0, bad = false; const cells = [];
      ln.forEach((o, i) => { const q = bx[i], narrow = q.w < W * 0.65, x0 = narrow ? q.b - W : (q.a + q.b) / 2 - W / 2, dens = {};
        for (const k of ORDER) { const [u0, u1, v0, v1] = SEGS[k]; let on = 0, tot = 0; const nx = 6, ny = 6;
          for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) { const xs = x0 + W * (u0 + (u1 - u0) * (ix + .5) / nx), ys = y0 + HH * (v0 + (v1 - v0) * (iy + .5) / ny), xr = Math.round(xs + bs * (yc - ys)), yr = Math.round(ys);
            tot++; if (xr >= 0 && xr < w && yr >= 0 && yr < h && m[yr * w + xr]) on++; }
          dens[k] = on / tot; }
        let bd = null, bdist = 1e9, second = 1e9; for (const [dg, ps] of Object.entries(PAT)) { let d = 0; for (const k of ORDER) d += (dens[k] - (ps.includes(k) ? 1 : 0)) ** 2; if (d < bdist) { second = bdist; bdist = d; bd = dg; } else if (d < second) second = d; }
        const ex = ORDER.split("").every(k => PAT[bd].includes(k) ? dens[k] > 0.6 : dens[k] < 0.2); if (ex) exact++; if (bdist > 1.6) bad = true;
        digits += bd; dsum += Math.max(0, 1 - bdist / 1.2); cells.push(bd); });
      if (bad) continue;
      // decimal point inside/after the line?
      const xs0 = Math.min(...ln.map(o => o.b.x0)) - 2, xs1 = Math.max(...ln.map(o => o.b.x1)) + H * 0.4, ys = y1 - HH * 0.3;
      const dot = dots.find(b => b.x0 >= xs0 && b.x1 <= xs1 && b.y0 >= ys && b.y1 <= y1 + HH * 0.25);
      let rawDigits = digits, hasDot = false, dotAfter = -1;
      if (dot) { hasDot = true; dotAfter = ln.filter(o => (o.b.x0 + o.b.x1) / 2 < (dot.x0 + dot.x1) / 2).length; }
      const conf = Math.round(100 * (dsum / ln.length) * (0.75 + 0.25 * exact / ln.length));
      const ip = hasDot ? rawDigits.slice(0, dotAfter) : rawDigits, fr = hasDot ? rawDigits.slice(dotAfter) : "";
      const bb = { x0: Math.min(...ln.map(o => o.b.x0)), x1: Math.max(...ln.map(o => o.b.x1)), y0: Math.min(...ln.map(o => o.b.y0)), y1: Math.max(...ln.map(o => o.b.y1)) };
      if (hasDot && !(ip.length >= 5 && fr.length === 1)) continue; // trip meter
      if (ip.length < 4 || ip.length > 7) continue;
      out.push({ digits: ip, conf, b: bb, tag: "seg", tenths: hasDot, seg: true, h: H, exact: exact === ln.length });
      if (!hasDot && ip.length >= 6 && ip.length <= 7) out.push({ digits: ip.slice(0, -1), conf: conf - 3, b: bb, tag: "seg", dropped: true, seg: true, h: H, exact: exact === ln.length });
    }
    out.forEach(o => { o.canvas = prep(wc, { inv }); });
    return out;
  }

  // ---------- candidates ----------
  function groups(words) { // join digit words that sit on the same line with only a small gap (rolling digits are often read as separate words)
    const ws = words.map(w => ({ t: (w.text || "").replace(/[^0-9.]/g, ""), c: w.confidence, b: w.bbox })).filter(w => w.t && w.b.y1 > w.b.y0 && w.b.x1 > w.b.x0);
    ws.sort((a, b) => a.b.x0 - b.b.x0); const used = new Set(), out = [];
    for (const w of ws) { if (used.has(w)) continue; used.add(w); const g = { t: w.t, cs: [w.c], b: { ...w.b }, n: 1 }; let more = true;
      while (more) { more = false; for (const o of ws) { if (used.has(o)) continue; const hh = Math.max(g.b.y1 - g.b.y0, o.b.y1 - o.b.y0), gap = o.b.x0 - g.b.x1, dy = Math.abs((o.b.y0 + o.b.y1) / 2 - (g.b.y0 + g.b.y1) / 2);
        if (gap > -hh * 0.3 && gap < hh * 0.9 && dy < hh * 0.45 && !g.t.includes(".") && !o.t.startsWith(".")) { used.add(o); g.t += o.t; g.cs.push(o.c); g.b = { x0: Math.min(g.b.x0, o.b.x0), y0: Math.min(g.b.y0, o.b.y0), x1: Math.max(g.b.x1, o.b.x1), y1: Math.max(g.b.y1, o.b.y1) }; g.n++; more = true; } } } out.push(g); }
    return out;
  }
  function candsFrom(words, tag) {
    const out = [];
    for (const g of groups(words)) {
      const conf = g.cs.reduce((a, b) => a + b, 0) / g.cs.length, m = g.t.match(/^\.*(\d+)(?:\.(\d*))?\.*$/); if (!m) continue;
      const ip = m[1], fr = m[2];
      if (fr !== undefined && fr.length) { if (!(ip.length >= 5 && fr.length === 1)) continue; /* 4-digit-or-shorter with a decimal is a trip meter */ out.push({ digits: ip, conf, b: g.b, tag, tenths: true }); continue; }
      out.push({ digits: ip, conf, b: g.b, tag });
      // Rolling odometers have a tenths wheel; offer the number without its last digit too.
      if (ip.length >= 6 && ip.length <= 7) out.push({ digits: ip.slice(0, -1), conf: conf - 3, b: g.b, tag, dropped: true });
    }
    return out.filter(c => c.digits.length >= 4 && c.digits.length <= 7);
  }
  const plaus = n => n > 0 && n < 2000000;
  function score(c, est) {
    const n = +c.digits; let s = c.digits.length * 9 + c.conf * 0.35; if (!plaus(n)) s -= 40;
    if (c.digits.length === 7) s -= c.dropped ? 0 : 12; // almost no car has 7 digits; a 7-digit read is usually 6 digits + tenths
    if (c.tenths) s += 2; if (c.cue) s += c.dropped ? 26 : -26;
    if (est > 0) { const d = n - est, tol = Math.max(4000, est * 0.2); if (d >= -1500 && d <= tol) s += 28 - Math.min(14, Math.abs(d) / tol * 14); else if (d < -1500) s -= 14; else s -= 22; }
    return s;
  }

  // A rolling odometer's tenths wheel is usually a different colour from the other wheels.
  function oddLast(base, b, n) {
    if (n < 5 || b.x1 <= b.x0 || b.y1 <= b.y0) return false; const x = base.getContext("2d", { willReadFrequently: true }), cw = (b.x1 - b.x0) / n, ms = [];
    for (let i = 0; i < n; i++) { const d = x.getImageData(Math.max(0, Math.round(b.x0 + i * cw)), Math.max(0, b.y0), Math.max(2, Math.round(cw)), Math.max(2, b.y1 - b.y0)).data; let r = 0, g = 0, bl = 0, c = 0; for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; bl += d[k + 2]; c++; } ms.push([r / c, g / c, bl / c]); }
    const rest = ms.slice(0, -1), mid = [0, 1, 2].map(k => med(rest.map(q => q[k]))), dist = q => Math.hypot(q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]);
    return Math.max(...rest.map(dist)) < 40 && dist(ms[n - 1]) > 60;
  }

  // ---------- main read ----------
  async function read(blob, o = {}) {
    const t0 = performance.now(), dl = t0 + (o.maxMs || 30000), left = () => performance.now() < dl, est = o.est || 0, log = o.debug ? [] : null, step = m => { if (o.onStep) o.onStep(m); };
    const src = await decode(blob), base = toCanvas(src, 1400, 700), all = [], votes = {};
    const vote = cs => { for (const d of new Set(cs.map(c => c.digits))) votes[d] = (votes[d] || 0) + 1; };
    const rank = c => { c.s = score(c, est) + Math.min(24, (votes[c.digits] || 0) * 8) + (c.seg && c.exact ? 6 : 0); return c.s; };
    const best = () => { let b = null; for (const c of all) { if (c.reject) continue; rank(c); if (!b || c.s > b.s) b = c; } return b; };
    const consistent = c => !est || (+c.digits - est >= -1500 && +c.digits - est <= Math.max(4000, est * 0.2));
    step("Reading…");
    // 1) seven-segment reader (fast, no OCR engine needed)
    for (const rot of [0, -5, 5, -10, 10]) { let found = false;
      for (const inv of [0, 1]) { const cs = segRead(rotated(base, rot), inv).map(c => ({ ...c, rot, prepName: "seg" + inv })); all.push(...cs); vote(cs); log && log.push({ seg: inv, rot, found: cs.map(x => x.digits + "@" + x.conf) }); if (cs.some(c => c.exact && c.digits.length >= 5)) found = true; }
      if (found) break; }
    if (!all.some(c => c.seg && c.exact && c.digits.length >= 5)) for (const inv of [0, 1]) { const cs = segRead(base, inv, true).map(c => ({ ...c, rot: 0, prepName: "segad" + inv })); all.push(...cs); vote(cs); log && log.push({ segad: inv, found: cs.map(x => x.digits + "@" + x.conf) }); }
    // small display inside a big frame: look at overlapping zoomed windows too
    if (!all.some(c => c.seg && c.exact && c.digits.length >= 5)) { const ww = Math.round(base.width * 0.5), wh = Math.round(base.height * 0.5);
      outer: for (const fy of [0, .25, .5]) for (const fx of [0, .25, .5]) { const win = document.createElement("canvas"); win.width = ww; win.height = wh;
        win.getContext("2d").drawImage(base, Math.round(base.width * fx), Math.round(base.height * fy), ww, wh, 0, 0, ww, wh);
        for (const inv of [0, 1]) { const cs = segRead(win, inv, true).map(c => ({ ...c, rot: 0, prepName: "segwin" })); all.push(...cs); vote(cs); log && log.push({ win: [fx, fy], inv, found: cs.map(x => x.digits + "@" + x.conf) }); if (cs.some(c => c.exact && c.digits.length >= 5)) break outer; } } }
    let b0 = best(); const strongSeg = b0 && b0.seg && b0.exact && b0.digits.length >= 5 && b0.conf >= 85 && consistent(b0);
    // 2) OCR engine (rolling/printed digits)
    let w = null;
    if (!strongSeg) {
      w = await engine();
      const run = async (name, c, psm, rotDeg) => { const d = await ocr(w, c, psm, true); const cs = candsFrom(d.words || [], name).map(x => ({ ...x, rot: rotDeg, prepName: name, canvas: c }));
        if (rotDeg === 0) { const byB = new Map(); for (const x of cs) byB.set(x.b, Math.max(byB.get(x.b) || 0, x.digits.length + (x.dropped ? 1 : 0))); for (const x of cs) { if (!byB.has(x.b)) continue; if (!byB.cue) byB.cue = new Map(); } const cue = new Map(); for (const [bb, n] of byB) if (n >= 6) { try { cue.set(bb, oddLast(base, bb, n)); } catch (e) {} } for (const x of cs) if (cue.get(x.b)) x.cue = true; }
        all.push(...cs); vote(cs); log && log.push({ name, psm, rot: rotDeg, found: cs.map(x => x.digits + "@" + Math.round(x.conf)) }); return cs; };
      const done = () => { const b = best(); return b && ((b.conf >= 88 && votes[b.digits] >= 1) || (b.conf >= 80 && votes[b.digits] >= 2)) && b.digits.length >= 5 && consistent(b); };
      const A = { name: "flat", inv: 0 }, B = { name: "flat-inv", inv: 1 }, cache = {}, getV = (m, rot) => cache[m.name + rot] || (cache[m.name + rot] = prep(rotated(base, rot), m));
      for (const m of [A, B]) { if (!left()) break; await run(m.name, getV(m, 0), 11, 0); if (done()) break; }
      if (!done() && left()) for (const m of [A, B]) { if (!left()) break; await run(m.name, getV(m, 0), 6, 0); if (done()) break; }
      if (!done() && left()) for (const rot of [-6, 6, -12, 12]) { for (const m of [A, B]) { if (!left()) break; await run(m.name, getV(m, rot), 11, rot); } if (done() || !left()) break; }
      if (!all.some(c => !c.seg) && !all.length && left()) for (const rot of [90, -90]) { for (const m of [A, B]) { if (!left()) break; await run(m.name, getV(m, rot), 11, rot); } if (all.length) break; }
    }
    // 3) check the leading candidates: look for a TRIP label, and re-read OCR digits from a zoomed crop
    let verdict = null;
    for (let tries = 0; tries < 4 && left(); tries++) {
      const b = best(); if (!b) break;
      step("Checking…"); w = w || await engine();
      const bw = b.b.x1 - b.b.x0, bh = b.b.y1 - b.b.y0, wide = crop(b.canvas, { x0: b.b.x0 - bw * 0.9, x1: b.b.x1 + bw * 0.6, y0: b.b.y0 - bh * 0.5, y1: b.b.y1 + bh * 0.5 }, 0.05, 140);
      let txt = ""; try { txt = ((await ocr(w, wide.canvas, 6, false)).text || "").toUpperCase(); } catch (e) {}
      const trip = /TR[I1L]P|TRP\b/.test(txt); log && log.push({ label: b.digits, txt: txt.trim().replace(/\s+/g, " ").slice(0, 60), trip });
      if (trip) { all.filter(c => c.b === b.b).forEach(c => { c.reject = true; c.trip = true; }); continue; }
      if (!b.seg) { try { const z = crop(b.canvas, b.b, 0.35, 120), d = await ocr(w, z.canvas, 7, true), cs = candsFrom(d.words || [], "zoom"); b.zoom = cs.filter(c => c.digits.length >= 4 && c.digits.length <= 7).sort((x, y) => y.digits.length - x.digits.length || y.conf - x.conf)[0] || null; log && log.push({ zoom: b.digits, got: b.zoom && b.zoom.digits + "@" + Math.round(b.zoom.conf) }); } catch (e) {} }
      verdict = b; break;
    }
    if (!verdict && !all.some(c => c.trip)) verdict = best(); // out of time before checking: use the best guess, marked low confidence
    let value = null, conf = "none";
    if (verdict) {
      let d = verdict.digits, c = verdict.conf, agreed = false; const zr = verdict.zoom;
      if (zr) { const zd = verdict.dropped && zr.digits.length > d.length ? zr.digits.slice(0, d.length) : zr.digits;
        if (zd === d) { c = Math.max(c, zr.conf) + 6; agreed = true; } else if (zr.conf > c + 5 && zd.length >= 4 && zd.length <= 7) { d = zd; c = zr.conf - 12; } else c -= 18; }
      value = +d; const cons = est > 0 ? consistent({ digits: d }) : null;
      conf = c >= 80 || (c >= 68 && cons) ? "high" : "low"; if (!verdict.seg && (votes[verdict.digits] || 0) < 2 && !agreed) conf = "low"; if (est > 0 && cons === false) conf = "low"; if (value < 1000 || (value < 10000 && !cons)) conf = "low"; // short reads are often a display with washed-out digits
      if (!left() && !verdict.seg) conf = "low";
    }
    return { value, conf, ms: Math.round(performance.now() - t0), log, trip: all.some(c => c.trip), engine: !!w };
  }


  // ---------- "Scan odometer" screens ----------
  const $q = x => document.querySelector(x), proofs = {}, est_ = v => (v ? window.est(v) : 0);
  window.clearProof = () => { for (const k in proofs) delete proofs[k]; };
  window.takeProof = id => { const p = proofs[id], el = document.getElementById(id); delete proofs[id]; return p && el && +el.value === p.val ? p.blob : null; };
  async function shrink(blob) { try { const bm = await decode(blob), c = toCanvas(bm, 1280, 1); return await new Promise(r => c.toBlob(b => r(b || blob), "image/jpeg", 0.8)); } catch (e) { return blob; } }
  const dlg = $q("#scanDlg");
  if (dlg) {
    let ctx = null, run = 0, thumb = null;
    const pick = () => { const f = $q("#scanFile"); f.value = ""; f.click(); };
    const note = t => { const n = $q("#scanNote"); n.hidden = !t; n.textContent = t || ""; };
    const okVal = () => { const v = $q("#scanVal").value; return v !== "" && +v >= 0 && +v < 10000000; };
    const sync = () => { $q("#scanUse").disabled = dlg.hasAttribute("data-busy") || !okVal(); };
    document.addEventListener("click", e => { const b = e.target.closest("[data-scan]"); if (!b) return; e.preventDefault(); ctx = { field: b.dataset.scan, keep: b.dataset.keep === "1" }; pick(); });
    $q("#scanVal").addEventListener("input", sync);
    $q("#scanRetake").onclick = () => { run++; pick(); };
    $q("#scanCancel").onclick = () => { run++; dlg.close(); };
    dlg.addEventListener("cancel", () => { run++; });
    $q("#scanFile").addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f || !ctx) return; const mine = ++run;
      if (thumb) URL.revokeObjectURL(thumb); thumb = URL.createObjectURL(f); $q("#scanImg").src = thumb;
      $q("#scanVal").value = ""; $q("#scanKeep").checked = ctx.keep; note(""); $q("#scanQ").innerHTML = '<span class="scanspin"></span>Reading…'; dlg.setAttribute("data-busy", ""); sync();
      if (!dlg.open) dlg.showModal();
      let r = null, failed = false;
      try { const est = ctx.field === "fCur" && !$q("#saveVeh").dataset.edit ? 0 : Math.round(est_(veh()));
        r = await read(f, { est, onStep: m => { if (mine === run) $q("#scanQ").innerHTML = '<span class="scanspin"></span>' + m; } }); }
      catch (x) { failed = true; }
      if (mine !== run) return; dlg.removeAttribute("data-busy");
      if (failed) { $q("#scanQ").textContent = "Scanner unavailable"; note(navigator.onLine ? "Type the mileage below." : "Go online once so MileMark can download the scanner. Type the mileage for now."); }
      else if (r.value == null) { $q("#scanQ").textContent = "Couldn't read it"; note(r.trip ? "That looks like a trip meter. Retake or type the mileage." : "Retake the photo or type the mileage."); }
      else { $q("#scanVal").value = r.value; $q("#scanQ").textContent = "Is this your odometer?"; note(r.conf === "high" ? "" : "Not sure about this read. Check the digits."); }
      sync(); $q("#scanVal").focus({ preventScroll: true });
    });
    $q("#scanUse").onclick = () => {
      if (!okVal() || !ctx) return; const el = document.getElementById(ctx.field), val = +$q("#scanVal").value, keep = $q("#scanKeep").checked, file = $q("#scanFile").files[0];
      el.value = val; el.dispatchEvent(new Event("input", { bubbles: true }));
      if (keep && file) { const pr = proofs[ctx.field] = { blob: file, val }; shrink(file).then(b => { pr.blob = b; }); } else delete proofs[ctx.field];
      dlg.close();
    };
  }
  // fetch the scanner files quietly after load (Wi-Fi/unmetered only) so scanning also works offline
  if (dlg && "serviceWorker" in navigator) window.addEventListener("load", () => setTimeout(() => { navigator.serviceWorker.ready.then(() => warm()); }, 5000));

  window.MMScan = { read, warm, engine };
})();
