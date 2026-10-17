// MileMark — static, local-only maintenance reminders.
// ==== SET THESE BEFORE SELLING ====
const GUMROAD_PRODUCT_ID = "nI-yteM-pSl1Ml4EuIg_oA=="; // Gumroad product > Content/settings > product_id
const GUMROAD_URL = "https://pocketappstudio.gumroad.com/l/qcwpwp";   // your Gumroad product page
// ==================================
const DEFAULT_RATE = 37, DAY = 864e5, KEY = "milemark.v1";
const $ = s => document.querySelector(s), fmt = n => Math.round(n).toLocaleString();
let DATA, PARTS = { make: {}, model: {} }, st = JSON.parse(localStorage.getItem(KEY) || '{"vehicles":[],"cur":null,"pro":false,"notified":{}}');
const save = () => { localStorage.setItem(KEY, JSON.stringify(st)); pushToSW(); };
const veh = () => st.vehicles.find(v => v.id === st.cur);
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function srcFor(list, yr) { return (list || []).find(e => +yr >= e.y[0] && +yr <= e.y[1]); }
const fmtMi = x => x == null ? CHECK : x.toLocaleString() + " mi";
// Engine/drivetrain-specific values: use the chosen one; if "not sure", show every engine's value, labeled, and no single interval.
function resolveEng(v, i) {
  if (!i.eng) return { ...i };
  const hit = i.eng.find(e => e.e === v.engine);
  if (hit) return { ...i, n: hit.n, s: hit.s, mo: hit.mo ?? i.mo, page: hit.page ?? i.page, first: hit.first, then: hit.then, note: [i.note, hit.e].filter(Boolean).join(" · ") };
  const lab = i.eng.map(e => `${e.e}: ${fmtMi(v.duty === "s" ? e.s : e.n)}`).join("; ");
  return { ...i, n: null, s: null, note: [i.note, `Depends on engine: ${lab}. Pick your engine in vehicle setup.`].filter(Boolean).join(" · ") };
}
function enginesFor(make, model, yr) { const h = srcFor((DATA.sourced || {})[make + "|" + model], yr); return (h && h.engines) || []; }
function baseSchedule(v) {
  if (v.make === "Generic") return DATA.generic;
  const key = v.make + "|" + v.model, hit = srcFor((DATA.sourced || {})[key], v.year);
  if (hit) return { system: `From the ${hit.src.manual}` + (hit.engineNote ? ` · ${hit.engineNote}` : "") + (hit.engines && v.engine && hit.engines.includes(v.engine) ? ` · ${v.engine}` : ""), src: hit.src, items: hit.items.map(i => resolveEng(v, i)) };
  // No official manual on file for this model/year: list the usual services without intervals.
  const m = DATA.models.find(x => x[0] === v.make && x[1] === v.model), base = DATA.makes[m[3] || m[0]];
  const items = base.items.map(i => ({ id: i.id, name: i.name, n: null, s: null, note: "" }));
  m[2].forEach(t => (DATA.addons[t] || []).forEach(a => { if (!items.some(i => i.id === a.id)) items.push({ id: a.id, name: a.name, n: null, s: null, note: "" }); }));
  return { system: v.year ? `No official ${v.year} ${v.make} ${v.model} manual on file yet. Check your owner's manual for intervals.` : "Add the model year to match your official manual. Until then, check your owner's manual.", items, unverified: true };
}
function schedule(v) { // factory schedule + the owner's interval edits + custom services
  const b = baseSchedule(v), over = v.over || {}, mi = mo => Math.max(100, Math.round(v.rate * mo * 30.4));
  const all = b.items.map(i => { const o = over[i.id]; if (!o) return i; const n = o.n || (o.mo ? mi(o.mo) : i.n);
    return { ...i, n, s: n, mo: o.mo ?? i.mo, first: undefined, then: undefined, edited: true, timeOnly: !o.n && !!o.mo }; })
    .concat((v.custom || []).map(c => ({ id: c.id, name: c.name, n: c.n || mi(c.mo), s: c.n || mi(c.mo), mo: c.mo || undefined, note: c.note || "", custom: true, tire: !!c.tire, base: c.base, timeOnly: !c.n })));
  const has = i => (v.duty === "s" ? i.s : i.n) != null;
  return { system: b.system, src: b.src, unverified: b.unverified, items: all.filter(has), chk: all.filter(i => !has(i)) };
}
function itemName(v, l) { const sc = schedule(v); return (sc.items.concat(sc.chk).find(x => x.id === l.item) || {}).name || l.label || l.item; }
function est(v) { return Math.max(v.anchorOdo, Math.round(v.anchorOdo + v.rate * (Date.now() - v.anchorAt) / DAY)); }
function iv(v, i) { return v.duty === "s" ? i.s : i.n; }
function nextAfter(v, i, odo) { // next scheduled mileage strictly after odo
  const n = iv(v, i);
  if (i.first && v.duty !== "s") { if (odo < i.first) return i.first; return i.first + Math.floor((odo - i.first) / i.then + 1) * i.then; }
  return Math.floor(odo / n + 1) * n;
}
function lastDone(v, id) { return v.log.filter(l => l.item === id).sort((a, b) => b.odo - a.odo || b.at - a.at)[0]; }
function status(v, i, e) {
  const L = lastDone(v, i.id), n = iv(v, i);
  let due = L ? (i.first && v.duty !== "s" && L.odo >= i.first - 5000 ? L.odo + i.then : L.odo + n) : nextAfter(v, i, v.startOdo);
  if (i.tire) { const b = L ? L.odo : i.base; due = b + n + tireOff(v, i.id, b, e); } // a tire set only wears while it is on the car
  const win = Math.max(500, n * 0.1);
  let s = e - due > win ? "over" : due - e <= win ? "now" : "next";
  let tdue = false;
  if (i.mo) { const ref = L ? new Date(L.date) : new Date(v.startAt); if ((Date.now() - ref) / DAY > i.mo * 30.4 && s === "next") { s = L ? "now" : s; tdue = !!L; } }
  const days = Math.round((due - e) / v.rate);
  return { ...i, n, due, s, L, tdue, win, days, cyc: L && L.reset ? L.at : 0, date: new Date(Date.now() + Math.max(0, days) * DAY) };
}
function allStatus(v) { const e = est(v); return schedule(v).items.map(i => status(v, i, e)).sort((a, b) => a.due - b.due); }

