// MileMark reminder rules. Shared by the app, the service worker and the tests.
(function (g) {
  const DAY = 864e5, WEEK = 7 * DAY, fm = n => Math.round(n).toLocaleString();
  const estOf = v => Math.max(v.anchorOdo, Math.round(v.anchorOdo + v.rate * (g.__now - v.anchorAt) / DAY));
  // sum: { vehicles:[{id,name,rate,anchorOdo,anchorAt,items:[{id,name,due,win,tdue}]}], odo:{vid,name,lastAt}|null }
  // Returns { fire:[{tag,title,body,odo?}], notified }. Each milestone fires once per service cycle (the key holds the due mileage,
  // so logging Done starts a fresh cycle). Overdue repeats daily until Done.
  function plan(sum, notified, now) {
    g.__now = now; const n = { ...notified }, fire = [];
    for (const k in n) if (now - n[k] > 150 * DAY && !/^rc\|/.test(k)) delete n[k];
    for (const v of sum.vehicles) { const e = estOf(v), nm = v.name;
      for (const x of v.items) {
        const r = x.due - e, k = v.id + "|" + x.id + "|" + x.due + "|" + (x.cyc ? x.cyc + "|" : ""); // a part reset adds its own stamp, so it always starts a fresh cycle
        const L = -r > x.win ? 4 : (r <= 0 || x.tdue) ? 3 : r <= 100 ? 2 : r <= 500 ? 1 : 0;
        if (!L) continue;
        const names = ["", "l500", "l100", "due", "over"];
        const seen = i => n[k + names[i]];
        let go = false;
        if (L === 4) go = !seen(4) || now - seen(4) >= DAY; else go = !seen(L);
        for (let i = 1; i <= L; i++) if (!seen(i) || i === L) { if (i === L ? go : true) n[k + names[i]] = now; }
        if (!go) continue;
        const body = L === 1 ? `Due in about 500 miles (est. ${fm(e)} mi now)` : L === 2 ? `Due in about 100 miles (est. ${fm(e)} mi now)`
          : L === 3 ? `Due now at ~${fm(x.due)} mi (est. ${fm(e)} mi)` : `Overdue by about ${fm(e - x.due)} mi. Tap Done once it's serviced.`;
        fire.push({ tag: k + names[L], title: `${nm}: ${x.name}`, body });
      }
    }
    fire.push(...renewals(sum, n, now));
    const o = sum.odo;
    if (o) { const k = "odo|" + o.vid;
      if (!n[k]) n[k] = now;
      else if (now - n[k] >= WEEK && now - (o.lastAt || 0) >= WEEK) { n[k] = now; fire.push({ tag: k, title: "What's your odometer?", body: o.name, odo: o.vid }); } }
    return { fire, notified: n };
  }

  // Renewals: sum.renew = [{vid,id,label,date:"YYYY-MM-DD",mi?}] ; 30 and 7 days before, on the date, daily after until Renewed.
  // Warranty mileage (mi) uses the same 500 / 100 / reached steps as services, once each.
  function renewals(sum, n, now) {
    const fire = [], T = new Date(now), t0 = new Date(T.getFullYear(), T.getMonth(), T.getDate()).getTime();
    for (const r of sum.renew || []) { const v = sum.vehicles.find(x => x.id === r.vid); if (!v) continue;
      const p = (r.date || "").split("-").map(Number); if (p.length === 3 && p[0]) {
        const d = Math.round((new Date(p[0], p[1] - 1, p[2]).getTime() - t0) / DAY), k = "ren|" + r.vid + "|" + r.id + "|" + r.date + "|", nm = ["", "d30", "d7", "due", "over"];
        const L = d < 0 ? 4 : d === 0 ? 3 : d <= 7 ? 2 : d <= 30 ? 1 : 0;
        if (L) { const seen = i => n[k + nm[i]]; let go = L === 4 ? (!seen(4) || now - seen(4) >= DAY) : !seen(L);
          for (let i = 1; i <= L; i++) if (!seen(i) || i === L) { if (i === L ? go : true) n[k + nm[i]] = now; }
          if (go) fire.push({ tag: k + nm[L], title: `${v.name}: ${r.label}`, body: L === 1 ? `Ends in ${d} days (${r.date}). Tap Renewed once it's done.` : L === 2 ? `Ends in ${d} day${d === 1 ? "" : "s"} (${r.date}). Tap Renewed once it's done.` : L === 3 ? `Ends today (${r.date}). Tap Renewed once it's done.` : `Ended ${-d} day${d === -1 ? "" : "s"} ago (${r.date}). Tap Renewed once it's done.`, ren: 1 }); } }
      if (r.mi) { const e = estOf(v), rem = r.mi - e, k = "renmi|" + r.vid + "|" + r.id + "|" + r.mi + "|", L = rem <= 0 ? 3 : rem <= 100 ? 2 : rem <= 500 ? 1 : 0;
        if (L) { const nm = ["", "l500", "l100", "end"]; let go = !n[k + nm[L]];
          for (let i = 1; i <= L; i++) if (!n[k + nm[i]]) n[k + nm[i]] = now;
          if (go) fire.push({ tag: k + nm[L], title: `${v.name}: ${r.label}`, body: L === 3 ? `Reached ${fm(r.mi)} mi (est. ${fm(e)} mi now).` : `Ends in about ${L === 1 ? 500 : 100} miles, at ${fm(r.mi)} mi.`, ren: 1 }); } } }
    return fire;
  }
  // Recalls: sum.recalls = [{vid,name,ids:[{id,comp}]}] for the vehicles just fetched. The first fetch for a vehicle is recorded silently.
  function recalls(list, n, now) {
    const fire = []; for (const r of list || []) { const init = "rc|" + r.vid + "|init";
      if (!n[init]) { n[init] = now; r.ids.forEach(x => n["rc|" + r.vid + "|" + x.id] = now); continue; }
      for (const x of r.ids) { const k = "rc|" + r.vid + "|" + x.id; if (!n[k]) { n[k] = now; fire.push({ tag: k, title: `${r.name}: new recall`, body: x.comp || "A new safety recall was issued for your model year.", rc: r.vid }); } } }
    return fire;
  }
  const api = { plan, renewals, recalls };
  if (typeof module !== "undefined") module.exports = api; else g.MMNotify = api;
})(typeof self !== "undefined" ? self : globalThis);
