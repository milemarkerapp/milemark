// MileMark: lower-reading confirm, past entries, tire sets, recalls (NHTSA, on device), renewals. Loaded after replace.js.

// ---------- odometer sanity ----------
function lowerOk(v, odo) { return !(odo < v.anchorOdo) || confirm(`That's lower than your last reading (${fmt(v.anchorOdo)} mi). Use it anyway?`); }

// ---------- past service (backdated) ----------
function openPast() {
  const v = veh(); if (!v) return; const sc = schedule(v), all = sc.items.concat(sc.chk);
  $("#donePick").innerHTML = all.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(""); $("#donePickRow").classList.remove("hidden");
  doneItem = all[0].id; editAt = null; doneDirty = false; $("#doneSave").textContent = "Log it"; $("#doneTitle").textContent = "Add a past service";
  $("#doneMi").value = ""; $("#doneDate").value = ""; $("#doneNote").value = ""; $("#doneParts").value = ""; $("#doneCost").value = ""; $("#doneWho").value = lastWho(); $("#donePhoto").value = ""; clearProof();
  $("#doneDlg").showModal();
}

// ---------- tire sets: each set has its own clock, and only wears while it is on the car ----------
const swaps = v => [...(v.tires?.swaps || [])].sort((a, b) => a.odo - b.odo || a.at - b.at);
function tireOn(v, id, from, to) { const sw = swaps(v); let on = 0;
  sw.forEach((s, k) => { if (s.to !== id) return; const a = Math.max(from, s.odo), b = Math.min(to, k + 1 < sw.length ? sw[k + 1].odo : Infinity); if (b > a) on += b - a; }); return on; }
const tireOff = (v, id, from, e) => Math.max(0, (e - from) - tireOn(v, id, from, e));
function tireMounted(v) { const sw = swaps(v), l = sw[sw.length - 1]; return l && (v.custom || []).some(c => c.id === l.to) ? l.to : null; }
const tireSets = v => (v.custom || []).filter(c => c.tire);
function tireRender() {
  const v = veh(), S = allStatus(v), m = tireMounted(v);
  $("#tireList").innerHTML = tireSets(v).map(c => { const x = S.find(s => s.id === c.id);
    return `<div class="item"><div><b>${esc(c.name.replace(/^Tires: /, ""))}</b><div class="mi">${m === c.id ? "On the car" : "In storage"}${x ? ` · due at ${fmt(x.due)} mi` : ""}</div></div><div class="row wrap">${m === c.id ? "" : `<button class="sm" data-tmount="${c.id}">Mount</button>`}<button class="ghost sm" data-trep="${c.id}">Replaced</button><button class="ghost sm" data-tdel="${c.id}">Delete</button></div></div>`; }).join("") || '<p class="muted">No sets yet.</p>';
  $("#tsMount").checked = !tireSets(v).length;
}
function tireMount(id) { const v = veh(), c = v.custom.find(x => x.id === id), at = Date.now(), odo = est(v);
  (v.tires ||= { swaps: [] }).swaps.push({ odo, at, to: id });
  v.log.push({ item: "tswap", label: "Mounted " + c.name.replace(/^Tires: /, "") + " tires", odo, date: today(), note: "", parts: "", cost: null, who: "", photo: false, mph: false, at });
  save(); render(); tireRender(); }
function tireAdd() { const v = veh(), name = $("#tsName").value.trim(), n = Math.round(+$("#tsMi").value || 0), mo = Math.round(+$("#tsMo").value || 0);
  if (!name) return $("#tsMsg").textContent = "Give the set a name."; if (!n && !mo) return $("#tsMsg").textContent = "Enter miles, months, or both.";
  const id = "ts" + Date.now().toString(36), odo = est(v), first = !tireSets(v).length;
  (v.custom ||= []).push({ id, name: "Tires: " + name, n: n || null, mo: mo || null, tire: true, base: odo });
  $("#tsName").value = ""; $("#tsMsg").textContent = ""; save(); if (first || $("#tsMount").checked) tireMount(id); else { render(); tireRender(); } }
function tireDel(id) { const v = veh(); if (!confirm("Remove this tire set? Its log entries stay in your history.")) return; const c = v.custom.find(x => x.id === id);
  v.log.forEach(l => { if (l.item === id) l.label = c.name; }); v.custom = v.custom.filter(x => x.id !== id); save(); render(); tireRender(); }