// ---------- UI ----------
function fillModels() {
  const g = {}; DATA.models.forEach(m => (g[m[0]] ||= []).push(m[1]));
  $("#fModel").innerHTML = '<option value="">Choose…</option>' + Object.keys(g).sort().map(mk => `<optgroup label="${mk}">${g[mk].map(md => `<option value="${mk}|${md}">${mk} ${md}</option>`).join("")}</optgroup>`).join("") + '<optgroup label="Other"><option value="Generic|Generic / classic car">Generic / classic car</option></optgroup>';
}
function fillEng(sel) {
  const [mk, md] = ($("#fModel").value || "").split("|"), E = enginesFor(mk, md, $("#fYear").value);
  $("#fEng").innerHTML = '<option value="">Not sure (show every engine)</option>' + E.map(e => `<option${e === sel ? " selected" : ""}>${esc(e)}</option>`).join("");
  $("#fEngWrap").classList.toggle("hidden", !E.length);
}
function showForm(edit) {
  $("#formCard").classList.remove("hidden"); $("#dash").classList.add("hidden");
  const v = edit && veh(); $("#formTitle").textContent = v ? "Edit vehicle" : "Set up your vehicle";
  $("#fModel").value = v ? v.make + "|" + v.model : ""; $("#fYear").value = v?.year || ""; $("#fCur").value = v ? est(v) : "";
  $("#fName").value = v?.name || ""; $("#fRate").value = v ? Math.round(v.rate) : ""; $("#fDuty").value = v?.duty || "n"; fillEng(v?.engine || "");
  $("#saveVeh").dataset.edit = v ? v.id : ""; clearProof();
}
function saveVeh() {
  const [make, model] = ($("#fModel").value || "").split("|"), cur = +$("#fCur").value;
  if (!make) return alert("Pick a make and model.");
  if (!$("#fCur").value || cur < 0) return alert("Enter your current odometer.");
  const id = $("#saveVeh").dataset.edit, rate = +$("#fRate").value || 0, pb = takeProof("fCur"), now = Date.now();
  if (id) { const v = veh(); Object.assign(v, { make, model, year: $("#fYear").value, name: $("#fName").value, duty: $("#fDuty").value, engine: $("#fEng").value }); if (rate) v.rate = rate; if (cur !== est(v)) { if (!lowerOk(v, cur)) return; correct(v, cur, pb); } }
  else {
    const v = { id: Date.now().toString(36), make, model, year: $("#fYear").value, name: $("#fName").value, duty: $("#fDuty").value, engine: $("#fEng").value, rate: rate || DEFAULT_RATE, rateSet: !!rate,
      startOdo: cur, startAt: now, anchorOdo: cur, anchorAt: now, readings: [{ odo: cur, at: now }], log: [] };
    if (pb) { v.readings[0].photo = true; savePhoto("o" + now, pb); }
    st.vehicles.push(v); st.cur = v.id;
  }
  save(); $("#formCard").classList.add("hidden"); render();
}
function correct(v, odo, proof) { // refine the miles/day rate from real readings
  const at = Date.now(), r = { odo, at }; if (proof) { r.photo = true; savePhoto("o" + at, proof); } v.readings.push(r);
  const f = v.readings[0], days = (Date.now() - f.at) / DAY;
  if (days >= 5 && odo > f.odo && !v.rateSet) v.rate = Math.min(400, Math.max(1, (odo - f.odo) / days));
  v.anchorOdo = odo; v.anchorAt = Date.now();
}
function render() {
  lockUI();
  $("#vehList").innerHTML = st.vehicles.length ? st.vehicles.map(v => `<div class="veh ${v.id === st.cur ? "on" : ""}" data-id="${v.id}"><div><b>${esc(v.name || `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.trim())}</b><div class="muted">~${fmt(est(v))} mi${vBadge(v)}</div></div><div class="row"><button class="mv" data-up="${v.id}" title="Move up" aria-label="Move up">↑</button><button class="mv" data-down="${v.id}" title="Move down" aria-label="Move down">↓</button><button class="x" data-del="${v.id}" title="Remove">✕</button></div></div>`).join("") : '<p class="muted">No vehicle yet. Tap + Add to start.</p>';
  const v = veh(); if (!v) { $("#dash").classList.add("hidden"); if (!st.vehicles.length) showForm(); return; }
  $("#dash").classList.remove("hidden");
  const S = allStatus(v), e = est(v);
  $("#vTitle").textContent = v.name || `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.trim();
  $("#vSys").textContent = schedule(v).system; $("#vBadge").innerHTML = vBadge(v); $("#duty").value = v.duty;
  $("#estOdo").textContent = fmt(e) + " mi"; $("#estInfo").textContent = ` · ~${Math.round(v.rate)} mi/day${v.readings.length > 1 ? " (learned)" : " (default)"}`;
  const c = k => S.filter(x => x.s === k).length; $("#cOver").textContent = c("over"); $("#cNow").textContent = c("now"); $("#cNext").textContent = Math.min(3, c("next"));
  const lbl = { over: "Overdue", now: "Due now", next: "Upcoming" };
  $("#items").innerHTML = S.map(x => `<div class="item"><div><b>${esc(x.name)}</b>${x.note ? `<div class="muted">${esc(x.note)}</div>` : ""}<div class="mi">${x.timeOnly ? `Every ${x.mo} mo (≈${fmt(x.n)} mi at your pace)` : `Every ${fmt(x.n)} mi${x.mo ? ` or ${x.mo} mo` : ""}`}${x.edited ? " (your interval)" : ""}${x.tire ? (tireMounted(v) === x.id ? " (on the car)" : " (in storage)") : x.custom ? " (custom)" : ""} · due at ${fmt(x.due)} mi ${x.s === "next" ? `· ~${x.date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : x.s === "over" ? `· ${fmt(e - x.due)} mi over` : ""}${x.L ? `<br>Last done ${fmt(x.L.odo)} mi` : ""}${srcLine(v, x)}</div>${partsHTML(v, x.id)}</div><div style="text-align:right"><span class="tag t-${x.s}">${lbl[x.s]}</span><br><br><button class="done1" data-done="${x.id}">✓ Done</button><br><button class="link" data-iv="${x.id}">Edit interval</button><br><button class="link" data-rep="${x.id}">Replaced</button></div></div>`).join("");
  const sc = schedule(v); $("#items").innerHTML += sc.chk.length ? `<div class="chk"><b>Check your owner's manual</b><p class="muted">${sc.unverified ? "We don't have the official manual for this model and year on file, so we don't show intervals for these." : v.duty === "s" ? "The official guide gives no severe-use interval for these." : "The official guide lists these only for special operating conditions, or we couldn't read an interval from it."}</p>${sc.chk.map(x => `<div class="item"><div><b>${esc(x.name)}</b>${x.note ? `<div class="muted">${esc(x.note)}</div>` : ""}<div class="mi">Interval: ${CHECK}</div></div><div style="text-align:right"><button class="ok" data-done="${x.id}">✓ Done</button><br><button class="link" data-rep="${x.id}">Replaced</button></div></div>`).join("")}</div>` : "";
  // timeline
  const end = e + 30000, marks = {};
  S.forEach(x => { if (x.tire) { if (tireMounted(v) === x.id) (marks[x.due] ||= []).push(x); return; } let m = nextAfter(v, x, v.startOdo - 1), g = 0, r0 = resetOdo(v, x.id); // a replaced part restarts its own chain from the new mileage
    while (m <= end && g++ < 200 && (r0 < 0 || m <= r0)) { (marks[m] ||= []).push(x); m = nextAfter(v, x, m); }
    if (r0 >= 0) for (m = x.due, g = 0; m <= end && g++ < 200; m += iv(v, x)) (marks[m] ||= []).push(x); });
  const keys = Object.keys(marks).map(Number).sort((a, b) => a - b); let shown = false;
  $("#timeline").innerHTML = `<div class="tl"><div class="tlm done"><b>${fmt(v.startOdo)} mi</b> <span class="muted">start</span></div>` + keys.map(k => { let h = ""; if (!shown && k > e) { shown = true; h = `<div class="tlm today"><b>${fmt(e)} mi</b> <span class="muted">today (est.)</span></div>`; }
    const allDone = marks[k].every(x => v.log.some(l => l.item === x.id && Math.abs(l.odo - k) <= iv(v, x) * 0.5));
    return h + `<div class="tlm ${allDone ? "done" : k <= e ? "past" : ""}"><b>${fmt(k)} mi</b><div class="muted">${marks[k].map(x => esc(x.name)).join(" · ")}</div></div>`; }).join("") + "</div>";
  $("#log").innerHTML = v.log.length ? [...v.log].sort((a, b) => b.odo - a.odo).map((l, i) => `<div class="item"><div><b>${esc(itemName(v, l))}</b><div class="mi">${fmt(l.odo)} mi · ${l.date}${l.who ? " · " + esc(l.who) : ""}${l.cost != null ? " · $" + l.cost.toFixed(2) : ""}${l.parts ? "<br>Parts: " + esc(l.parts) : ""}${l.photo ? " · 📎 receipt" : ""}${l.mph ? " · 📷 odometer" : ""}${l.note ? " · " + esc(l.note) : ""}</div></div><div class="row"><button class="mv" data-edlog="${l.at}" title="Edit" aria-label="Edit entry">✎</button><button class="x" data-unlog="${l.at}" title="Delete">✕</button></div></div>`).join("") : '<p class="muted">Tap ✓ Done on any service to log it. Mileage fills in automatically.</p>';
  $("#vParts").innerHTML = vehPartsHTML(v);
  $("#notifBtn").textContent = "Notification" in window && Notification.permission === "granted" ? "Reminders on ✓" : "Turn on reminders";
  renderCompleted(v, S); renderMore(v); notifyDue(); banners();
}
let doneItem, editAt = null, doneDirty = false;
function openDone(id) { $("#donePickRow").classList.add("hidden");
  const v = veh(), sc = schedule(v), it = sc.items.concat(sc.chk).find(x => x.id === id); doneItem = id; editAt = null; doneDirty = false; $("#doneSave").textContent = "Log it";
  $("#doneTitle").textContent = it.name; $("#doneMi").value = est(v); $("#doneDate").value = today(); $("#doneNote").value = ""; $("#doneParts").value = partGuess(v, id); $("#doneCost").value = ""; $("#doneWho").value = lastWho(); $("#donePhoto").value = ""; clearProof();
  $("#doneDlg").showModal();
}
function openEditLog(at) { $("#donePickRow").classList.add("hidden");
  const v = veh(), l = v.log.find(x => x.at === at); if (!l) return; editAt = at; doneItem = l.item; doneDirty = false;
  $("#doneTitle").textContent = "Edit: " + itemName(v, l); $("#doneSave").textContent = "Save changes";
  $("#doneMi").value = l.odo; $("#doneDate").value = l.date; $("#doneNote").value = l.note || ""; $("#doneParts").value = l.parts || ""; $("#doneCost").value = l.cost ?? ""; $("#doneWho").value = l.who || ""; $("#donePhoto").value = ""; clearProof();
  $("#doneDlg").showModal();
}
function closeDone(force) { if (!force && doneDirty && !confirm("Discard your unsaved changes?")) return false; doneDirty = false; $("#doneDlg").close(); return true; }
function logDone() {
  const v = veh(), odo = +$("#doneMi").value || est(v), f = $("#donePhoto").files[0], pb = takeProof("doneMi");
  if (editAt) { const l = v.log.find(x => x.at === editAt);
    Object.assign(l, { odo, date: $("#doneDate").value || l.date, note: $("#doneNote").value, parts: $("#doneParts").value, cost: $("#doneCost").value !== "" ? +$("#doneCost").value : null, who: $("#doneWho").value });
    if (f) { l.photo = true; savePhoto(l.at, f); } if (pb) { l.mph = true; savePhoto("m" + l.at, pb); } editAt = null; closeDone(true); save(); render(); return; }
  if (($("#doneDate").value || today()) === today() && odo < est(v) - 50 && !lowerOk(v, odo)) return;
  const at = Date.now();
  v.log.push({ item: doneItem, odo, date: $("#doneDate").value || today(), note: $("#doneNote").value, parts: $("#doneParts").value, cost: $("#doneCost").value ? +$("#doneCost").value : null, who: $("#doneWho").value, photo: !!f, mph: !!pb, at });
  if (f) savePhoto(at, f); if (pb) savePhoto("m" + at, pb);
  if (($("#doneDate").value || today()) === today() && (odo > est(v) + 50 || odo < est(v) - 50)) correct(v, odo); // a logged mileage is a real reading only when it is from today; a backdated entry never moves the odometer
  closeDone(true); save(); render();
}

