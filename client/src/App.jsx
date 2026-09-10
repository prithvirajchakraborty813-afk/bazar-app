import React, { useState, useEffect } from "react";
import { queueItem, syncQueuedItems, getQueuedItems } from "./offlineQueue.js";

const API = "https://bazar-app-9yxf.onrender.com/api";

// Tracks browser connectivity and, on reconnect, flushes any item-adds that
// were queued while offline. Any admin component can use this to know
// whether it's safe to hit the network right now.
function useOnlineSync(headers) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = () => getQueuedItems().then((q) => setPendingCount(q.length));

  const trySync = async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    await syncQueuedItems(API, headers);
    await refreshPending();
    setSyncing(false);
  };

  useEffect(() => {
    refreshPending();
    const goOnline = () => { setOnline(true); trySync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) trySync();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { online, pendingCount, syncing, trySync, refreshPending };
}

// Polls the no-auth budget-status endpoint so both roles (General has no
// password to call the admin-only /api/budgets) see when any limit is
// crossed, on every screen - not just the Budgets tab. Mounted once near the
// top of the app shell in both AdminView and GeneralView.
function useOverBudgets() {
  const [overBudgets, setOverBudgets] = useState([]);

  const check = () => {
    fetch(`${API}/budgets/status`)
      .then((res) => (res.ok ? res.json() : []))
      .then((all) => setOverBudgets(all.filter((b) => b.over)))
      .catch(() => {});
  };

  useEffect(() => {
    check();
    const id = setInterval(check, 60000); // recheck every minute while the app is open
    return () => clearInterval(id);
  }, []);

  return { overBudgets, recheck: check };
}

function GlobalBudgetAlert({ overBudgets }) {
  const [dismissed, setDismissed] = useState({}); // budgetId -> true, cleared on reload
  const [advice, setAdvice] = useState({}); // budgetId -> text

  const visible = overBudgets.filter((b) => !dismissed[b.id]);
  if (visible.length === 0) return null;

  const fmt = (n) => Number(n).toFixed(2).replace(/\.00$/, "");

  const getAdvice = async (b) => {
    setAdvice((a) => ({ ...a, [b.id]: "Thinking..." }));
    try {
      const res = await fetch(`${API}/budget-advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: b.label, amount: b.amount, spent: b.spent, cycleDays: b.cycleDays }),
      });
      const d = await res.json();
      setAdvice((a) => ({ ...a, [b.id]: d.advice || d.error || "No advice available." }));
    } catch {
      setAdvice((a) => ({ ...a, [b.id]: "Could not reach the advice service." }));
    }
  };

  return (
    <div style={{ padding: "10px 20px 0" }}>
      {visible.map((b) => (
        <div key={b.id} style={{ background: "#fbeee9", border: "1px solid #f0cdc0", borderRadius: "4px", padding: "10px 12px", marginBottom: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "13px", fontWeight: "600", color: "#9a4a3a" }}>
                Over budget: {b.label}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#9a4a3a" }}>
                Spent {fmt(b.spent)} of {fmt(b.amount)} limit ({b.cycleDays}-day cycle)
              </p>
            </div>
            <button onClick={() => setDismissed((d) => ({ ...d, [b.id]: true }))} style={{ ...ghostBtn, borderColor: "#f0cdc0", color: "#9a4a3a", flexShrink: 0 }}>
              Dismiss
            </button>
          </div>
          {!advice[b.id] && (
            <button onClick={() => getAdvice(b)} style={{ ...ghostBtn, marginTop: "8px", borderColor: "#f0cdc0", color: "#9a4a3a" }}>
              Get AI tips to lower this budget
            </button>
          )}
          {advice[b.id] && (
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#7a4438", whiteSpace: "pre-line" }}>{advice[b.id]}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Login({ onLogin }) {
  const [role, setRole] = useState("general");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Login failed.");
        return;
      }
      onLogin(data.role, pass);
    } catch {
      setErr("Could not reach the server. Is it running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "560px", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f3ec" }}>
      <form onSubmit={submit} style={{ width: "300px", background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "32px 28px" }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "0 0 4px", color: "#2a2a26" }}>Bazar</h1>
        <p style={{ fontSize: "13px", color: "#8a8477", margin: "0 0 24px" }}>Sign in to continue</p>

        <div style={{ display: "flex", marginBottom: "20px", border: "1px solid #ddd6c4", borderRadius: "3px", overflow: "hidden" }}>
          {["general", "admin"].map((r) => (
            <button
              type="button"
              key={r}
              onClick={() => setRole(r)}
              style={{
                flex: 1,
                padding: "9px 0",
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
                background: role === r ? "#3d3a2f" : "transparent",
                color: role === r ? "#fff" : "#6b6659",
                textTransform: "capitalize",
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {role === "admin" && (
          <>
            <label style={{ display: "block", fontSize: "12px", color: "#6b6659", marginBottom: "5px" }}>Password</label>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              style={{ width: "100%", padding: "9px 10px", marginBottom: "14px", border: "1px solid #ddd6c4", borderRadius: "3px", fontSize: "14px", boxSizing: "border-box" }}
            />
          </>
        )}

        {err && <p style={{ fontSize: "12px", color: "#b0473f", margin: "0 0 14px" }}>{err}</p>}

        <button type="submit" disabled={busy} style={{ width: "100%", padding: "10px 0", background: "#3d3a2f", color: "#fff", border: "none", borderRadius: "3px", fontSize: "14px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Checking..." : `Enter as ${role}`}
        </button>
      </form>
    </div>
  );
}

function useCatalog() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const res = await fetch(`${API}/catalog`);
    setData(await res.json());
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);
  return { data, loading, reload };
}

function GeneralView({ onLogout }) {
  const { data, loading, reload } = useCatalog();
  const [openCat, setOpenCat] = useState(null);
  const [openSub, setOpenSub] = useState(null);
  const { overBudgets } = useOverBudgets();

  return (
    <div style={{ minHeight: "560px", background: "#f6f3ec" }}>
      <Header title="Explore" onLogout={onLogout} onRefresh={reload} />
      <GlobalBudgetAlert overBudgets={overBudgets} />
      <div style={{ padding: "16px 20px" }}>
        {loading && <Empty text="Loading..." />}
        {!loading && data.length === 0 && <Empty text="Nothing to browse yet." />}
        {data.map((cat) => (
          <div key={cat.id} style={{ marginBottom: "10px" }}>
            <button onClick={() => { setOpenCat(openCat === cat.id ? null : cat.id); setOpenSub(null); }} style={rowStyle(openCat === cat.id)}>
              <span>{cat.name}</span>
              <span style={{ color: "#a39d8a" }}>{openCat === cat.id ? "\u2212" : "+"}</span>
            </button>
            {openCat === cat.id && (
              <div style={{ paddingLeft: "14px", marginTop: "6px" }}>
                {cat.subs.length === 0 && <Empty text="No subcategories yet." small />}
                {cat.subs.map((sub) => (
                  <div key={sub.id} style={{ marginBottom: "8px" }}>
                    <button onClick={() => setOpenSub(openSub === sub.id ? null : sub.id)} style={rowStyle(openSub === sub.id, true)}>
                      <span>{sub.name}</span>
                      <span style={{ color: "#a39d8a" }}>{openSub === sub.id ? "\u2212" : "+"}</span>
                    </button>
                    {openSub === sub.id && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "8px", marginTop: "8px", paddingLeft: "10px" }}>
                        {sub.items.length === 0 && <Empty text="No items yet." small />}
                        {sub.items.map((item) => (
                          <div key={item.id} style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "10px" }}>
                            {item.img ? (
                              <img src={item.img} alt={item.name} style={{ width: "100%", height: "70px", objectFit: "cover", borderRadius: "3px", marginBottom: "6px" }} />
                            ) : (
                              <div style={{ width: "100%", height: "70px", background: "#f1ede1", borderRadius: "3px", marginBottom: "6px" }} />
                            )}
                            <p style={{ margin: "0 0 2px", fontSize: "13px", fontWeight: "600", color: "#2a2a26" }}>{item.name}</p>
                            <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#8a8477" }}>{item.desc}</p>
                            <p style={{ margin: 0, fontSize: "13px", color: "#3d3a2f", fontWeight: "600" }}>Price: {item.price}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendingPanel({ password, reloadKey }) {
  const [summary, setSummary] = useState(null);
  const [showDaily, setShowDaily] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [range, setRange] = useState("3m");
  const [entries, setEntries] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const headers = { "x-admin-password": password };

  const fetchEntries = (r, o) =>
    fetch(`${API}/spend-summary?range=${r}&offset=${o}`, { headers })
      .then((res) => (res.ok ? res.json() : null));

  useEffect(() => {
    fetchEntries(range, 0).then((data) => {
      if (!data) return;
      setSummary(data);
      setEntries(data.entries);
      setOffset(0);
      setHasMore(data.hasMore);
    });
  }, [password, reloadKey, range]);

  const loadMore = async () => {
    setLoadingMore(true);
    const data = await fetchEntries(range, offset + 100);
    if (data) {
      setEntries((prev) => [...prev, ...data.entries]);
      setOffset(offset + 100);
      setHasMore(data.hasMore);
    }
    setLoadingMore(false);
  };

  if (!summary) return null;

  const fmt = (n) => Number(n).toFixed(2).replace(/\.00$/, "");
  const fmtDateTime = (ts) =>
    new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "12px 14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#8a8477" }}>Spending summary (based on when items were added)</p>
      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: "11px", color: "#a39d8a" }}>Today</p>
          <p style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#2a2a26" }}>{fmt(summary.today)}</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: "11px", color: "#a39d8a" }}>This month</p>
          <p style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#2a2a26" }}>{fmt(summary.thisMonth)}</p>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: "11px", color: "#a39d8a" }}>Last 3 months</p>
          <p style={{ margin: 0, fontSize: "15px", fontWeight: "600", color: "#2a2a26" }}>{fmt(summary.last3Months)}</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "14px", marginTop: "10px" }}>
        <button
          onClick={() => setShowDaily(!showDaily)}
          style={{ background: "none", border: "none", color: "#6b6659", fontSize: "11px", padding: 0, cursor: "pointer", textDecoration: "underline" }}
        >
          {showDaily ? "Hide" : "Show"} last 30 days by day
        </button>
        <button
          onClick={() => setShowLog(!showLog)}
          style={{ background: "none", border: "none", color: "#6b6659", fontSize: "11px", padding: 0, cursor: "pointer", textDecoration: "underline" }}
        >
          {showLog ? "Hide" : "Show"} date/time log
        </button>
      </div>

      {showDaily && (
        <div style={{ marginTop: "8px", maxHeight: "160px", overflowY: "auto", borderTop: "1px solid #f1ede1", paddingTop: "6px" }}>
          {summary.daily.length === 0 && <p style={{ fontSize: "12px", color: "#a39d8a", margin: 0 }}>No items added in the last 30 days.</p>}
          {summary.daily.map((d) => (
            <div key={d.day} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#3d3a2f", padding: "2px 0" }}>
              <span>{new Date(d.day).toLocaleDateString()}</span>
              <span>{fmt(d.total)}</span>
            </div>
          ))}
        </div>
      )}

      {showLog && (
        <div style={{ marginTop: "8px", borderTop: "1px solid #f1ede1", paddingTop: "8px" }}>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={{ ...inputStyle, marginBottom: "8px", width: "auto", fontSize: "12px" }}>
            <option value="30d">Last 30 days</option>
            <option value="3m">Last 3 months</option>
            <option value="6m">Last 6 months</option>
            <option value="1y">Last 1 year</option>
            <option value="all">All time</option>
          </select>

          <div style={{ maxHeight: "220px", overflowY: "auto" }}>
            {entries.length === 0 && <p style={{ fontSize: "12px", color: "#a39d8a", margin: 0 }}>No items added in this range.</p>}
            {entries.map((e, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "12px", color: "#3d3a2f", padding: "3px 0", borderBottom: "1px solid #f8f5ec" }}>
                <span style={{ color: "#8a8477", flexShrink: 0 }}>{fmtDateTime(e.createdAt)}</span>
                <span style={{ flex: 1, textAlign: "right" }}>
                  {e.name} <span style={{ color: "#a39d8a" }}>({e.category} / {e.subcategory})</span>
                </span>
                <span style={{ flexShrink: 0, fontWeight: "600" }}>{fmt(e.price)}</span>
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{ background: "none", border: "none", color: "#6b6659", fontSize: "11px", padding: "8px 0 0", cursor: "pointer", textDecoration: "underline" }}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Flattened list of { type: 'category'|'subcategory', id, name, path } for
// picking which node a report or budget applies to.
function flattenScopes(data) {
  const scopes = [];
  for (const cat of data) {
    scopes.push({ type: "category", id: cat.id, name: cat.name, path: cat.name });
    for (const sub of cat.subs) {
      scopes.push({ type: "subcategory", id: sub.id, name: sub.name, path: `${cat.name} / ${sub.name}` });
    }
  }
  return scopes;
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function DateRangePicker({ from, to, onChange }) {
  const presets = [
    ["7d", "7 days", -7],
    ["30d", "30 days", -30],
    ["90d", "90 days", -90],
    ["365d", "1 year", -365],
  ];
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" }}>
      {presets.map(([key, label, offset]) => (
        <button key={key} onClick={() => onChange(todayISO(offset), todayISO())} style={ghostBtn}>{label}</button>
      ))}
      <span style={{ fontSize: "12px", color: "#a39d8a" }}>|</span>
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} style={{ ...inputStyle, flex: "none", width: "130px" }} />
      <span style={{ fontSize: "12px", color: "#a39d8a" }}>to</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} style={{ ...inputStyle, flex: "none", width: "130px" }} />
    </div>
  );
}

function exportReportPDF(report, scopeLabel, from, to, fmt) {
  const rows = (arr, cols) =>
    arr.map((r) => `<tr>${cols.map((c) => `<td>${c(r)}</td>`).join("")}</tr>`).join("");

  const html = `
    <html><head><title>Spending report - ${scopeLabel}</title>
    <style>
      body { font-family: Georgia, serif; color: #2a2a26; padding: 24px; }
      h1 { font-size: 20px; margin-bottom: 2px; }
      .sub { color: #8a8477; font-size: 12px; margin-bottom: 18px; }
      .totals { display: flex; gap: 28px; margin-bottom: 20px; }
      .totals div p:first-child { font-size: 11px; color: #8a8477; margin: 0; }
      .totals div p:last-child { font-size: 18px; font-weight: 600; margin: 0; }
      h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      td { padding: 3px 0; }
      td:last-child { text-align: right; }
      .empty { font-size: 12px; color: #a39d8a; }
      @media print { body { padding: 0; } }
    </style></head><body>
      <h1>Spending report</h1>
      <p class="sub">${scopeLabel} &middot; ${from} to ${to}</p>
      <div class="totals">
        <div><p>Total spent</p><p>${fmt(report.total)}</p></div>
        <div><p>Items bought</p><p>${report.count}</p></div>
      </div>
      ${report.byChild.length ? `<h2>Breakdown</h2><table>${rows(report.byChild, [(c) => `${c.name} (${c.count})`, (c) => fmt(c.total)])}</table>` : ""}
      <h2>Bought more than once</h2>
      ${report.repeats.length ? `<table>${rows(report.repeats, [(r) => `${r.name} \u00d7${r.count}`, (r) => `${fmt(r.total)} total`])}</table>` : `<p class="empty">Nothing repeated in this range.</p>`}
      <h2>Price increases</h2>
      ${report.priceRises.length ? `<table>${rows(report.priceRises, [(r) => `${r.name}: ${r.from} \u2192 ${r.to}`, (r) => `+${fmt(r.delta)}`])}</table>` : `<p class="empty">No price rises logged in this range.</p>`}
    </body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Your browser blocked the print window. Please allow pop-ups for this site and try again.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onload = () => win.print();
}

function ReportsPanel({ password, data }) {
  const scopes = flattenScopes(data);
  const [scopeKey, setScopeKey] = useState("global");
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const headers = { "x-admin-password": password };

  useEffect(() => {
    setLoading(true);
    setError(null);
    const url =
      scopeKey === "global"
        ? `${API}/report?from=${from}&to=${to}`
        : `${API}/report/${scopeKey}?from=${from}&to=${to}`;
    fetch(url, { headers })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Server said ${res.status}${body ? `: ${body}` : ""}`);
        }
        return res.json();
      })
      .then((d) => { setReport(d); setLoading(false); })
      .catch((err) => { setError(err.message || "Could not load report."); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, from, to, password]);

  const fmt = (n) => Number(n).toFixed(2).replace(/\.00$/, "");

  return (
    <div style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#8a8477" }}>Status report</p>

      <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} style={{ ...inputStyle, marginBottom: "10px", width: "100%" }}>
        <option value="global">All categories</option>
        {scopes.map((s) => (
          <option key={`${s.type}:${s.id}`} value={`${s.type}/${s.id}`}>{s.path}</option>
        ))}
      </select>

      <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />

      {loading && <Empty text="Loading report..." />}
      {error && !loading && (
        <p style={{ fontSize: "12px", color: "#b0473f", background: "#fbeee9", border: "1px solid #f0cdc0", borderRadius: "4px", padding: "8px 10px" }}>
          Couldn't load this report: {error}
        </p>
      )}

      {!loading && report && (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
            <button
              onClick={() => exportReportPDF(report, scopeKey === "global" ? "All categories" : scopes.find((s) => `${s.type}/${s.id}` === scopeKey)?.path || "", from, to, fmt)}
              style={ghostBtn}
            >
              Export / Print PDF
            </button>
          </div>

          <div style={{ display: "flex", gap: "18px", marginBottom: "12px" }}>
            <div>
              <p style={{ margin: 0, fontSize: "11px", color: "#a39d8a" }}>Total spent</p>
              <p style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "#2a2a26" }}>{fmt(report.total)}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: "11px", color: "#a39d8a" }}>Items bought</p>
              <p style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "#2a2a26" }}>{report.count}</p>
            </div>
          </div>

          {report.byChild.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: "600", color: "#3d3a2f" }}>Breakdown</p>
              {report.byChild.map((c, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#3d3a2f", padding: "2px 0" }}>
                  <span>{c.name} ({c.count})</span>
                  <span>{fmt(c.total)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: "12px" }}>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: "600", color: "#3d3a2f" }}>Bought more than once</p>
            {report.repeats.length === 0 && <p style={{ fontSize: "12px", color: "#a39d8a", margin: 0 }}>Nothing repeated in this range.</p>}
            {report.repeats.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#3d3a2f", padding: "2px 0" }}>
                <span>{r.name} ×{r.count}</span>
                <span>{fmt(r.total)} total</span>
              </div>
            ))}
          </div>

          <div>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: "600", color: "#3d3a2f" }}>Price increases</p>
            {report.priceRises.length === 0 && <p style={{ fontSize: "12px", color: "#a39d8a", margin: 0 }}>No price rises logged in this range.</p>}
            {report.priceRises.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#b0473f", padding: "2px 0" }}>
                <span>{r.name}: {r.from} → {r.to}</span>
                <span>+{fmt(r.delta)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BudgetsPanel({ password, data }) {
  const scopes = flattenScopes(data);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scopeKey, setScopeKey] = useState("global");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cycleDays, setCycleDays] = useState(30);
  const [advice, setAdvice] = useState({}); // budgetId -> text

  const headers = { "Content-Type": "application/json", "x-admin-password": password };

  const load = () => {
    setLoading(true);
    fetch(`${API}/budgets`, { headers })
      .then((res) => (res.ok ? res.json() : []))
      .then((d) => { setBudgets(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(load, [password]);

  const saveBudget = async () => {
    if (!label.trim() || !amount) return;
    const [type, id] = scopeKey === "global" ? ["global", null] : scopeKey.split("/");
    await fetch(`${API}/budgets`, {
      method: "POST",
      headers,
      body: JSON.stringify({ scope: type, scopeId: id, label: label.trim(), amount: Number(amount), cycleDays: Number(cycleDays) }),
    });
    setLabel(""); setAmount("");
    load();
  };

  const removeBudget = async (id) => {
    await fetch(`${API}/budgets/${id}`, { method: "DELETE", headers });
    load();
  };

  const getAdvice = async (b) => {
    setAdvice((a) => ({ ...a, [b.id]: "Thinking..." }));
    const res = await fetch(`${API}/budget-advice`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label: b.label, amount: b.amount, spent: b.spent, cycleDays: b.cycleDays }),
    });
    const d = await res.json();
    setAdvice((a) => ({ ...a, [b.id]: d.advice || d.error || "No advice available." }));
  };

  const fmt = (n) => Number(n).toFixed(2).replace(/\.00$/, "");

  return (
    <div style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 10px", fontSize: "12px", color: "#8a8477" }}>Spending limits</p>

      {loading && <Empty text="Loading budgets..." />}
      {!loading && budgets.length === 0 && <Empty text="No budgets set yet." small />}

      {budgets.map((b) => {
        const pct = Math.min(100, (b.spent / b.amount) * 100);
        return (
          <div key={b.id} style={{ marginBottom: "12px", padding: "10px", background: b.over ? "#fbeee9" : "#faf8f2", border: `1px solid ${b.over ? "#f0cdc0" : "#eee8d8"}`, borderRadius: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#2a2a26" }}>{b.label}</span>
              <button onClick={() => removeBudget(b.id)} style={ghostDanger}>Remove</button>
            </div>
            <p style={{ margin: "0 0 6px", fontSize: "11px", color: "#8a8477" }}>
              {fmt(b.spent)} of {fmt(b.amount)} · {b.cycleDays}-day cycle · resets {new Date(b.cycleEnd).toLocaleDateString()}
            </p>
            <div style={{ height: "6px", background: "#eee8d8", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: b.over ? "#b0473f" : "#3d3a2f" }} />
            </div>
            {b.over && (
              <div style={{ marginTop: "8px" }}>
                <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#b0473f", fontWeight: "600" }}>Over budget</p>
                {!advice[b.id] && <button onClick={() => getAdvice(b)} style={ghostBtn}>Get AI suggestions</button>}
                {advice[b.id] && <p style={{ margin: 0, fontSize: "12px", color: "#6b6659", whiteSpace: "pre-line" }}>{advice[b.id]}</p>}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px dashed #ddd6c4" }}>
        <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#8a8477" }}>New budget</p>
        <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} style={{ ...inputStyle, marginBottom: "6px", width: "100%" }}>
          <option value="global">All categories</option>
          {scopes.map((s) => (
            <option key={`${s.type}:${s.id}`} value={`${s.type}/${s.id}`}>{s.path}</option>
          ))}
        </select>
        <input placeholder="Label (e.g. Family groceries)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, marginBottom: "6px" }} />
        <input placeholder="Amount (e.g. 5000)" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, marginBottom: "6px" }} />
        <label style={{ display: "block", fontSize: "12px", color: "#6b6659", marginBottom: "4px" }}>
          Cycle length: {cycleDays} day{cycleDays > 1 ? "s" : ""}
        </label>
        <input
          type="range" min="1" max="365" value={cycleDays}
          onChange={(e) => setCycleDays(e.target.value)}
          style={{ width: "100%", marginBottom: "10px" }}
        />
        <button onClick={saveBudget} style={primaryBtn}>Save budget</button>
      </div>
    </div>
  );
}

function VoicePanel({ password, onApplied }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [supported, setSupported] = useState(true);
  const mediaRecorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setStatus("");
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        sendRecording();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setStatus("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const sendRecording = async () => {
    setBusy(true);
    setStatus("Transcribing...");
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "command.webm");

      const transcribeRes = await fetch(`${API}/transcribe`, {
        method: "POST",
        headers: { "x-admin-password": password },
        body: formData,
      });
      const transcribeData = await transcribeRes.json();
      if (!transcribeRes.ok) {
        setStatus(transcribeData.error || "Could not transcribe that.");
        return;
      }
      setTranscript(transcribeData.transcript);
      setStatus("Sending to assistant...");

      const res = await fetch(`${API}/voice-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ transcript: transcribeData.transcript }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Command not understood.");
        return;
      }
      setStatus(`Done: ${data.applied.action.replace("_", " ")}`);
      onApplied();
    } catch {
      setStatus("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "12px 14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#8a8477" }}>
        Voice command — try "add item rice price 30 to bazar" or "add subcategory electricity under family"
      </p>
      {!supported && <p style={{ fontSize: "12px", color: "#b0473f", margin: "0 0 8px" }}>Microphone access isn't available in this browser.</p>}
      <button
        onClick={recording ? stopRecording : startRecording}
        disabled={busy || !supported}
        style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, background: recording ? "#b0473f" : "#3d3a2f" }}
      >
        {recording ? "Stop recording" : busy ? "Working..." : "Speak a command"}
      </button>
      {transcript && <p style={{ fontSize: "12px", color: "#6b6659", margin: "8px 0 0" }}>Heard: "{transcript}"</p>}
      {status && <p style={{ fontSize: "12px", color: "#3d3a2f", margin: "4px 0 0" }}>{status}</p>}
    </div>
  );
}

function AdminView({ password, onLogout }) {
  const { data, loading, reload } = useCatalog();
  const [openCat, setOpenCat] = useState(null);
  const [openSub, setOpenSub] = useState(null);
  const [newCat, setNewCat] = useState("");
  const [newSub, setNewSub] = useState({});
  const [itemDraft, setItemDraft] = useState({});
  const [editingItem, setEditingItem] = useState(null);
  const [view, setView] = useState("catalog"); // catalog | reports | budgets

  const headers = { "Content-Type": "application/json", "x-admin-password": password };
  const authHeader = { "x-admin-password": password };
  const { online, pendingCount, syncing, trySync } = useOnlineSync(authHeader);
  const { overBudgets } = useOverBudgets();

  const addCategory = async () => {
    if (!newCat.trim()) return;
    await fetch(`${API}/categories`, { method: "POST", headers, body: JSON.stringify({ name: newCat.trim() }) });
    setNewCat("");
    reload();
  };

  const removeCategory = async (id) => {
    await fetch(`${API}/categories/${id}`, { method: "DELETE", headers });
    reload();
  };

  const addSub = async (categoryId) => {
    const name = (newSub[categoryId] || "").trim();
    if (!name) return;
    await fetch(`${API}/subcategories`, { method: "POST", headers, body: JSON.stringify({ categoryId, name }) });
    setNewSub({ ...newSub, [categoryId]: "" });
    reload();
  };

  const removeSub = async (id) => {
    await fetch(`${API}/subcategories/${id}`, { method: "DELETE", headers });
    reload();
  };

  const draftKey = (catId, subId) => `${catId}:${subId}`;

  const saveItem = async (subcategoryId, key) => {
    const d = itemDraft[key];
    if (!d || !d.name?.trim()) return;

    if (!navigator.onLine && editingItem?.key !== key) {
      // Offline: queue new items locally, apply optimistically isn't possible
      // without a fake id, so just confirm it's queued and reset the form.
      await queueItem({ subcategoryId, ...d });
      setItemDraft({ ...itemDraft, [key]: { name: "", price: "", desc: "", img: "" } });
      setEditingItem(null);
      trySync();
      return;
    }

    if (editingItem?.key === key) {
      await fetch(`${API}/items/${editingItem.id}`, { method: "PUT", headers, body: JSON.stringify(d) });
    } else {
      await fetch(`${API}/items`, { method: "POST", headers, body: JSON.stringify({ subcategoryId, ...d }) });
    }
    setItemDraft({ ...itemDraft, [key]: { name: "", price: "", desc: "", img: "" } });
    setEditingItem(null);
    reload();
  };

  const removeItem = async (id) => {
    await fetch(`${API}/items/${id}`, { method: "DELETE", headers });
    reload();
  };

  const startEdit = (catId, subId, item) => {
    const key = draftKey(catId, subId);
    setItemDraft({ ...itemDraft, [key]: { name: item.name, price: item.price, desc: item.desc, img: item.img } });
    setEditingItem({ key, id: item.id });
    setOpenCat(catId);
    setOpenSub(subId);
  };

  return (
    <div style={{ minHeight: "560px", background: "#f6f3ec" }}>
      <Header title="Admin" onLogout={onLogout} onRefresh={reload} />
      <GlobalBudgetAlert overBudgets={overBudgets} />
      <div style={{ padding: "16px 20px" }}>
        <OfflineBanner online={online} pendingCount={pendingCount} syncing={syncing} />

        <div style={{ display: "flex", marginBottom: "18px", border: "1px solid #ddd6c4", borderRadius: "3px", overflow: "hidden" }}>
          {[["catalog", "Catalog"], ["reports", "Reports"], ["budgets", "Budgets"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: 1, padding: "9px 0", fontSize: "13px", border: "none", cursor: "pointer",
                background: view === v ? "#3d3a2f" : "transparent", color: view === v ? "#fff" : "#6b6659",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "reports" && <ReportsPanel password={password} data={data} />}
        {view === "budgets" && <BudgetsPanel password={password} data={data} />}

        {view === "catalog" && (
        <>
        <SpendingPanel password={password} reloadKey={data} />
        <VoicePanel password={password} onApplied={reload} />

        <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" style={inputStyle} />
          <button onClick={addCategory} style={primaryBtn}>Add category</button>
        </div>

        {loading && <Empty text="Loading..." />}
        {!loading && data.length === 0 && <Empty text="No categories yet. Add one above." />}

        {data.map((cat) => (
          <div key={cat.id} style={{ marginBottom: "10px", border: "1px solid #e3ddcf", borderRadius: "4px", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px" }}>
              <button onClick={() => { setOpenCat(openCat === cat.id ? null : cat.id); setOpenSub(null); }} style={{ background: "none", border: "none", fontSize: "14px", fontWeight: "600", color: "#2a2a26", cursor: "pointer", padding: 0 }}>
                {cat.name}
              </button>
              <button onClick={() => removeCategory(cat.id)} style={ghostDanger}>Remove</button>
            </div>

            {openCat === cat.id && (
              <div style={{ padding: "0 12px 12px", borderTop: "1px solid #f1ede1" }}>
                <div style={{ display: "flex", gap: "8px", margin: "10px 0" }}>
                  <input value={newSub[cat.id] || ""} onChange={(e) => setNewSub({ ...newSub, [cat.id]: e.target.value })} placeholder="New subcategory name" style={inputStyle} />
                  <button onClick={() => addSub(cat.id)} style={primaryBtn}>Add sub</button>
                </div>

                {cat.subs.map((sub) => {
                  const key = draftKey(cat.id, sub.id);
                  const d = itemDraft[key] || { name: "", price: "", desc: "", img: "" };
                  return (
                    <div key={sub.id} style={{ marginBottom: "10px", background: "#faf8f2", border: "1px solid #eee8d8", borderRadius: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px" }}>
                        <button onClick={() => setOpenSub(openSub === sub.id ? null : sub.id)} style={{ background: "none", border: "none", fontSize: "13px", fontWeight: "600", color: "#3d3a2f", cursor: "pointer", padding: 0 }}>
                          {sub.name}
                        </button>
                        <button onClick={() => removeSub(sub.id)} style={ghostDanger}>Remove</button>
                      </div>

                      {openSub === sub.id && (
                        <div style={{ padding: "0 10px 10px" }}>
                          {sub.items.map((item) => (
                            <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #f1ede1", fontSize: "13px" }}>
                              <span style={{ color: "#2a2a26" }}>{item.name} <span style={{ color: "#a39d8a" }}>— Price={item.price}</span></span>
                              <span style={{ display: "flex", gap: "6px" }}>
                                <button onClick={() => startEdit(cat.id, sub.id, item)} style={ghostBtn}>Edit</button>
                                <button onClick={() => removeItem(item.id)} style={ghostDanger}>Remove</button>
                              </span>
                            </div>
                          ))}

                          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed #ddd6c4" }}>
                            <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#8a8477" }}>{editingItem?.key === key ? "Editing item" : "Add item"}</p>
                            <input placeholder="Name" value={d.name} onChange={(e) => setItemDraft({ ...itemDraft, [key]: { ...d, name: e.target.value } })} style={{ ...inputStyle, marginBottom: "6px" }} />
                            <input placeholder="Price" value={d.price} onChange={(e) => setItemDraft({ ...itemDraft, [key]: { ...d, price: e.target.value } })} style={{ ...inputStyle, marginBottom: "6px" }} />
                            <input placeholder="Image URL" value={d.img} onChange={(e) => setItemDraft({ ...itemDraft, [key]: { ...d, img: e.target.value } })} style={{ ...inputStyle, marginBottom: "6px" }} />
                            <textarea placeholder="Description" value={d.desc} onChange={(e) => setItemDraft({ ...itemDraft, [key]: { ...d, desc: e.target.value } })} style={{ ...inputStyle, marginBottom: "6px", minHeight: "50px", resize: "vertical" }} />
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button onClick={() => saveItem(sub.id, key)} style={primaryBtn}>{editingItem?.key === key ? "Save changes" : "Add item"}</button>
                              {editingItem?.key === key && (
                                <button onClick={() => { setEditingItem(null); setItemDraft({ ...itemDraft, [key]: { name: "", price: "", desc: "", img: "" } }); }} style={ghostBtn}>Cancel</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        </>
        )}
      </div>
    </div>
  );
}

function OfflineBanner({ online, pendingCount, syncing }) {
  if (online && pendingCount === 0) return null;
  return (
    <div
      style={{
        padding: "8px 14px", borderRadius: "4px", marginBottom: "14px", fontSize: "12px",
        background: online ? "#eef3e8" : "#fbeee9", color: online ? "#4a6b3a" : "#9a4a3a",
        border: `1px solid ${online ? "#cfe0bd" : "#f0cdc0"}`,
      }}
    >
      {!online && "You're offline \u2014 browsing cached data. Items you add will be saved and sent when you're back online."}
      {online && pendingCount > 0 && (syncing ? "Syncing offline changes..." : `${pendingCount} item${pendingCount > 1 ? "s" : ""} waiting to sync...`)}
    </div>
  );
}

// Captures the browser's install prompt (fires only when the PWA criteria
// are met: served over https, has a manifest + service worker, not already
// installed). Exposes a trigger and whether install is currently offered.
function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(
    window.matchMedia?.("(display-mode: standalone)").matches || false
  );

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return true;
  };

  return { hasNativePrompt: !!deferredPrompt, installed, promptInstall };
}

// Platform-specific manual steps for browsers that never fire
// beforeinstallprompt (iOS Safari, and Android browsers after the native
// prompt has already been dismissed once).
function installInstructions() {
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  if (isIOS) {
    return 'Tap the Share icon in Safari\'s toolbar, then choose "Add to Home Screen".';
  }
  return 'Open the browser menu (\u22ee) and choose "Install app" or "Add to Home screen".';
}

function DownloadAppButton() {
  const { hasNativePrompt, installed, promptInstall } = useInstallPrompt();
  const [showInstructions, setShowInstructions] = useState(false);

  if (installed) return null;

  const handleClick = async () => {
    if (hasNativePrompt) {
      const accepted = await promptInstall();
      if (!accepted) setShowInstructions(true);
      return;
    }
    setShowInstructions(true);
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={handleClick} style={primaryBtn}>Download app</button>
      {showInstructions && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, width: "220px", zIndex: 20,
            background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "12px",
            boxShadow: "0 4px 14px rgba(0,0,0,0.12)", fontSize: "12px", color: "#3d3a2f",
          }}
        >
          <p style={{ margin: "0 0 8px" }}>{installInstructions()}</p>
          <button onClick={() => setShowInstructions(false)} style={{ ...ghostBtn, width: "100%" }}>Got it</button>
        </div>
      )}
    </div>
  );
}

function Header({ title, onLogout, onRefresh }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e3ddcf" }}>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "18px", margin: 0, color: "#2a2a26" }}>{title}</h1>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <DownloadAppButton />
        <button onClick={onRefresh} style={ghostBtn}>Refresh</button>
        <button onClick={onLogout} style={ghostBtn}>Log out</button>
      </div>
    </div>
  );
}

function Empty({ text, small }) {
  return <p style={{ fontSize: small ? "12px" : "13px", color: "#a39d8a", padding: small ? "4px 0" : "10px 0" }}>{text}</p>;
}

const rowStyle = (active, sub) => ({
  width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: sub ? "9px 12px" : "11px 14px", background: active ? "#3d3a2f" : "#fff",
  color: active ? "#fff" : "#2a2a26", border: "1px solid #e3ddcf", borderRadius: "4px",
  fontSize: sub ? "13px" : "14px", fontWeight: "600", cursor: "pointer", boxSizing: "border-box",
});

const inputStyle = { flex: 1, padding: "8px 10px", border: "1px solid #ddd6c4", borderRadius: "3px", fontSize: "13px", boxSizing: "border-box", fontFamily: "inherit" };
const primaryBtn = { padding: "8px 14px", background: "#3d3a2f", color: "#fff", border: "none", borderRadius: "3px", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" };
const ghostBtn = { padding: "5px 10px", background: "none", border: "1px solid #ddd6c4", borderRadius: "3px", fontSize: "12px", color: "#6b6659", cursor: "pointer" };
const ghostDanger = { ...ghostBtn, color: "#b0473f", borderColor: "#e8cfca" };

export default function App() {
  const [role, setRole] = useState(null);
  const [adminPass, setAdminPass] = useState("");

  if (!role) return <Login onLogin={(r, pass) => { setRole(r); setAdminPass(pass); }} />;
  if (role === "admin") return <AdminView password={adminPass} onLogout={() => setRole(null)} />;
  return <GeneralView onLogout={() => setRole(null)} />;
}
