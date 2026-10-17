// MileMark reminder rules. Shared by the app, the service worker and the tests.
(function (g) {
  const DAY = 864e5, WEEK = 7 * DAY, fm = n => Math.round(n).toLocaleString();
  const estOf = v => Math.max(v.anchorOdo, Math.round(v.anchorOdo + v.rate * (g.__now - v.anchorAt) / DAY));
  // sum: { vehicles:[{id,name,rate,anchorOdo,anchorAt,items:[{id,name,due,win,tdue}]}], odo:{vid,name,lastAt}|null }
  // Returns { fire:[{tag,title,body,odo?}], notified }. Each milestone fires once per service cycle (the key holds the due mileage,
  // so logging Done starts a fresh cycle). Overdue repeats daily until Done.
  function plan(sum, notified, now) {
    g.__now = now; const n = { ...notified }, fire = [];
    for (const k in n) if (now - n[k] > 150 * DAY) delete n[k];
    for (const v of sum.vehicles) { const e = estOf(v), nm = v.name;
      for (const x of v.items) {
        const r = x.due - e, k = v.id + "|" + x.id + "|" + x.due + "|";
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
    const o = sum.odo;
    if (o) { const k = "odo|" + o.vid;
      if (!n[k]) n[k] = now;
      else if (now - n[k] >= WEEK && now - (o.lastAt || 0) >= WEEK) { n[k] = now; fire.push({ tag: k, title: "What's your odometer?", body: o.name, odo: o.vid }); } }
    return { fire, notified: n };
  }
  const api = { plan };
  if (typeof module !== "undefined") module.exports = api; else g.MMNotify = api;
})(typeof self !== "undefined" ? self : globalThis);