// ---------- recalls (NHTSA, by make / model / year; nothing about you is sent) ----------
const recallQ = v => v.make && v.make !== "Generic" && v.model && +v.year > 1950 ? { make: v.make, model: v.model, year: +v.year } : null;
const recallUrl = q => `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(q.make)}&model=${encodeURIComponent(q.model)}&modelYear=${q.year}`;
const recallOpen = v => (v.recalls?.items || []).filter(r => !(v.recalls.done || {})[r.id]);
const vBadge = v => { const n = recallOpen(v).length; return n ? ` <span class="tag t-over" data-rcv="${v.id}" role="button">${n} recall${n === 1 ? "" : "s"}</span>` : ""; };
const recallClean = j => { const seen = new Set(); return (j.results || []).filter(r => r.NHTSACampaignNumber && !seen.has(r.NHTSACampaignNumber) && seen.add(r.NHTSACampaignNumber)).map(r => ({ id: r.NHTSACampaignNumber, comp: r.Component, sum: String(r.Summary || "").slice(0, 600), rem: String(r.Remedy || "").slice(0, 400), date: r.ReportReceivedDate, park: !!r.parkIt })); };
const rcBusy = {};
async function recallFetch(v, force) {
  const q = recallQ(v); if (!q || !navigator.onLine || rcBusy[v.id]) return; const r = v.recalls ||= {}, key = JSON.stringify(q);
  if (!force && r.key === key && Date.now() - (r.at || r.tried || 0) < (r.at ? 12 : 1) * 36e5) return;
  rcBusy[v.id] = 1;
  try { const res = await fetch(recallUrl(q)); if (!res.ok) throw 0; const items = recallClean(await res.json());
    r.items = items; r.at = Date.now(); r.key = key; r.done ||= {};
    const fire = MMNotify.recalls([{ vid: v.id, name: v.name || `${v.year} ${v.make} ${v.model}`, ids: items }], st.notified, Date.now());
    save(); if ("Notification" in window && Notification.permission === "granted") { const reg = await navigator.serviceWorker?.ready; for (const f of fire) { const o = { body: f.body, icon: "icon-192.png", tag: f.tag }; reg ? reg.showNotification(f.title, o) : new Notification(f.title, o); } }
  } catch (e) { r.tried = Date.now(); r.key = key; save(); }
  rcBusy[v.id] = 0; render(); if ($("#rcDlg").open) recallRender();
}
function recallRender() { const v = veh(), r = v.recalls || {}, L = r.items || [];
  $("#rcBody").innerHTML = (L.length ? L.map(x => { const d = (r.done || {})[x.id];
    return `<div class="item" style="${d ? "opacity:.55" : ""}"><div><b>${esc(x.comp)}</b>${x.park ? ' <span class="tag t-over">Do not drive</span>' : ""}<div class="muted">${esc(x.date)} · ${esc(x.id)}</div><div class="mi">${esc(x.sum)}</div>${x.rem ? `<div class="mi"><b>Fix:</b> ${esc(x.rem)}</div>` : ""}</div><div><button class="ghost sm" data-rcfix="${esc(x.id)}">${d ? "Not fixed" : "Fixed"}</button></div></div>`; }).join("")
    : `<p class="muted">${r.at ? "No recalls found for this model year." : recallQ(v) ? "Not checked yet." : "Add the model year to check recalls."}</p>`)
    + (r.at ? `<p class="muted">Checked ${new Date(r.at).toLocaleDateString()}</p>` : ""); }

