import React, { useState, useEffect, useCallback } from "react";
import { queueItemMutation, queuedItemMutationCount, replayItemMutations } from "./offlineQueue";

const API = import.meta.env.VITE_API_URL || "https://bazar-app-9yxf.onrender.com/api";

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
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/catalog`);
      if (!res.ok) throw new Error("Could not load catalog.");
      setData(await res.json());
      setError("");
    } catch {
      setError("Catalog is unavailable until you reconnect. Previously opened data remains available offline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

function GeneralView({ onLogout }) {
  const { data, loading, reload } = useCatalog();
  const [openCat, setOpenCat] = useState(null);
  const [openSub, setOpenSub] = useState(null);

  return (
    <div style={{ minHeight: "560px", background: "#f6f3ec" }}>
      <Header title="Explore" onLogout={onLogout} onRefresh={reload} />
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

  const fmt = (n) => `Price=${Number(n).toFixed(2).replace(/\.00$/, "")}`;
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

const money = (value) => `₹${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const dateInput = (date) => date.toISOString().slice(0, 10);
const daysAgo = (days) => dateInput(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

function reportScopes(catalog) {
  return [
    { value: "global", label: "All spending" },
    ...catalog.flatMap((category) => [
      { value: `category:${category.id}`, label: `Category — ${category.name}` },
      ...category.subs.map((subcategory) => ({
        value: `subcategory:${subcategory.id}`,
        label: `Subcategory — ${category.name} / ${subcategory.name}`,
      })),
    ]),
  ];
}

function ReportsPanel({ password, catalog }) {
  const [scopeKey, setScopeKey] = useState("global");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(dateInput(new Date()));
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const scopes = reportScopes(catalog);

  useEffect(() => {
    const [scope, id] = scopeKey.split(":");
    const query = new URLSearchParams({ scope, from, to });
    if (id) query.set("id", id);
    let active = true;
    setLoading(true);
    fetch(`${API}/reports?${query}`, { headers: { "x-admin-password": password } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load report.");
        if (active) { setReport(data); setError(""); }
      })
      .catch((err) => active && setError(err.message || "Could not load report."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [password, scopeKey, from, to]);

  const setPreset = (days) => {
    setFrom(daysAgo(days - 1));
    setTo(dateInput(new Date()));
  };

  return (
    <section>
      <SectionTitle title="Status reports" subtitle="Choose any category, subcategory, or all spending and set your own dates." />
      <div style={panelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.6fr) minmax(130px, 1fr) minmax(130px, 1fr)", gap: "8px", alignItems: "end" }}>
          <label style={fieldLabel}>Report scope
            <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} style={inputStyle}>
              {scopes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={inputStyle} /></label>
          <label style={fieldLabel}>To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={inputStyle} /></label>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
          {[7, 30, 90, 180].map((days) => <button key={days} onClick={() => setPreset(days)} style={ghostBtn}>Last {days} days</button>)}
        </div>

        {loading && <Empty text="Loading report..." small />}
        {error && <p style={errorStyle}>{error}</p>}
        {report && !loading && (
          <div style={{ marginTop: "14px" }}>
            <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", paddingBottom: "12px", borderBottom: "1px solid #f1ede1" }}>
              <Metric label="Total spent" value={money(report.total)} />
              <Metric label="Purchases" value={report.purchaseCount} />
              <Metric label="Average / day" value={money(report.averagePerDay)} />
              <Metric label="Time frame" value={`${report.days} days`} />
            </div>
            <ReportList title={report.scope === "subcategory" ? "Items in this subcategory" : "Spending breakdown"} empty="No purchases in this time frame." rows={report.breakdown} render={(row) => <><span>{row.name} <small style={mutedStyle}>{row.purchases} purchase{row.purchases === 1 ? "" : "s"}</small></span><strong>{money(row.spend)}</strong></>} />
            <ReportList title="Bought multiple times" empty="No item was bought more than once in this time frame." rows={report.repeatedItems} render={(row) => <><span>{row.name} <small style={mutedStyle}>{row.purchases} times · {row.category} / {row.subcategory}</small></span><strong>{money(row.spend)}</strong></>} />
            <ReportList title="Price increases" empty="No price increases were recorded in this time frame." rows={report.priceIncreases} render={(row) => <><span>{row.name} <small style={mutedStyle}>{row.source} · {new Date(row.changedAt).toLocaleDateString()}</small></span><strong>{money(row.oldAmount)} → {money(row.newAmount)} <span style={{ color: "#b0473f" }}>+{money(row.increase)}</span></strong></>} />
          </div>
        )}
      </div>
    </section>
  );
}

function ReportList({ title, empty, rows, render }) {
  return (
    <div style={{ marginTop: "16px" }}>
      <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#6b6659", fontWeight: "600" }}>{title}</p>
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: "12px", color: "#a39d8a" }}>{empty}</p> : (
        <div style={{ maxHeight: "180px", overflowY: "auto", borderTop: "1px solid #f1ede1" }}>
          {rows.map((row, index) => <div key={`${row.name}-${index}`} style={reportRowStyle}>{render(row)}</div>)}
        </div>
      )}
    </div>
  );
}

function BudgetsPanel({ password, catalog, reloadKey }) {
  const [budgets, setBudgets] = useState([]);
  const [scopeKey, setScopeKey] = useState("global");
  const [amount, setAmount] = useState("");
  const [periodDays, setPeriodDays] = useState(30);
  const [startDate, setStartDate] = useState(dateInput(new Date()));
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [advice, setAdvice] = useState({});
  const scopes = reportScopes(catalog);

  const loadBudgets = useCallback(async () => {
    try {
      const response = await fetch(`${API}/budgets/status`, { headers: { "x-admin-password": password } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load budgets.");
      setBudgets(data);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load budgets.");
    }
  }, [password]);

  useEffect(() => { loadBudgets(); }, [loadBudgets, reloadKey]);

  const reset = () => {
    setScopeKey("global"); setAmount(""); setPeriodDays(30); setStartDate(dateInput(new Date())); setEditingId(null);
  };

  const save = async () => {
    const [scope, id] = scopeKey.split(":");
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/budgets${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "x-admin-password": password },
        body: JSON.stringify({ scope, scopeId: id ? Number(id) : null, amount: Number(amount), periodDays: Number(periodDays), startDate }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save budget.");
      reset();
      await loadBudgets();
    } catch (err) {
      setError(err.message || "Could not save budget.");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    await fetch(`${API}/budgets/${id}`, { method: "DELETE", headers: { "x-admin-password": password } });
    loadBudgets();
  };

  const startEdit = (budget) => {
    setEditingId(budget.id);
    setScopeKey(budget.scope === "global" ? "global" : `${budget.scope}:${budget.scopeId}`);
    setAmount(String(budget.amount)); setPeriodDays(budget.periodDays); setStartDate(budget.startDate);
  };

  const getAdvice = async (id) => {
    setAdvice((current) => ({ ...current, [id]: { loading: true } }));
    try {
      const response = await fetch(`${API}/budgets/${id}/advice`, { method: "POST", headers: { "x-admin-password": password } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not get suggestions.");
      setAdvice((current) => ({ ...current, [id]: { items: data.advice, source: data.source } }));
    } catch (err) {
      setAdvice((current) => ({ ...current, [id]: { error: err.message || "Could not get suggestions." } }));
    }
  };

  const over = budgets.filter((budget) => budget.isOver);
  return (
    <section>
      <SectionTitle title="Flexible budgets" subtitle="Set a limit for all spending, a category, or a subcategory. Every period can be any number of days." />
      {over.length > 0 && <div style={alertStyle}>⚠ {over.length} budget{over.length === 1 ? " is" : "s are"} over its current limit. Open the card for tailored suggestions.</div>}
      <div style={panelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.5fr) minmax(130px, .7fr) minmax(130px, .8fr)", gap: "8px", alignItems: "end" }}>
          <label style={fieldLabel}>Budget scope<select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} style={inputStyle}>{scopes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}</select></label>
          <label style={fieldLabel}>Limit (₹)<input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" style={inputStyle} /></label>
          <label style={fieldLabel}>Cycle starts<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} /></label>
        </div>
        <label style={{ ...fieldLabel, marginTop: "12px" }}>Period: <strong>{periodDays} day{periodDays === 1 ? "" : "s"}</strong>
          <input type="range" min="1" max="365" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))} style={{ width: "100%", accentColor: "#3d3a2f" }} />
        </label>
        <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
          <button onClick={save} disabled={busy || amount === ""} style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>{busy ? "Saving..." : editingId ? "Update budget" : "Set budget"}</button>
          {editingId && <button onClick={reset} style={ghostBtn}>Cancel</button>}
        </div>
        {error && <p style={errorStyle}>{error}</p>}
      </div>

      <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
        {budgets.length === 0 && <Empty text="No budgets yet. Set one above to receive alerts." small />}
        {budgets.map((budget) => {
          const state = advice[budget.id];
          const width = Math.min(100, Math.max(0, budget.percent));
          return <div key={budget.id} style={{ ...panelStyle, borderColor: budget.isOver ? "#e8cfca" : "#e3ddcf", margin: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
              <div><strong style={{ fontSize: "14px", color: "#2a2a26" }}>{budget.scopeName}</strong><p style={{ ...mutedStyle, margin: "3px 0 0" }}>Cycle {budget.cycleStart} to {budget.cycleEnd} · {budget.periodDays} days</p></div>
              <div style={{ display: "flex", gap: "6px" }}><button onClick={() => startEdit(budget)} style={ghostBtn}>Edit</button><button onClick={() => remove(budget.id)} style={ghostDanger}>Remove</button></div>
            </div>
            <div style={{ marginTop: "10px", display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{money(budget.spend)} of {money(budget.amount)}</span><strong style={{ color: budget.isOver ? "#b0473f" : "#3d3a2f" }}>{budget.isOver ? `${money(-budget.remaining)} over` : `${money(budget.remaining)} left`}</strong></div>
            <div style={{ height: "7px", background: "#eee8d8", borderRadius: "999px", marginTop: "6px", overflow: "hidden" }}><div style={{ width: `${width}%`, height: "100%", background: budget.isOver ? "#b0473f" : "#607a57" }} /></div>
            {budget.isOver && <button onClick={() => getAdvice(budget.id)} disabled={state?.loading} style={{ ...ghostBtn, marginTop: "10px" }}>{state?.loading ? "Preparing suggestions..." : "Get AI suggestions"}</button>}
            {state?.error && <p style={errorStyle}>{state.error}</p>}
            {state?.items && <ol style={{ paddingLeft: "18px", margin: "10px 0 0", color: "#514d42", fontSize: "12px" }}>{state.items.map((item, index) => <li key={index} style={{ marginBottom: "4px" }}>{item}</li>)}</ol>}
          </div>;
        })}
      </div>
    </section>
  );
}

function useOfflineSync(password, onSynced) {
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(0);
  const refreshQueue = useCallback(async () => {
    try { setQueued(await queuedItemMutationCount()); } catch { setQueued(0); }
  }, []);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const result = await replayItemMutations({ api: API, password, onApplied: onSynced });
      setQueued(result.remaining);
    } catch { /* The queue will retry on the next reconnect or refresh. */ }
  }, [password, onSynced]);
  useEffect(() => {
    refreshQueue();
    const handleOnline = () => { setOnline(true); sync(); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (navigator.onLine) sync();
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [refreshQueue, sync]);
  const queueMutation = async (mutation) => { await queueItemMutation(mutation); await refreshQueue(); };
  return { online, queued, queueMutation, sync };
}

function OfflineBanner({ online, queued, onSync }) {
  if (online && queued === 0) return null;
  return <div style={{ ...alertStyle, background: online ? "#fbf5df" : "#eef1ed", color: "#514d42", borderColor: online ? "#eadcb6" : "#d8e0d3" }}>
    {online ? `${queued} item change${queued === 1 ? "" : "s"} waiting to sync.` : "You are offline. Previously opened catalog data is available; new item changes will sync when you reconnect."}
    {online && queued > 0 && <button onClick={onSync} style={{ ...ghostBtn, marginLeft: "10px" }}>Sync now</button>}
  </div>;
}

function SectionTitle({ title, subtitle }) {
  return <div style={{ margin: "0 0 8px" }}><h2 style={{ fontFamily: "Georgia, serif", fontSize: "18px", color: "#2a2a26", margin: 0 }}>{title}</h2><p style={{ ...mutedStyle, margin: "3px 0 0" }}>{subtitle}</p></div>;
}

function Metric({ label, value }) {
  return <div><p style={{ ...mutedStyle, margin: 0 }}>{label}</p><p style={{ margin: 0, fontSize: "16px", color: "#2a2a26", fontWeight: 600 }}>{value}</p></div>;
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
        Voice command \u2014 try "add item rice price 30 to bazar" or "add subcategory electricity under family"
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
  const [activePanel, setActivePanel] = useState("catalog");
  const [actionMessage, setActionMessage] = useState("");

  const headers = { "Content-Type": "application/json", "x-admin-password": password };
  const { online, queued, queueMutation, sync } = useOfflineSync(password, reload);

  const addCategory = async () => {
    if (!newCat.trim()) return;
    if (!online) return setActionMessage("Categories need a connection because new server IDs are required. Your item changes can still be queued offline.");
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
    if (!online) return setActionMessage("Subcategories need a connection because new server IDs are required. Your item changes can still be queued offline.");
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
    const mutation = editingItem?.key === key
      ? { method: "PUT", path: `/items/${editingItem.id}`, body: d }
      : { method: "POST", path: "/items", body: { subcategoryId, ...d } };
    let queuedOffline = !online;
    try {
      if (!online) throw new TypeError("Offline");
      const response = await fetch(`${API}${mutation.path}`, { method: mutation.method, headers, body: JSON.stringify(mutation.body) });
      const result = await response.json();
      if (!response.ok) {
        setActionMessage(result.error || "Could not save item.");
        return;
      }
    } catch {
      await queueMutation(mutation);
      queuedOffline = true;
    }
    if (queuedOffline) {
      setActionMessage("Item saved on this device and queued for automatic sync.");
    } else {
      setActionMessage("");
    }
    setItemDraft({ ...itemDraft, [key]: { name: "", price: "", desc: "", img: "" } });
    setEditingItem(null);
    if (!queuedOffline) reload();
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
      <Header title="Admin" onLogout={onLogout} onRefresh={() => { reload(); sync(); }} />
      <div style={{ padding: "16px 20px" }}>
        <OfflineBanner online={online} queued={queued} onSync={sync} />
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
          {[['catalog', 'Catalog'], ['reports', 'Reports'], ['budgets', 'Budgets']].map(([id, label]) => <button key={id} onClick={() => setActivePanel(id)} style={{ ...ghostBtn, background: activePanel === id ? "#3d3a2f" : "#fff", color: activePanel === id ? "#fff" : "#6b6659", borderColor: activePanel === id ? "#3d3a2f" : "#ddd6c4" }}>{label}</button>)}
        </div>

        {activePanel === "reports" && <ReportsPanel password={password} catalog={data} />}
        {activePanel === "budgets" && <BudgetsPanel password={password} catalog={data} reloadKey={data} />}
        {activePanel === "catalog" && <>
        <SpendingPanel password={password} reloadKey={data} />
        <VoicePanel password={password} onApplied={reload} />
        {actionMessage && <p style={infoStyle}>{actionMessage}</p>}

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
                              <span style={{ color: "#2a2a26" }}>{item.name} <span style={{ color: "#a39d8a" }}>\u2014 Price={item.price}</span></span>
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
        </>}
      </div>
    </div>
  );
}

function Header({ title, onLogout, onRefresh }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e3ddcf" }}>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "18px", margin: 0, color: "#2a2a26" }}>{title}</h1>
      <div style={{ display: "flex", gap: "8px" }}>
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
const panelStyle = { background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "12px 14px", marginBottom: "18px" };
const fieldLabel = { display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#6b6659" };
const mutedStyle = { fontSize: "11px", color: "#8a8477" };
const errorStyle = { fontSize: "12px", color: "#b0473f", margin: "10px 0 0" };
const infoStyle = { fontSize: "12px", color: "#607a57", margin: "0 0 10px" };
const alertStyle = { background: "#fff1ee", border: "1px solid #e8cfca", borderRadius: "4px", color: "#9a3c35", padding: "9px 11px", fontSize: "12px", margin: "0 0 12px" };
const reportRowStyle = { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", padding: "6px 2px", borderBottom: "1px solid #f8f5ec", fontSize: "12px", color: "#3d3a2f" };

export default function App() {
  const [role, setRole] = useState(null);
  const [adminPass, setAdminPass] = useState("");

  if (!role) return <Login onLogin={(r, pass) => { setRole(r); setAdminPass(pass); }} />;
  if (role === "admin") return <AdminView password={adminPass} onLogout={() => setRole(null)} />;
  return <GeneralView onLogout={() => setRole(null)} />;
}
