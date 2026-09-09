import React, { useState, useEffect } from "react";

const API = "http://localhost:3001/api";

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
                            <p style={{ margin: 0, fontSize: "13px", color: "#3d3a2f", fontWeight: "600" }}>\u20B9{item.price}</p>
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

function VoicePanel({ password, onApplied }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [supported, setSupported] = useState(true);

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { setListening(true); setStatus(""); };
    recognition.onerror = () => { setListening(false); setStatus("Could not hear that. Try again."); };
    recognition.onend = () => setListening(false);

    recognition.onresult = async (event) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      setStatus("Sending to assistant...");
      try {
        const res = await fetch(`${API}/voice-command`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-password": password },
          body: JSON.stringify({ transcript: text }),
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
      }
    };

    recognition.start();
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e3ddcf", borderRadius: "4px", padding: "12px 14px", marginBottom: "18px" }}>
      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#8a8477" }}>
        Voice command \u2014 try "add item Alu price 25 to Bazar in Family"
      </p>
      {!supported && <p style={{ fontSize: "12px", color: "#b0473f", margin: "0 0 8px" }}>Voice input isn't supported in this browser. Try Chrome.</p>}
      <button onClick={startListening} disabled={listening || !supported} style={{ ...primaryBtn, opacity: listening ? 0.6 : 1 }}>
        {listening ? "Listening..." : "Speak a command"}
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

  const headers = { "Content-Type": "application/json", "x-admin-password": password };

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
      <div style={{ padding: "16px 20px" }}>
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
                              <span style={{ color: "#2a2a26" }}>{item.name} <span style={{ color: "#a39d8a" }}>\u2014 \u20B9{item.price}</span></span>
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

export default function App() {
  const [role, setRole] = useState(null);
  const [adminPass, setAdminPass] = useState("");

  if (!role) return <Login onLogin={(r, pass) => { setRole(r); setAdminPass(pass); }} />;
  if (role === "admin") return <AdminView password={adminPass} onLogout={() => setRole(null)} />;
  return <GeneralView onLogout={() => setRole(null)} />;
}