// ---------- parts & specs ----------
const CHECK = "check owner's manual";
function pk(v) { return srcFor((PARTS.sourced || {})[v.make + "|" + v.model], v.year) || {}; }
const cite1 = x => x ? `${x.v} (${x.src.manual}, PDF p. ${x.page})` : CHECK;
let CUR_ENG = "";
const cite = x => { if (!x || !x.eng) return cite1(x); const h = x.eng.find(e => e.e === CUR_ENG); return h ? cite1({ ...x, v: `${h.v} (${h.e})` }) : cite1({ ...x, v: x.eng.map(e => `${e.e}: ${e.v}`).join("; ") }); };
function partRows(v, id) {
  if (v.make === "Generic") return [];
  const m = pk(v); CUR_ENG = v.engine || "";
  const pt = m.partsTable ? [["Replacement parts (official table)", cite(m.partsTable)]] : [];
  if (id === "oil") return [["Oil spec", cite(m.oilSpec)], ["Oil capacity with filter", cite(m.oilCap)], ...pt];
  if (id === "cool") return [["Coolant", cite(m.cool)]];
  if (id === "plug") return [["Spark plugs", cite(m.plug)]];
  if (id === "atf") return [["Transmission fluid", cite(m.atf)]];
  if (id === "cvt") return [["Transmission fluid", cite(m.cvt || m.atf)]];
  if (["air", "cabin", "wiper"].includes(id)) return pt.length ? pt : [[{ air: "Engine air filter", cabin: "Cabin air filter", wiper: "Wiper blades" }[id], CHECK]];
  const L = { tcase: "Fluid type", diffr: "Fluid type", diffft: "Fluid type", ptu: "Fluid type" }[id];
  return L ? [[L, CHECK]] : [];
}
const dlHTML = R => `<dl>${R.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>`;
function partsHTML(v, id) { const R = partRows(v, id); return R.length ? `<details class="parts"><summary>Parts & specs</summary>${dlHTML(R)}<div class="muted">Specs shown only where the official guide states them. An equivalent part meeting the same spec is fine.</div></details>` : ""; }
function vehPartsHTML(v) {
  if (v.make === "Generic") return '<p class="muted">For classic or unlisted vehicles, use your owner\'s manual or a parts counter. An equivalent part meeting the same spec is fine.</p>';
  const R = ["oil", "air", "cabin", "plug", "cool", "atf", "cvt"].flatMap(id => partRows(v, id)).filter((r, i, a) => a.findIndex(x => x[0] === r[0]) === i);
  return dlHTML(R) + `<p class="muted">${esc(PARTS.note || "")}</p>`;
}
function partGuess(v, id) { return ""; if (id === "rot" || id === "insp") return ""; for (const r of partRows(v, id)) { if (/spec$/i.test(r[0])) continue; const m = r[1].match(/filter ([^·]+)$/); if (m && !m[1].includes(CHECK)) return m[1].trim(); if (id !== "oil" && r[1] !== CHECK && !r[1].includes(CHECK)) return r[1].replace(/ \(.*\)$/, ""); } return ""; }
function srcLine(v, x) { const s = schedule(v).src; return s && x.page && !x.edited && !x.custom ? `<div class="src">Source: ${esc(s.manual)}, PDF p. ${x.page}</div>` : ""; }
function lastWho() { const l = st.vehicles.flatMap(v => v.log).sort((a, b) => b.at - a.at)[0]; return l?.who || ""; }

