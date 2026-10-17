// MileMark: "Completed" timeline and "Replaced a part" (resets an item's clock). Loaded after app.js.

// Starter parts for items the factory schedule doesn't track. The numbers are editable starting points, saved as the owner's own interval.
const COMMON = [
  { id: "tires", name: "Tires", n: 50000, mo: 72 }, { id: "pads", name: "Brake pads", n: 40000 }, { id: "rotors", name: "Brake rotors", n: 70000 },
  { id: "batt", name: "Battery", mo: 48 }, { id: "shocks", name: "Shocks / struts", n: 75000 }, { id: "align", name: "Wheel alignment", n: 12000, mo: 12 },
  { id: "alt", name: "Alternator", n: 100000 }, { id: "starter", name: "Starter", n: 100000 }];

function resetOdo(v, id) { const r = v.log.filter(l => l.item === id && l.reset).map(l => l.odo); return r.length ? Math.max(...r) : -1; }
function dueFrom(v, i, odo) { const n = iv(v, i); return i.first && v.duty !== "s" && odo >= i.first - 5000 ? odo + i.then : odo + n; }
function nextDueFor(v, l) { const sc = schedule(v), i = sc.items.find(x => x.id === l.item); return i ? dueFrom(v, i, l.odo) : null; }
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add("hidden"), 4500); }
const mon = d => d.toLocaleDateString(undefined, { month: "short", year: "numeric" });

// ---------- Completed timeline ----------
let compFilter = "";
function renderCompleted(v, S) {
  const sel = $("#compFilter"), ids = [...new Set(v.log.map(l => l.item))];
  if (compFilter && !ids.includes(compFilter)) compFilter = "";
  sel.innerHTML = '<option value="">All services</option>' + ids.map(id => `<option value="${esc(id)}"${id === compFilter ? " selected" : ""}>${esc(itemName(v, { item: id, label: (v.log.find(l => l.item === id) || {}).label }))}</option>`).join("");
  sel.classList.toggle("hidden", ids.length < 2);
  const L = [...v.log].filter(l => !compFilter || l.item === compFilter).sort((a, b) => (b.date > a.date) - (b.date < a.date) || b.odo - a.odo || b.at - a.at);
  const spent = L.reduce((t, l) => t + (l.cost || 0), 0), lbl = { over: "Overdue", now: "Due now", next: "Upcoming" };
  $("#compSum").textContent = L.length ? `${L.length} completed${spent ? ` · $${fmt(spent)}` : ""}` : "";
  $("#completed").innerHTML = L.length ? `<div class="tl">` + L.map(l => {
    const x = S.find(s => s.id === l.item), latest = lastDone(v, l.item) === l, nd = nextDueFor(v, l);
    const nx = nd == null ? "" : latest && x ? `<div class="nx">Next due ${fmt(x.due)} mi${x.s === "next" ? ` · ~${mon(x.date)}` : ""} <span class="tag t-${x.s}">${lbl[x.s]}</span></div>` : `<div class="nx old">Next was due ${fmt(nd)} mi</div>`;
    return `<div class="tlm done"><div class="cmp"><div><b>${esc(itemName(v, l))}</b>${l.reset ? ' <span class="tag t-ok">Replaced</span>' : ""}<div class="mi">${l.date} · ${fmt(l.odo)} mi${l.cost != null ? " · $" + l.cost.toFixed(2) : ""}${l.who ? " · " + esc(l.who) : ""}${l.photo ? " · 📎" : ""}${l.parts ? "<br>" + esc(l.parts) : ""}</div>${nx}</div><div class="row"><button class="mv" data-edlog="${l.at}" title="Edit" aria-label="Edit entry">✎</button></div></div></div>`; }).join("") + "</div>"
    : '<p class="muted">Nothing yet.</p>';
}