// ---------- renewals ----------
const REN = { reg: "Registration", ins: "Insurance", insp: "Inspection", warr: "Warranty" }, RENEVERY = { reg: 12, ins: 6, insp: 12, warr: 0 };
const renLabel = r => REN[r.type] || r.type;
const dayDiff = s => { const [y, m, d] = s.split("-").map(Number), t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / DAY); };
function addMonths(s, n) { const [y, m, d] = s.split("-").map(Number), t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(d, last)); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; }
let renId = null;
function renewalsHTML(v) { const R = [...(v.renew || [])].sort((a, b) => a.date < b.date ? -1 : 1);
  return R.length ? R.map(r => { const d = dayDiff(r.date), s = d < 0 ? "over" : d <= 30 ? "now" : "next", txt = d < 0 ? `Ended ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "Ends today" : `${d} day${d === 1 ? "" : "s"} left`;
    return `<div class="item"><div><b>${esc(renLabel(r))}</b><div class="mi">${r.date}${r.mi ? ` · or ${fmt(r.mi)} mi` : ""}${r.every ? ` · every ${r.every} mo` : ""}</div></div><div style="text-align:right"><span class="tag t-${s}">${txt}</span><br><br><button class="done1" data-renewed="${r.id}">Renewed</button><br><button class="link" data-renedit="${r.id}">Edit</button></div></div>`; }).join("") : '<p class="muted">Registration, insurance, inspection, warranty.</p>'; }
function openRen(id) { const v = veh(), r = id && (v.renew || []).find(x => x.id === id); renId = id || null;
  $("#renTitle").textContent = r ? "Edit renewal" : "Add a renewal"; $("#renType").value = r?.type || "reg"; $("#renDate").value = r?.date || ""; $("#renEvery").value = r ? (r.every || "") : RENEVERY.reg; $("#renMi").value = r?.mi || "";
  $("#renType").disabled = !!r; $("#renDel").classList.toggle("hidden", !r); $("#renMsg").textContent = ""; renType(!r); $("#renDlg").showModal(); }
function renType(setEvery) { const t = $("#renType").value; $("#renMiRow").classList.toggle("hidden", t !== "warr"); if (setEvery) $("#renEvery").value = RENEVERY[t] || ""; }
function renSave() { const v = veh(), type = $("#renType").value, date = $("#renDate").value, every = Math.round(+$("#renEvery").value || 0), mi = type === "warr" ? Math.round(+$("#renMi").value || 0) : 0;
  if (!date) return $("#renMsg").textContent = "Pick the end date."; if (every < 0 || every > 240 || mi < 0 || mi > 2000000) return $("#renMsg").textContent = "Enter realistic numbers.";
  v.renew ||= []; if (renId) Object.assign(v.renew.find(x => x.id === renId), { date, every, mi }); else v.renew.push({ id: "r" + Date.now().toString(36), type, date, every, mi });
  $("#renDlg").close(); save(); render(); }
function renewed(id) { const v = veh(), r = v.renew.find(x => x.id === id); if (!r.every) return openRen(id);
  const prev = r.date; let nd = addMonths(r.date, r.every), g = 0; while (dayDiff(nd) < 0 && g++ < 200) nd = addMonths(nd, r.every); r.date = nd; r.was = prev;
  for (const k in st.notified) if (k.startsWith("ren|" + v.id + "|" + id + "|")) delete st.notified[k];
  save(); render(); undoToast(`${renLabel(r)} renewed to ${nd}`, () => { r.date = prev; delete r.was; save(); render(); }); }
function undoToast(t, fn) { const el = $("#toast"); el.textContent = t + " "; const b = document.createElement("button"); b.className = "ghost sm"; b.textContent = "Undo"; b.onclick = () => { fn(); el.classList.add("hidden"); }; el.appendChild(b);
  el.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add("hidden"), 7000); }

// ---------- render hook + CSV ----------
function renderMore(v) { $("#renList").innerHTML = renewalsHTML(v); recallFetch(v); }
function moreCsv(rows) {
  rows.push([]); rows.push(["Vehicle", "Renewal", "Ends on", "Ends at (mi)", "Repeats (months)"]);
  st.vehicles.forEach(v => (v.renew || []).forEach(r => rows.push([v.name || `${v.year} ${v.make} ${v.model}`, renLabel(r), r.date, r.mi || "", r.every || ""])));
  rows.push([]); rows.push(["Vehicle", "Recall", "Campaign", "Reported", "Status"]);
  st.vehicles.forEach(v => ((v.recalls || {}).items || []).forEach(x => rows.push([v.name || `${v.year} ${v.make} ${v.model}`, x.comp, x.id, x.date, (v.recalls.done || {})[x.id] ? "Fixed" : "Open"])));
}

(function () {
  const on = (s, ev, fn) => $(s).addEventListener(ev, fn);
  on("#pastBtn", "click", openPast); on("#donePick", "change", e => { doneItem = e.target.value; });
  on("#tireBtn", "click", () => { tireRender(); $("#tireDlg").showModal(); }); on("#tsAdd", "click", tireAdd); on("#tsClose", "click", () => $("#tireDlg").close());
  on("#renAdd", "click", () => openRen()); on("#renSave", "click", renSave); on("#renCancel", "click", () => $("#renDlg").close()); on("#renType", "change", () => renType(true));
  on("#renDel", "click", () => { if (!confirm("Delete this renewal?")) return; const v = veh(); v.renew = v.renew.filter(x => x.id !== renId); $("#renDlg").close(); save(); render(); });
  on("#rcClose", "click", () => $("#rcDlg").close()); on("#rcRefresh", "click", () => recallFetch(veh(), true));
  document.addEventListener("click", e => { const d = e.target.dataset || {};
    if (d.rcv) { st.cur = d.rcv; save(); render(); recallRender(); $("#rcDlg").showModal(); }
    else if (d.rcfix) { const r = (veh().recalls.done ||= {}); r[d.rcfix] ? delete r[d.rcfix] : r[d.rcfix] = Date.now(); save(); render(); recallRender(); }
    else if (d.tmount) tireMount(d.tmount); else if (d.tdel) tireDel(d.tdel); else if (d.trep) { $("#tireDlg").close(); openRep(d.trep); }
    else if (d.renewed) renewed(d.renewed); else if (d.renedit) openRen(d.renedit); });
})();