// ---------- receipt photos (IndexedDB, local only) ----------
const idb = () => new Promise((res, rej) => { const r = indexedDB.open("milemark", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => res(r.result); r.onerror = rej; });
async function savePhoto(k, blob) { const db = await idb(); db.transaction("photos", "readwrite").objectStore("photos").put(blob, k); }
async function getPhoto(k) { const db = await idb(); return new Promise(r => { const q = db.transaction("photos").objectStore("photos").get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }
async function delPhoto(k) { try { const db = await idb(); db.transaction("photos", "readwrite").objectStore("photos").delete(k); } catch (e) {} }

// ---------- Vehicle History Report ----------
function compliance(v) {
  const e = est(v); let due = 0, ok = 0;
  schedule(v).items.filter(i => !i.tire).forEach(i => { const n = iv(v, i), win = Math.max(500, n * 0.1), r0 = resetOdo(v, i.id), hit = m => v.log.some(l => l.item === i.id && l.odo > m - n * 0.5 && l.odo <= m + win);
    let m = nextAfter(v, i, v.startOdo - 1), g = 0;
    while (m <= e && g++ < 200) { const h = hit(m); if (r0 < 0 || m <= r0 ? (r0 < 0 || h) : false) { due++; if (h) ok++; } if (r0 >= 0 && m > r0) break; m = nextAfter(v, i, m); }
    if (r0 >= 0) { const L = lastDone(v, i.id); for (m = L.odo + n, g = 0; m <= e && g++ < 200; m += n) { due++; if (hit(m)) ok++; } } }); // after a replacement, the schedule restarts from it
  return { due, ok };
}
async function openReport() {
  const v = veh(), it = id => (schedule(v).items.find(x => x.id === id) || {}).name || (v.log.find(l => l.item === id) || {}).label || id, c = compliance(v), ST = allStatus(v);
  const logs = [...v.log].sort((a, b) => a.odo - b.odo), spent = logs.reduce((t, l) => t + (l.cost || 0), 0);
  const last = {}; logs.forEach(l => last[l.item] = l);
  const title = `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.trim();
  const rows = await Promise.all(logs.map(async (l, i) => { let img = ""; if (l.photo) { const b = await getPhoto(l.at); if (b) img = `<img class="rthumb" src="${URL.createObjectURL(b)}" alt="receipt">`; }
    if (l.mph) { const b = await getPhoto("m" + l.at); if (b) img += `<img class="rthumb" src="${URL.createObjectURL(b)}" alt="odometer photo">`; }
    return `<tr><td>${l.date}</td><td>${fmt(l.odo)}</td><td><b>${esc(it(l.item))}</b>${l.reset ? ' <span class="tag t-ok">Replaced</span>' : ""}${l.parts ? `<br>${esc(l.parts)}` : ""}${l.note ? `<br><span class="muted">${esc(l.note)}</span>` : ""}${img}</td><td>${esc(l.who || "")}</td><td>${l.cost != null ? "$" + l.cost.toFixed(2) : ""}</td></tr>`; }));
  const odoPics = (await Promise.all((v.readings || []).filter(r => r.photo).map(async r => { const b = await getPhoto("o" + r.at); return b ? `<div class="opic"><img class="rthumb" src="${URL.createObjectURL(b)}" alt="odometer photo"><span>${new Date(r.at).toLocaleDateString()} · ${fmt(r.odo)} mi</span></div>` : ""; }))).join("");
  $("#rBody").innerHTML = `<h1>Vehicle History Report</h1><div class="muted">Generated ${new Date().toLocaleDateString()} with MileMark · owner-recorded maintenance log</div>
   <h2 style="margin-top:14px">${esc(title)}${v.name ? ` <span class="muted">(${esc(v.name)})</span>` : ""}</h2>
   <div class="kpi"><div><b>${fmt(est(v))} mi</b>Current odometer (est.)</div><div><b>${c.ok} of ${c.due}</b>factory services done on time since ${fmt(v.startOdo)} mi</div><div><b>${logs.length}</b>services logged${spent ? ` · $${fmt(spent)} spent` : ""}</div>${logs.some(l => l.reset) ? `<div><b>${logs.filter(l => l.reset).length}</b>parts replaced</div>` : ""}</div>
   <h3>Last service dates</h3><table><tr><th>Service</th><th>Last done</th><th>Odometer</th><th>Next due</th></tr>${Object.values(last).map(l => { const x = ST.find(s => s.id === l.item); return `<tr><td>${esc(it(l.item))}</td><td>${l.date}${l.reset ? " (replaced)" : ""}</td><td>${fmt(l.odo)}</td><td>${x ? fmt(x.due) + " mi" : ""}</td></tr>`; }).join("") || '<tr><td colspan="4" class="muted">No services logged yet.</td></tr>'}</table>
   <h3>Service history</h3><table><tr><th>Date</th><th>Miles</th><th>Service & parts</th><th>Done by</th><th>Cost</th></tr>${rows.join("")}</table>${odoPics ? `<h3>Odometer photos</h3><div class="opics">${odoPics}</div>` : ""}
   <p class="muted" style="margin-top:16px">This report lists maintenance recorded by the owner in MileMark. MileMark does not verify entries. Schedules come from the manufacturer's official owner's manual, with the page cited; the owner's manual is the authority.</p>`;
  $("#report").classList.remove("hidden"); document.body.classList.add("rep");
}
function closeReport() { $("#report").classList.add("hidden"); document.body.classList.remove("rep"); }
async function shareReport() {
  const v = veh(), c = compliance(v), text = `${v.year || ""} ${v.make} ${v.model}: ${v.log.length} services logged, ${c.ok} of ${c.due} factory services done on time. Odometer ~${fmt(est(v))} mi.`;
  const html = `<!doctype html><meta charset="utf-8"><title>Vehicle History Report</title><style>body{font:14px system-ui;max-width:760px;margin:20px auto}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:5px;text-align:left}.kpi div{display:inline-block;margin-right:20px}.lock,.rthumb{display:none}</style>${$("#rBody").innerHTML}`;
  const file = new File([html], "vehicle-history-report.html", { type: "text/html" });
  try { if (navigator.canShare?.({ files: [file] })) return await navigator.share({ title: "Vehicle History Report", text, files: [file] });
    if (navigator.share) return await navigator.share({ title: "Vehicle History Report", text }); } catch (e) { if (e.name === "AbortError") return; }
  dl("vehicle-history-report.html", html, "text/html"); alert("Saved the report as a file. For a PDF, use Print / Save PDF.");
}

// ---------- reminders ----------
function summary() {
  return { vehicles: st.vehicles.map(v => ({ id: v.id, name: v.name || `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.trim(), rate: v.rate, anchorOdo: v.anchorOdo, anchorAt: v.anchorAt,
      items: allStatus(v).filter(x => !x.tire || tireMounted(v) === x.id).map(x => ({ id: x.id, name: x.name, due: x.due, win: x.win, tdue: x.tdue, cyc: x.cyc })) })),
    renew: st.vehicles.flatMap(v => (v.renew || []).map(r => ({ vid: v.id, id: r.id, label: renLabel(r), date: r.date, mi: r.mi || 0 }))),
    rq: st.vehicles.map(v => ({ vid: v.id, name: v.name || `${v.year || ""} ${v.make} ${v.model}`.trim(), q: recallQ(v) })).filter(x => x.q),
    odo: veh() ? { vid: veh().id, name: veh().name || veh().model, lastAt: Math.max(...veh().readings.map(r => r.at)) } : null };
}
async function pushToSW() { // give the service worker what it needs to check in the background
  if (!("caches" in window) || !DATA) return;
  const c = await caches.open("mm-state"); await c.put("state", new Response(JSON.stringify({ sum: summary(), notified: st.notified })));
}
async function notifyDue() {
  if (!("Notification" in window) || Notification.permission !== "granted" || !DATA) return;
  try { const r = await (await caches.open("mm-state")).match("state"); if (r) { const o = (await r.json()).notified || {}; for (const k in o) st.notified[k] = Math.max(st.notified[k] || 0, o[k]); } } catch (e) {}
  const reg = await navigator.serviceWorker?.ready, res = MMNotify.plan(summary(), st.notified, Date.now());
  st.notified = res.notified; save();
  for (const f of res.fire) { const o = { body: f.body, icon: "icon-192.png", tag: f.tag, data: f.odo ? { odo: f.odo } : {} };
    reg ? reg.showNotification(f.title, o) : new Notification(f.title, o); }
}
async function regSync() { if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { const reg = await navigator.serviceWorker?.ready; if (reg?.periodicSync) await reg.periodicSync.register("mm-check", { minInterval: 12 * 36e5 }); } catch (e) {} }
async function enableNotif() {
  if (!("Notification" in window)) return alert("This browser does not support notifications. Use Add to calendar instead. On iPhone, add MileMark to your Home Screen first.");
  const p = await Notification.requestPermission();
  if (p === "granted") { await regSync(); render(); } else alert("Notifications are blocked. You can still use Add to calendar.");
}
function ics() {
  const v = veh(), S = allStatus(v), d = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
  const ev = S.map(x => { const day = x.s === "next" ? x.date : new Date(Date.now() + DAY);
    return ["BEGIN:VEVENT", `UID:${v.id}-${x.id}-${x.due}@milemark`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d(day)}`, `DTEND;VALUE=DATE:${d(+day + DAY)}`,
      `SUMMARY:${(v.name || v.model) + ": " + x.name}`, `DESCRIPTION:Estimated due at ${fmt(x.due)} mi. Check your odometer and owner's manual.`, "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", "DESCRIPTION:Maintenance coming up", "END:VALARM", "END:VEVENT"].join("\r\n"); });
  dl(`milemark-${v.model}.ics`, ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MileMark//EN", ...ev, "END:VCALENDAR"].join("\r\n"), "text/calendar");
}
function dl(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name.replace(/\s+/g, "-"); a.click(); }

// ---------- License (MileMark is $9 one-time; the app needs an activated key) ----------
function lockUI() { const on = !st.pro; $("#lock").classList.toggle("hidden", !on); document.body.classList.toggle("locked", on); $("#buyLink").href = GUMROAD_URL; }
async function activate() {
  const key = $("#licKey").value.trim(); if (!key) return;
  if (GUMROAD_PRODUCT_ID.startsWith("REPLACE")) return $("#licMsg").textContent = "Store setup not finished (product id missing).";
  $("#licMsg").textContent = "Checking…";
  try {
    const r = await fetch("https://api.gumroad.com/v2/licenses/verify", { method: "POST", body: new URLSearchParams({ product_id: GUMROAD_PRODUCT_ID, license_key: key, increment_uses_count: "false" }) });
    const j = await r.json(), p = j.purchase || {};
    if (j.success && !p.refunded && !p.chargebacked && !p.disputed) { st.pro = true; st.lic = key; save(); $("#licKey").value = ""; $("#licMsg").textContent = ""; render(); }
    else $("#licMsg").textContent = "That key wasn't accepted.";
  } catch (e) { $("#licMsg").textContent = "Couldn't reach Gumroad. Check your connection and try again."; }
}
function needPro() { return false; }
function csv() {
  if (needPro()) return; const rows = [["Vehicle", "Service", "Interval (mi)", "Next due (mi)", "Status", "Last done (mi)", "Last replaced (date)"]];
  st.vehicles.forEach(v => allStatus(v).forEach(x => rows.push([v.name || `${v.year} ${v.make} ${v.model}`, x.name, x.n, x.due, x.s, x.L?.odo || "", x.L?.reset ? x.L.date : ""])));
  rows.push([]); rows.push(["Vehicle", "Service log item", "Odometer", "Date", "Parts", "Cost", "Done by", "Notes", "Type", "Next due (mi)", "Receipt photo"]);
  st.vehicles.forEach(v => v.log.forEach(l => rows.push([v.name || v.model, itemName(v, l), l.odo, l.date, l.parts, l.cost, l.who, l.note, l.reset ? "Replaced (clock reset)" : "Done", nextDueFor(v, l) ?? "", l.photo ? "yes" : ""])));
  moreCsv(rows);
  dl("milemark.csv", rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
}

// ---------- wiring ----------
document.addEventListener("click", e => {
  const t = e.target, d = t.dataset;
  if (d.done) openDone(d.done);
  else if (d.del) { if (confirm("Remove this vehicle and its log?")) { st.vehicles = st.vehicles.filter(v => v.id !== d.del); st.cur = st.vehicles[0]?.id || null; save(); render(); } }
  else if (d.up || d.down) moveVeh(d.up || d.down, d.up ? -1 : 1);
  else if (d.iv) openIv(d.iv);
  else if (d.edlog) openEditLog(+d.edlog);
  else if (d.rep !== undefined) openRep(d.rep);
  else if (d.unlog) { const v = veh(); v.log = v.log.filter(l => String(l.at) !== d.unlog && String(l.grp) !== d.unlog); delPhoto(+d.unlog); delPhoto("m" + d.unlog); save(); render(); }
  else if (t.closest(".veh")) { st.cur = t.closest(".veh").dataset.id; save(); render(); }
});
$("#addVeh").onclick = () => showForm();
$("#editVeh").onclick = () => showForm(true); $("#saveVeh").onclick = saveVeh;
$("#cancelVeh").onclick = () => { $("#formCard").classList.add("hidden"); render(); };
function openOdo(id) { if (id && st.vehicles.some(v => v.id === id)) { st.cur = id; save(); render(); } if (!veh()) return; clearProof(); $("#odoVal").value = est(veh()); if (!$("#odoDlg").open) $("#odoDlg").showModal(); $("#odoVal").focus(); $("#odoVal").select(); }
$("#fixOdo").onclick = () => openOdo();
$("#odoSave").onclick = () => { const n = $("#odoVal").value; if (n === "" || +n < 0) return alert("Enter the odometer."); const cv = veh(); if (!lowerOk(cv, +n)) return; correct(cv, +n, takeProof("odoVal")); save(); render(); $("#odoDlg").close(); };
$("#odoCancel").onclick = () => $("#odoDlg").close();
$("#duty").onchange = e => { veh().duty = e.target.value; save(); render(); };
$("#doneSave").onclick = logDone; $("#doneCancel").onclick = () => closeDone();
$("#doneDlg").addEventListener("input", () => doneDirty = true);
$("#doneDlg").addEventListener("cancel", e => { if (doneDirty && !confirm("Discard your unsaved changes?")) e.preventDefault(); else doneDirty = false; });
$("#notifBtn").onclick = enableNotif; $("#icsBtn").onclick = ics; $("#printBtn").onclick = () => print();
$("#csvBtn").onclick = csv; $("#reportBtn").onclick = openReport; $("#rClose").onclick = closeReport; $("#rPrint").onclick = () => print(); $("#rShare").onclick = shareReport; $("#jsonBtn").onclick = backup;
$("#restore").onchange = e => restoreFile(e.target.files[0]).finally(() => e.target.value = "");
$("#licGo").onclick = activate; $("#licKey").onkeydown = e => { if (e.key === "Enter") activate(); };
$("#lkBackup").onclick = backup; $("#lkRestore").onchange = e => restoreFile(e.target.files[0]).finally(() => e.target.value = "");
if ("serviceWorker" in navigator) { navigator.serviceWorker.register("sw.js"); navigator.serviceWorker.addEventListener("message", e => e.data?.odo && openOdo(e.data.odo)); }
initExtras();
Promise.all([fetch("schedules.json").then(r => r.json()), fetch("parts.json").then(r => r.json()).catch(() => PARTS)]).then(([j, p]) => { DATA = j; PARTS = p; fillModels(); render(); pushToSW(); regSync();
  const q = new URLSearchParams(location.search).get("odo"); if (q) { history.replaceState(null, "", location.pathname); openOdo(q); }
  setInterval(render, 60 * 60e3); document.addEventListener("visibilitychange", () => !document.hidden && render()); });

["#fModel", "#fYear"].forEach(k => $(k).addEventListener("change", () => fillEng($("#fEng").value)));
