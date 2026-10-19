// MileMark fleet extras (all on device): per-vehicle record sheet, fleet CSV, odometer photo share.
const vName = v => v.name || `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.trim();
const vFull = v => `${v.year || ""} ${v.make === "Generic" ? "" : v.make} ${v.model}`.replace(/\s+/g, " ").trim();
const csvSafe = c => { c = String(c ?? ""); return /^[=+\-@\t\r]/.test(c) ? "'" + c : c; };
const realLog = v => v.log.filter(l => l.item !== "tswap").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.odo - b.odo));
const fleetStat = v => allStatus(v).filter(x => !x.tire || tireMounted(v) === x.id);

function fleetRows() {
  const rows = [["Unit", "Vehicle", "Nickname", "Plate", "Tire size", "Odometer (est. mi)", "Last service date", "Last service", "Last service (mi)", "Next due", "Next due (mi)", "Status", "Overdue", "Due now", "Open recalls"]];
  st.vehicles.forEach(v => { const S = fleetStat(v), L = realLog(v).pop(), n = S[0], c = k => S.filter(x => x.s === k).length;
    rows.push([v.unit || "", vFull(v), v.name || "", v.plate || "", v.tireSize || "", Math.round(est(v)), L ? L.date : "", L ? itemName(v, L) : "", L ? L.odo : "", n ? n.name : "", n ? n.due : "", c("over") ? "Overdue" : c("now") ? "Due now" : "OK", c("over"), c("now"), recallOpen(v).length]); });
  return rows;
}
const csvText = rows => rows.map(r => r.map(c => `"${csvSafe(c).replace(/"/g, '""')}"`).join(",")).join("\n");
function fleetCsv() { if (!st.vehicles.length) return; dl("milemark-fleet.csv", csvText(fleetRows()), "text/csv"); }

function sheetHTML(v) {
  const L = realLog(v), S = fleetStat(v).slice(0, 12);
  return `<h1>Maintenance Record Sheet</h1><div class="muted">Printed ${new Date().toLocaleDateString()}</div>
   <h2 style="margin-top:14px">${v.unit ? "Unit " + esc(v.unit) + " · " : ""}${esc(vFull(v))}</h2>
   <table><tr><th>Plate</th><th>Tire size</th><th>Odometer (est.)</th></tr><tr><td>${esc(v.plate || "")}</td><td>${esc(v.tireSize || "")}</td><td>${fmt(est(v))} mi</td></tr></table>
   <h3>Service and repair history</h3><table><tr><th>Date</th><th>Mileage</th><th>Service</th><th>Parts</th><th>Done by</th></tr>${L.map(l => `<tr><td>${esc(l.date)}</td><td>${fmt(l.odo)}</td><td>${esc(itemName(v, l))}${l.reset ? " (replaced)" : ""}</td><td>${esc(l.parts || "")}</td><td>${esc(l.who || "")}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">No entries yet.</td></tr>'}</table>
   <h3>Next due</h3><table><tr><th>Service</th><th>Due at</th><th>Status</th></tr>${S.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.due)} mi</td><td>${{ over: "Overdue", now: "Due now", next: "Upcoming" }[x.s]}</td></tr>`).join("")}</table>
   <p class="muted" style="margin-top:16px">Owner-recorded maintenance log, a recordkeeping aid. Self-reported and editable; not verified or certified, and not proof of compliance with any law or regulation.</p>`;
}
function openSheet() { const v = veh(); if (!v) return; $("#rBody").innerHTML = sheetHTML(v); $("#report").classList.remove("hidden"); document.body.classList.add("rep"); }

// Driver odometer photo: share the photo + unit + reading through the phone's share sheet.
async function shareOdo() {
  const v = veh(), f = $("#scanFile").files[0], val = $("#scanVal").value; if (!v || !f || val === "") return;
  const text = `${v.unit ? "Unit " + v.unit + " · " : ""}${vFull(v)}${v.plate ? " · " + v.plate : ""}\nOdometer: ${fmt(+val)} mi\n${new Date().toLocaleString()}`;
  let blob = f; try { blob = await shrinkPhoto(f); } catch (e) {}
  const file = new File([blob], `odometer-${(v.unit || vFull(v)).replace(/[^\w-]+/g, "-")}-${val}.jpg`, { type: blob.type || "image/jpeg" });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ title: "Odometer reading", text, files: [file] }); return; } } catch (e) { if (e.name === "AbortError") return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  try { await navigator.clipboard.writeText(text); toast("Photo saved. Message copied to paste."); } catch (e) { toast("Photo saved."); }
}
async function shrinkPhoto(f) { const bm = await createImageBitmap(f), k = Math.min(1, 1280 / Math.max(bm.width, bm.height)), c = document.createElement("canvas"); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k); c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height); return await new Promise(r => c.toBlob(b => r(b || f), "image/jpeg", 0.8)); }

$("#sheetBtn").onclick = openSheet; $("#fleetBtn").onclick = fleetCsv; $("#scanShare").onclick = shareOdo;
