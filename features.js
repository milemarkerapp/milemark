// MileMark extras: interval editing, custom services, free backup with photos, reorder, banners.
// Loaded before app.js; everything here runs only when called.

// ---------- vehicle order ----------
function moveVeh(id, dir) {
  const a = st.vehicles, i = a.findIndex(v => v.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; save(); render();
}

// ---------- interval editing + custom services ----------
let ivId = null;
function openIv(id) {
  const v = veh(); ivId = id; const it = id ? schedule(v).items.find(x => x.id === id) : null, base = id ? baseSchedule(v).items.find(x => x.id === id) : null;
  const cust = it?.custom ? v.custom.find(c => c.id === id) : null;
  $("#ivTitle").textContent = !id ? "Add a custom service" : it.custom ? "Edit custom service" : "Edit interval: " + it.name;
  $("#ivNameRow").classList.toggle("hidden", !!(id && !it.custom));
  $("#ivName").value = cust?.name || "";
  $("#ivMi").value = cust ? (cust.n || "") : id ? ((v.over || {})[id]?.n ?? "") : "";
  $("#ivMo").value = cust ? (cust.mo || "") : id ? ((v.over || {})[id]?.mo ?? "") : "";
  $("#ivMi").placeholder = base ? `factory: ${fmt(iv(v, base))}` : "e.g. 6000";
  $("#ivMo").placeholder = base?.mo ? `factory: ${base.mo}` : "e.g. 12";
  $("#ivFactory").textContent = base ? `Factory interval (${v.duty === "s" ? "severe" : "normal"} duty): every ${fmt(iv(v, base))} mi${base.mo ? " or " + base.mo + " months" : ""}. Your interval applies to both normal and severe duty.` : "Enter miles, months, or both (whichever comes first).";
  $("#ivReset").classList.toggle("hidden", !(id && !it.custom && (v.over || {})[id]));
  $("#ivDelete").classList.toggle("hidden", !(it?.custom));
  $("#ivMsg").textContent = ""; $("#ivDlg").showModal();
}
function saveIv() {
  const v = veh(), n = Math.round(+$("#ivMi").value || 0), mo = Math.round(+$("#ivMo").value || 0), name = $("#ivName").value.trim();
  const isCustom = !ivId || (v.custom || []).some(c => c.id === ivId);
  if (n < 0 || mo < 0 || n > 500000 || mo > 240) return $("#ivMsg").textContent = "Enter a realistic number of miles or months.";
  if (isCustom) {
    if (!name) return $("#ivMsg").textContent = "Give the service a name.";
    if (!n && !mo) return $("#ivMsg").textContent = "Enter miles, months, or both.";
    v.custom ||= [];
    if (ivId) Object.assign(v.custom.find(c => c.id === ivId), { name, n: n || null, mo: mo || null });
    else v.custom.push({ id: "c" + Date.now().toString(36), name, n: n || null, mo: mo || null });
  } else {
    v.over ||= {};
    if (!n && !mo) delete v.over[ivId]; else v.over[ivId] = { n: n || null, mo: mo || null };
  }
  $("#ivDlg").close(); save(); render();
}
function resetIv() { const v = veh(); if (v.over) delete v.over[ivId]; $("#ivDlg").close(); save(); render(); }
function deleteCustom() {
  const v = veh(); if (!confirm("Remove this custom service? Its log entries stay in your history.")) return;
  const c = v.custom.find(x => x.id === ivId); v.log.forEach(l => { if (l.item === ivId) l.label = c.name; });
  v.custom = v.custom.filter(x => x.id !== ivId); $("#ivDlg").close(); save(); render();
}

// ---------- backup & restore (free; includes receipt photos) ----------
const blobToData = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function dataToBlob(u) { return (await fetch(u)).blob(); }
async function allPhotos() {
  const out = {}; for (const v of st.vehicles) for (const l of v.log) if (l.photo) { const b = await getPhoto(l.at); if (b) out[l.at] = await blobToData(b); }
  return out;
}
async function backup() {
  const state = { ...st }; delete state.pro; delete state.lic; // the license stays on this device
  const file = { app: "MileMark", kind: "backup", version: 2, created: new Date().toISOString(), state, photos: await allPhotos() };
  dl(`milemark-backup-${today()}.json`, JSON.stringify(file), "application/json");
  st.lastBackup = Date.now(); save(); banners();
}
async function restoreFile(f) {
  if (!f) return;
  let o; try { o = JSON.parse(await f.text()); } catch { return alert("That file isn't a MileMark backup."); }
  const state = o.kind === "backup" ? o.state : o; // version 1 files were the bare state
  if (!state || !Array.isArray(state.vehicles)) return alert("That file isn't a MileMark backup.");
  if (st.vehicles.length && !confirm(`Replace what's on this device with the backup (${state.vehicles.length} vehicle${state.vehicles.length === 1 ? "" : "s"})?`)) return;
  const keep = { pro: st.pro, lic: st.lic, iosTip: st.iosTip };
  st = { notified: {}, ...state, ...keep, lastBackup: Date.now() };
  st.cur = st.vehicles.find(v => v.id === st.cur) ? st.cur : st.vehicles[0]?.id || null;
  let n = 0; for (const [k, u] of Object.entries(o.photos || {})) { try { await savePhoto(+k, await dataToBlob(u)); n++; } catch (e) {} }
  save(); render(); alert(`Restored ${st.vehicles.length} vehicle${st.vehicles.length === 1 ? "" : "s"}${n ? ` and ${n} receipt photo${n === 1 ? "" : "s"}` : ""}.`);
}

// ---------- banners: backup reminder, iPhone tip ----------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function banners() {
  const el = $("#banners"); if (!el) return; const B = [];
  const hasData = st.vehicles.some(v => v.log.length) || st.vehicles.length > 0;
  const since = st.lastBackup || st.vehicles.reduce((m, v) => Math.min(m, v.startAt || Date.now()), Date.now());
  if (hasData && Date.now() - since > 30 * DAY && (!st.snoozeBackup || Date.now() > st.snoozeBackup))
    B.push(`<div class="banner" id="bkBanner"><div><b>Time for a backup.</b> Your data lives only on this device. Save a backup file somewhere safe (it includes receipt photos).</div><div class="row"><button class="sm" data-bk="1">Back up now</button><button class="ghost sm" data-bksnooze="1">Later</button></div></div>`);
  if (isIOS() && !standalone() && !st.iosTip)
    B.push(`<div class="banner" id="iosTip"><div><b>iPhone tip:</b> tap the Share button, then <b>Add to Home Screen</b>. MileMark then opens like an app, can send reminders, and Safari is much less likely to clear its data.</div><button class="ghost sm" data-iostip="1">Got it</button></div>`);
  el.innerHTML = B.join("");
}

// ---------- wiring ----------
function initExtras() {
  try { navigator.storage?.persist?.().then(p => { st.persisted = p; }); } catch (e) {}
  $("#ivSave").onclick = saveIv; $("#ivCancel").onclick = () => $("#ivDlg").close(); $("#ivReset").onclick = resetIv; $("#ivDelete").onclick = deleteCustom;
  $("#addCustom").onclick = () => openIv(null);
  document.addEventListener("click", e => { const d = e.target.dataset || {};
    if (d.bk) backup(); else if (d.bksnooze) { st.snoozeBackup = Date.now() + 7 * DAY; save(); banners(); }
    else if (d.iostip) { st.iosTip = true; save(); banners(); } });
}