// ---------- Replaced a part ----------
function repKind(v) { // what the picker currently points at
  const val = $("#repItem").value, sc = schedule(v);
  if (val === "__new") return { kind: "new" };
  if (val.startsWith("c:")) return { kind: "common", c: COMMON.find(c => c.id === val.slice(2)) };
  const it = sc.items.find(x => x.id === val); if (it) return { kind: "item", it };
  return { kind: "chk", it: sc.chk.find(x => x.id === val) };
}
function repForm() {
  const v = veh(), k = repKind(v), sc = schedule(v);
  $("#repNew").classList.toggle("hidden", k.kind === "item");
  $("#repName").parentElement.classList.toggle("hidden", k.kind !== "new");
  if (k.kind === "common" && $("#repNew").dataset.cid !== k.c.id) { $("#repMi2").value = k.c.n || ""; $("#repMo").value = k.c.mo || ""; $("#repNew").dataset.cid = k.c.id; }
  if (k.kind !== "common") $("#repNew").dataset.cid = "";
  $("#repTireNote").classList.toggle("hidden", !(k.kind === "common" && k.c.id === "tires"));
  const tires = k.kind === "common" ? k.c.id === "tires" : k.kind !== "new" && (k.it?.id === "tires");
  $("#repRotRow").classList.toggle("hidden", !(tires && [...sc.items, ...sc.chk].some(x => x.id === "rot")));
  repPreview();
}
function repInterval(v) { // { n, mo, it } for what is being reset
  const k = repKind(v), mi = Math.round(+$("#repMi2").value || 0), mo = Math.round(+$("#repMo").value || 0);
  if (k.kind === "item") return { it: k.it, n: iv(v, k.it), mo: k.it.mo };
  return { n: mi || (mo ? Math.max(100, Math.round(v.rate * mo * 30.4)) : 0), mo, miOnly: !!mi, it: null };
}
function repPreview() {
  const v = veh(), odo = +$("#repMi").value, el = $("#repNext"); if (!v || !odo) { el.textContent = ""; return; }
  const x = repInterval(v); if (!x.n) { el.textContent = ""; return; }
  const due = x.it ? dueFrom(v, x.it, odo) : odo + x.n, dates = [];
  if (x.n) dates.push(new Date(Date.now() + Math.max(0, (due - est(v)) / v.rate) * DAY));
  if (x.mo) dates.push(new Date(new Date($("#repDate").value || today()).getTime() + x.mo * 30.4 * DAY));
  const d = new Date(Math.min(...dates)); el.textContent = `Next due at ${fmt(due)} mi · ~${mon(d)}`;
}
function openRep(id) {
  const v = veh(); if (!v) return; const sc = schedule(v), have = new Set([...sc.items, ...sc.chk].map(x => x.id));
  const opt = (val, t) => `<option value="${esc(val)}">${esc(t)}</option>`, tires = sc.items.concat(sc.chk).find(x => x.id === "tires");
  $("#repItem").innerHTML = (tires ? "" : opt("c:tires", "Tires")) + (tires ? opt("tires", tires.name) : "")
    + `<optgroup label="Your services">${sc.items.filter(x => x.id !== "tires").map(x => opt(x.id, x.name)).join("")}</optgroup>`
    + (sc.chk.length ? `<optgroup label="Other items">${sc.chk.map(x => opt(x.id, x.name)).join("")}</optgroup>` : "")
    + `<optgroup label="Add a part">${COMMON.filter(c => c.id !== "tires" && !have.has(c.id)).map(c => opt("c:" + c.id, c.name)).join("")}${opt("__new", "Something else…")}</optgroup>`;
  $("#repItem").value = id && [...$("#repItem").options].some(o => o.value === id) ? id : (tires ? "tires" : "c:tires");
  $("#repNew").dataset.cid = ""; $("#repName").value = ""; $("#repMi2").value = ""; $("#repMo").value = "";
  $("#repMi").value = est(v); $("#repDate").value = today(); $("#repParts").value = ""; $("#repCost").value = ""; $("#repWho").value = lastWho(); $("#repPhoto").value = ""; $("#repRot").checked = true; $("#repMsg").textContent = ""; clearProof();
  repForm(); $("#repDlg").showModal();
}
function repSave() {
  const v = veh(), k = repKind(v), sc = schedule(v), odo = Math.round(+$("#repMi").value), date = $("#repDate").value || today();
  const mi = Math.round(+$("#repMi2").value || 0), mo = Math.round(+$("#repMo").value || 0), msg = t => $("#repMsg").textContent = t;
  if (!($("#repMi").value !== "") || odo < 0 || odo > 2000000) return msg("Enter the odometer.");
  if (date === today() && odo < est(v) - 50 && !lowerOk(v, odo)) return;
  let id, name;
  if (k.kind === "new" || k.kind === "common") {
    name = k.kind === "new" ? $("#repName").value.trim() : k.c.name;
    if (!name) return msg("Give the part a name.");
    if (!mi && !mo) return msg("Enter miles, months, or both.");
    if (mi > 500000 || mo > 240) return msg("Enter a realistic interval.");
  } else if (k.kind === "chk" && (mi || mo) && (mi > 500000 || mo > 240)) return msg("Enter a realistic interval.");
  if (k.kind === "item") id = k.it.id;
  else if (k.kind === "chk") { id = k.it.id; if (mi || mo) { (v.over ||= {})[id] = { n: mi || null, mo: mo || null }; } }
  else { id = k.kind === "common" ? k.c.id : "c" + Date.now().toString(36); v.custom ||= []; v.custom.push({ id, name, n: mi || null, mo: mo || null }); }
  const f = $("#repPhoto").files[0], pb = takeProof("repMi"), at = Date.now(), who = $("#repWho").value, cost = $("#repCost").value !== "" ? +$("#repCost").value : null;
  v.log.push({ item: id, odo, date, note: "", parts: $("#repParts").value, cost, who, photo: !!f, mph: !!pb, at, reset: true });
  if (f) savePhoto(at, f); if (pb) savePhoto("m" + at, pb);
  const ids = [id];
  if (id === "tires" && !$("#repRotRow").classList.contains("hidden") && $("#repRot").checked) { // new tires start a fresh rotation count
    v.log.push({ item: "rot", odo, date, note: "With new tires", parts: "", cost: null, who, photo: false, mph: false, at: at + 1, reset: true, grp: at }); ids.push("rot"); }
  if (date === today() && Math.abs(odo - est(v)) > 50) correct(v, odo); // today's mileage is a real reading
  for (const i of ids) for (const key in st.notified) if (key.startsWith(v.id + "|" + i + "|")) delete st.notified[key]; // no leftover alerts from the old cycle
  $("#repDlg").close(); save(); render();
  const x = allStatus(v).find(s => s.id === id); toast(x ? `${itemName(v, { item: id })} reset. Next due ${fmt(x.due)} mi` : "Logged");
}
(function () {
  const on = (s, ev, fn) => $(s).addEventListener(ev, fn);
  on("#repBtn", "click", () => openRep()); on("#compRep", "click", () => openRep());
  on("#repItem", "change", repForm); ["#repMi", "#repMi2", "#repMo", "#repDate"].forEach(s => on(s, "input", repPreview));
  on("#repSave", "click", repSave); on("#repCancel", "click", () => $("#repDlg").close());
  on("#compFilter", "change", e => { compFilter = e.target.value; render(); });
  const t = setInterval(() => { if (typeof DATA === "undefined" || !DATA) return; clearInterval(t);
    if (new URLSearchParams(location.search).has("replace")) { history.replaceState(null, "", location.pathname); openRep(); } }, 100);
})();
