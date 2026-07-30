import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search, MessageCircle, X, Send, MapPin, Phone, Store,
  Check, Package, ArrowLeft, ClipboardList, Plus, Lock, ShieldCheck,
  Settings, LogOut, TrendingUp, Sparkles, Image as ImageIcon, Truck, Wallet, Pencil, UserPlus, LogIn
} from "lucide-react";

/* ---------------------------------------------------------
   Starter/seed listings — vendors add their own on top of these
--------------------------------------------------------- */
const SEED_VENDORS = [
  { id: "v1", name: "The Snack Corner", tag: "Rm 214, Hostel B" },
  { id: "v2", name: "Print & Bind Hub", tag: "Behind Block C" },
  { id: "v3", name: "Thrift Threads", tag: "DMs only, campus-wide" },
  { id: "v4", name: "Tech Fixers", tag: "Engineering courtyard" },
  { id: "v5", name: "Study Buddy Notes", tag: "Library annex" },
];

const CATEGORIES = ["Snacks & Drinks", "Books & Notes", "Stationery & Printing", "Clothing", "Tech & Repairs", "Other"];

const SEED_PRODUCTS = [
  { id: "p1", name: "Indomie 10-pack", category: "Snacks & Drinks", price: 2500, vendorId: "v1", icon: "🍜", desc: "Assorted flavors, sealed pack. Same-day delivery to hostel rooms." },
  { id: "p2", name: "Cold Zobo (1L)", category: "Snacks & Drinks", price: 800, vendorId: "v1", icon: "🧃", desc: "Homemade, chilled. Order ahead for exam-week bulk orders." },
  { id: "p4", name: "A4 Printing (per page)", category: "Stationery & Printing", price: 30, vendorId: "v2", icon: "🖨️", desc: "B&W or color. Send your file details in chat, ready in 20 mins." },
  { id: "p6", name: "MTH201 Past Questions", category: "Books & Notes", price: 1200, vendorId: "v5", icon: "📝", desc: "Last 5 years, with worked solutions. Soft copy or printed." },
  { id: "p9", name: "Thrifted Denim Jacket", category: "Clothing", price: 4500, vendorId: "v3", icon: "🧥", desc: "Size M, one of a kind. Ask for more photos in chat." },
  { id: "p11", name: "Phone Screen Repair", category: "Tech & Repairs", price: 6000, vendorId: "v4", icon: "📱", desc: "Most models. Send your phone model in chat for a quote." },
];

const DELIVERY_FEE = 500;

const money = (n) => `₦${Number(n || 0).toLocaleString()}`;
const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const isToday = (ts) => new Date(ts).toDateString() === new Date().toDateString();
const orderTotal = (o) => (Number(o.agreedPrice || 0) * Number(o.qty || 1)) + Number(o.deliveryFee || 0);

/* ---------------------------------------------------------
   Storage helpers (persistent, shared across everyone
   using this artifact — see privacy note in UI)
--------------------------------------------------------- */
async function loadJSON(key, fallback, shared) {
  try {
    const res = await window.storage.get(key, shared);
    return res ? JSON.parse(res.value) : fallback;
  } catch {
    return fallback;
  }
}
async function saveJSON(key, value, shared) {
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
  } catch (e) {
    console.error("storage save failed", e);
  }
}

/* --------------------------------- App --------------------------------- */
export default function CampusMarket() {
  const [role, setRole] = useState("buyer"); // 'buyer' | 'vendor' | 'owner'
  const [buyerProfile, setBuyerProfile] = useState(null); // { name }
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [activeProduct, setActiveProduct] = useState(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [orderSent, setOrderSent] = useState(false);

  const [vendors, setVendors] = useState(SEED_VENDORS);
  const [products, setProducts] = useState(SEED_PRODUCTS);
  const [dataLoaded, setDataLoaded] = useState(false);

  async function refreshData() {
    const [extraVendors, extraProducts] = await Promise.all([
      loadJSON("vendors", [], true),
      loadJSON("products", [], true),
    ]);
    setVendors([...SEED_VENDORS, ...extraVendors]);
    setProducts([...SEED_PRODUCTS, ...extraProducts]);
    setDataLoaded(true);
  }

  useEffect(() => { refreshData(); }, []);

  const vendorOf = (id) => vendors.find((v) => v.id === id) || { id, name: "Unknown seller", tag: "" };

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchesCat = category === "All" || p.category === category;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        q === "" ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.desc || "").toLowerCase().includes(q);
      return matchesCat && matchesQuery;
    });
  }, [query, category, products]);

  const related = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    if (filtered.length > 0) return [];
    return products.filter((p) => p.name.toLowerCase().split(" ").some((w) => q.includes(w) || w.includes(q))).slice(0, 4);
  }, [query, filtered, products]);

  return (
    <div className="min-h-screen w-full" style={{ background: BOARD_BG }}>
      <GlobalStyle />
      <TopBar role={role} setRole={setRole} buyerProfile={buyerProfile} />

      {role === "buyer" ? (
        !buyerProfile ? (
          <BuyerGate onSignedIn={(profile) => setBuyerProfile(profile)} />
        ) : (
          <BuyerView
            buyerProfile={buyerProfile}
            onSwitchBuyer={() => setBuyerProfile(null)}
            onUpdateDisplayName={(newName) => setBuyerProfile((p) => ({ ...p, displayName: newName }))}
            query={query} setQuery={setQuery}
            category={category} setCategory={setCategory}
            filtered={filtered} related={related}
            products={products}
            vendorOf={vendorOf}
            dataLoaded={dataLoaded}
            onOpenChat={(p) => { setActiveProduct(p); setOrderSent(false); setShowOrderForm(false); }}
          />
        )
      ) : role === "vendor" ? (
        <VendorArea
          vendors={vendors}
          products={products}
          vendorOf={vendorOf}
          onDataChanged={refreshData}
        />
      ) : (
        <OwnerArea vendorOf={vendorOf} />
      )}

      {activeProduct && buyerProfile && (
        <ChatPanel
          product={activeProduct}
          vendor={vendorOf(activeProduct.vendorId)}
          buyerUsername={buyerProfile.username}
          buyerDisplayName={buyerProfile.displayName}
          onClose={() => setActiveProduct(null)}
          showOrderForm={showOrderForm}
          setShowOrderForm={setShowOrderForm}
          orderSent={orderSent}
          setOrderSent={setOrderSent}
        />
      )}
    </div>
  );
}

/* ------------------------------ Theming ------------------------------ */
const BOARD_BG = "#1F3B31";
const BOARD_BG_2 = "#213F34";
const CHALK = "#F3F0E7";
const CHALK_YELLOW = "#F0C846";
const CHALK_CORAL = "#E8735F";
const CHALK_BLUE = "#8FC1D4";
const CARD_PAPER = "#FBF7EC";

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Caveat:wght@600;700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

      .cm-display { font-family: 'Permanent Marker', cursive; letter-spacing: 0.5px; }
      .cm-hand { font-family: 'Caveat', cursive; }
      .cm-body { font-family: 'Inter', sans-serif; }
      .cm-mono { font-family: 'Space Mono', monospace; }

      .cm-card {
        background: ${CARD_PAPER};
        box-shadow: 0 6px 14px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.4) inset;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .cm-card:hover {
        transform: translateY(-3px) rotate(0deg) !important;
        box-shadow: 0 12px 22px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.4) inset;
      }

      .cm-tape {
        position: absolute;
        width: 46px;
        height: 18px;
        background: rgba(240, 200, 70, 0.55);
        box-shadow: 0 1px 2px rgba(0,0,0,0.15);
        top: -9px;
        left: 50%;
        transform: translateX(-50%) rotate(-3deg);
      }

      .cm-chalk-border {
        border: 2px dashed rgba(243,240,231,0.35);
      }

      @keyframes cm-fade-up {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .cm-fade-up { animation: cm-fade-up 0.35s ease both; }

      @keyframes cm-slide-in {
        from { transform: translateX(100%); }
        to { transform: translateX(0); }
      }
      .cm-slide-in { animation: cm-slide-in 0.28s cubic-bezier(0.16,1,0.3,1) both; }

      @media (prefers-reduced-motion: reduce) {
        .cm-fade-up, .cm-slide-in { animation: none !important; }
        .cm-card:hover { transform: none !important; }
      }

      .cm-scrollbar::-webkit-scrollbar { width: 8px; }
      .cm-scrollbar::-webkit-scrollbar-thumb { background: rgba(243,240,231,0.25); border-radius: 8px; }

      .cm-focus:focus-visible {
        outline: 2px solid ${CHALK_YELLOW};
        outline-offset: 2px;
      }

      .cm-thumb {
        width: 100%;
        height: 96px;
        object-fit: cover;
        border-radius: 4px;
        margin-bottom: 8px;
        background: #EFE9D8;
      }
    `}</style>
  );
}

/* ------------------------------- Top bar ------------------------------- */
function TopBar({ role, setRole, buyerProfile }) {
  return (
    <div className="w-full border-b" style={{ borderColor: "rgba(243,240,231,0.15)", background: BOARD_BG_2 }}>
      <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏫</span>
          <h1 className="cm-display text-2xl" style={{ color: CHALK_YELLOW }}>Campus Market</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-full p-1" style={{ background: "rgba(243,240,231,0.08)" }}>
            <button
              onClick={() => setRole("buyer")}
              className={`cm-body cm-focus text-sm px-3 py-1.5 rounded-full transition ${role === "buyer" ? "font-semibold" : ""}`}
              style={{ background: role === "buyer" ? CHALK_YELLOW : "transparent", color: role === "buyer" ? "#20301f" : CHALK }}
            >
              {buyerProfile ? `Hi, ${buyerProfile.displayName.split(" ")[0]}` : "I'm shopping"}
            </button>
            <button
              onClick={() => setRole("vendor")}
              className={`cm-body cm-focus text-sm px-3 py-1.5 rounded-full transition flex items-center gap-1 ${role === "vendor" ? "font-semibold" : ""}`}
              style={{ background: role === "vendor" ? CHALK_YELLOW : "transparent", color: role === "vendor" ? "#20301f" : CHALK }}
            >
              <Store size={14} /> I sell here
            </button>
          </div>
          <button
            onClick={() => setRole("owner")}
            title="Management"
            className="cm-focus p-2 rounded-full"
            style={{ background: role === "owner" ? CHALK_YELLOW : "rgba(243,240,231,0.08)", color: role === "owner" ? "#20301f" : "rgba(243,240,231,0.6)" }}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Buyer gate (log in / sign up) ------------------------------ */
function BuyerGate({ onSignedIn }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [stage, setStage] = useState("form"); // 'form' | 'verify'
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(null); // { username, displayName, email, code }

  function switchMode(next) {
    setMode(next);
    setStage("form");
    setError("");
    setPin("");
    setConfirmPin("");
    setCode("");
    setPendingLogin(null);
  }

  function normalizedUsername() {
    return username.trim().toLowerCase().replace(/\s+/g, "");
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }

  async function sendLoginCode(account) {
    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    await saveJSON(`loginCode:${account.username}`, { code: newCode, ts: Date.now() }, true);
    setPendingLogin({ username: account.username, displayName: account.displayName || account.username, email: account.email, code: newCode });
    setCode("");
    setStage("verify");
  }

  async function submitLogin() {
    const uname = normalizedUsername();
    if (!uname || pin.trim().length < 4) {
      setError(pin.trim().length < 4 ? "PIN needs to be at least 4 digits." : "Enter your username.");
      return;
    }
    setBusy(true);
    setError("");
    const authKey = `buyerAuth:${uname}`;
    const existing = await loadJSON(authKey, null, true);
    if (!existing) {
      setError("No account with that username yet — sign up instead.");
      setBusy(false);
      return;
    }
    if (existing.pin !== pin.trim()) {
      setError("Wrong PIN for that username.");
      setBusy(false);
      return;
    }
    setBusy(false);
    await sendLoginCode(existing);
  }

  async function submitSignup() {
    const uname = normalizedUsername();
    if (!uname || !/^[a-z0-9_]{3,20}$/.test(uname)) {
      setError("Username should be 3-20 characters: letters, numbers, or underscores only.");
      return;
    }
    if (!isValidEmail(email)) { setError("Enter a valid email address."); return; }
    if (pin.trim().length < 4) { setError("PIN needs to be at least 4 digits."); return; }
    if (pin.trim() !== confirmPin.trim()) { setError("PINs don't match."); return; }
    setBusy(true);
    setError("");
    const authKey = `buyerAuth:${uname}`;
    const existing = await loadJSON(authKey, null, true);
    if (existing) {
      setError("That username is already taken. Try logging in, or pick another one.");
      setBusy(false);
      return;
    }
    const finalDisplayName = displayName.trim() || uname;
    await saveJSON(authKey, { username: uname, pin: pin.trim(), email: email.trim(), displayName: finalDisplayName }, true);
    setBusy(false);
    onSignedIn({ username: uname, displayName: finalDisplayName });
  }

  async function submitCode() {
    if (!pendingLogin) return;
    if (code.trim() !== pendingLogin.code) {
      setError("That code doesn't match. Check the code below and try again.");
      return;
    }
    setError("");
    onSignedIn({ username: pendingLogin.username, displayName: pendingLogin.displayName });
  }

  const submit = mode === "login" ? submitLogin : submitSignup;

  if (stage === "verify" && pendingLogin) {
    return (
      <div className="max-w-sm mx-auto px-5 pt-14 pb-24 text-center">
        <ShieldCheck size={28} style={{ color: CHALK_YELLOW }} className="mx-auto mb-3" />
        <h2 className="cm-display text-2xl mb-1" style={{ color: CHALK }}>Check your email</h2>
        <p className="cm-body text-sm mb-3" style={{ color: "rgba(243,240,231,0.7)" }}>
          We sent a 6-digit code to {pendingLogin.email || "the email on this account"}.
        </p>
        <div className="cm-body text-xs rounded-md px-3 py-2 mb-4" style={{ background: "rgba(240,200,70,0.12)", color: CHALK_YELLOW, border: "1px dashed rgba(240,200,70,0.4)" }}>
          Demo mode: this prototype has no email server connected yet, so here's the code it would have sent — <strong>{pendingLogin.code}</strong>. Wire up a real email service before launch and this box goes away.
        </div>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submitCode()}
          placeholder="6-digit code"
          inputMode="numeric"
          maxLength={6}
          className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mb-2 text-center tracking-widest"
          style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
        />
        {error && <p className="cm-body text-xs mb-2" style={{ color: CHALK_CORAL }}>{error}</p>}
        <button onClick={submitCode} className="cm-body cm-focus w-full text-sm font-semibold rounded-md px-4 py-2.5 mb-2"
          style={{ background: CHALK_YELLOW, color: "#20301f" }}>
          Verify & log in
        </button>
        <button onClick={() => setStage("form")} className="cm-body cm-focus text-xs" style={{ color: "rgba(243,240,231,0.5)" }}>
          <ArrowLeft size={11} className="inline -mt-0.5" /> back
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-5 pt-14 pb-24 text-center">
      <Lock size={28} style={{ color: CHALK_YELLOW }} className="mx-auto mb-3" />
      <h2 className="cm-display text-2xl mb-1" style={{ color: CHALK }}>
        {mode === "login" ? "Log in to shop" : "Create your account"}
      </h2>
      <p className="cm-body text-sm mb-4" style={{ color: "rgba(243,240,231,0.7)" }}>
        {mode === "login"
          ? "Use your username and PIN — we'll email a code to confirm it's you."
          : "Pick a unique username — you can change your display name anytime after."}
      </p>

      <div className="flex rounded-full p-1 mb-4 mx-auto" style={{ background: "rgba(243,240,231,0.08)", maxWidth: 260 }}>
        <button onClick={() => switchMode("login")} className="cm-body cm-focus flex-1 text-sm px-3 py-1.5 rounded-full flex items-center justify-center gap-1"
          style={{ background: mode === "login" ? CHALK_YELLOW : "transparent", color: mode === "login" ? "#20301f" : CHALK }}>
          <LogIn size={13} /> Log in
        </button>
        <button onClick={() => switchMode("signup")} className="cm-body cm-focus flex-1 text-sm px-3 py-1.5 rounded-full flex items-center justify-center gap-1"
          style={{ background: mode === "signup" ? CHALK_YELLOW : "transparent", color: mode === "signup" ? "#20301f" : CHALK }}>
          <UserPlus size={13} /> Sign up
        </button>
      </div>

      <div className="space-y-2 text-left">
        <div>
          <label className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>Username</label>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. tega_01"
            className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1"
            style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
          />
        </div>

        {mode === "signup" && (
          <div>
            <label className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>Display name (what sellers see)</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Tega"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1"
              style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
            />
          </div>
        )}

        {mode === "signup" && (
          <div>
            <label className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1"
              style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
            />
          </div>
        )}

        <div>
          <label className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>PIN</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && mode === "login" && submit()}
            placeholder="4-digit PIN"
            inputMode="numeric"
            maxLength={6}
            className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1"
            style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
          />
        </div>

        {mode === "signup" && (
          <div>
            <label className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>Confirm PIN</label>
            <input
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Re-enter PIN"
              inputMode="numeric"
              maxLength={6}
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1"
              style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
            />
          </div>
        )}
      </div>

      {error && <p className="cm-body text-xs mt-3" style={{ color: CHALK_CORAL }}>{error}</p>}

      <button disabled={busy} onClick={submit} className="cm-body cm-focus w-full text-sm font-semibold rounded-md px-4 py-2.5 mt-4 disabled:opacity-40"
        style={{ background: CHALK_YELLOW, color: "#20301f" }}>
        {busy ? "Checking..." : mode === "login" ? "Send login code" : "Create account"}
      </button>
    </div>
  );
}

/* ------------------------------ Buyer view ------------------------------ */
function BuyerView({ buyerProfile, onSwitchBuyer, onUpdateDisplayName, query, setQuery, category, setCategory, filtered, related, products, vendorOf, dataLoaded, onOpenChat }) {
  const cats = ["All", ...CATEGORIES];
  const [recommended, setRecommended] = useState([]);
  const [recLabel, setRecLabel] = useState("Popular on the board");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(buyerProfile.displayName);
  const [savingName, setSavingName] = useState(false);

  async function saveDisplayName() {
    if (!nameDraft.trim()) return;
    setSavingName(true);
    const authKey = `buyerAuth:${buyerProfile.username}`;
    const existing = await loadJSON(authKey, {}, true);
    await saveJSON(authKey, { ...existing, displayName: nameDraft.trim() }, true);
    onUpdateDisplayName(nameDraft.trim());
    setSavingName(false);
    setEditingName(false);
  }

  useEffect(() => {
    (async () => {
      const allOrders = await loadJSON("orders", [], true);
      const mine = allOrders.filter((o) => o.buyerUsername === buyerProfile.username);
      if (mine.length === 0) {
        setRecommended(products.slice(0, 6));
        setRecLabel("Popular on the board");
        return;
      }
      const freq = {};
      mine.forEach((o) => {
        const p = products.find((pr) => pr.id === o.productId);
        if (p) freq[p.category] = (freq[p.category] || 0) + 1;
      });
      const topCats = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([c]) => c);
      const boughtIds = new Set(mine.map((o) => o.productId));
      const picks = products.filter((p) => topCats.includes(p.category)).sort((a, b) => (boughtIds.has(a.id) ? 1 : 0) - (boughtIds.has(b.id) ? 1 : 0)).slice(0, 6);
      setRecommended(picks.length ? picks : products.slice(0, 6));
      setRecLabel("Because you've ordered from these categories before");
    })();
  }, [buyerProfile.username, products]);

  return (
    <div className="max-w-5xl mx-auto px-5 pb-24">
      <div className="pt-10 pb-2 text-center cm-fade-up">
        <p className="cm-hand text-2xl mb-1" style={{ color: CHALK_BLUE }}>psst — need something on campus?</p>
        <h2 className="cm-display text-3xl md:text-4xl leading-tight" style={{ color: CHALK }}>
          Search it. Chat the seller. <span style={{ color: CHALK_CORAL }}>Get it delivered.</span>
        </h2>

        {editingName ? (
          <div className="flex items-center justify-center gap-1.5 mt-2 max-w-xs mx-auto">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveDisplayName()}
              className="cm-body cm-focus text-xs rounded-md px-2 py-1 border flex-1"
              style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
            />
            <button disabled={savingName} onClick={saveDisplayName} className="cm-body cm-focus text-xs font-semibold rounded-md px-2 py-1"
              style={{ background: CHALK_YELLOW, color: "#20301f" }}>
              {savingName ? "..." : "Save"}
            </button>
            <button onClick={() => { setEditingName(false); setNameDraft(buyerProfile.displayName); }} className="cm-focus" style={{ color: "rgba(243,240,231,0.5)" }}>
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 mt-2">
            <button onClick={onSwitchBuyer} className="cm-body cm-focus text-xs flex items-center gap-1" style={{ color: "rgba(243,240,231,0.5)" }}>
              <LogOut size={11} /> not {buyerProfile.displayName}? switch
            </button>
            <button onClick={() => setEditingName(true)} className="cm-body cm-focus text-xs flex items-center gap-1" style={{ color: "rgba(243,240,231,0.5)" }}>
              <Pencil size={11} /> edit name
            </button>
          </div>
        )}
      </div>

      <div className="cm-fade-up rounded-xl p-3 flex items-center gap-2 cm-chalk-border mt-6" style={{ background: "rgba(243,240,231,0.06)" }}>
        <Search size={18} color={CHALK} className="shrink-0 ml-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for snacks, textbooks, printing, repairs..."
          className="cm-body cm-focus flex-1 bg-transparent outline-none text-base py-1"
          style={{ color: CHALK }}
        />
        {query && (
          <button onClick={() => setQuery("")} className="cm-focus p-1 rounded-full" style={{ color: CHALK }}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap mt-4">
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className="cm-body cm-focus text-sm px-3 py-1.5 rounded-full border transition"
            style={{
              borderColor: category === c ? CHALK_YELLOW : "rgba(243,240,231,0.25)",
              color: category === c ? "#20301f" : CHALK,
              background: category === c ? CHALK_YELLOW : "transparent",
              fontWeight: category === c ? 600 : 400,
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {!query.trim() && recommended.length > 0 && (
        <div className="mt-8">
          <h3 className="cm-body text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: CHALK_YELLOW }}>
            <Sparkles size={15} /> {recLabel}
          </h3>
          <ProductGrid products={recommended} vendorOf={vendorOf} onOpenChat={onOpenChat} />
          <div className="cm-chalk-border my-8" style={{ borderBottom: "2px dashed rgba(243,240,231,0.2)" }} />
        </div>
      )}

      {!dataLoaded ? (
        <p className="cm-body text-sm text-center mt-10" style={{ color: "rgba(243,240,231,0.6)" }}>loading the board...</p>
      ) : filtered.length === 0 ? (
        <div className="mt-10 text-center cm-fade-up">
          <p className="cm-hand text-2xl" style={{ color: CHALK }}>nothing pinned to the board matches "{query}" yet</p>
          {related.length > 0 && (
            <>
              <p className="cm-body text-sm mt-1 mb-4" style={{ color: "rgba(243,240,231,0.7)" }}>you might mean one of these:</p>
              <ProductGrid products={related} vendorOf={vendorOf} onOpenChat={onOpenChat} />
            </>
          )}
        </div>
      ) : (
        <div className="mt-8">
          <h3 className="cm-body text-sm font-semibold mb-3" style={{ color: CHALK_YELLOW }}>All listings</h3>
          <ProductGrid products={filtered} vendorOf={vendorOf} onOpenChat={onOpenChat} />
        </div>
      )}
    </div>
  );
}

function ProductGrid({ products, vendorOf, onOpenChat }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
      {products.map((p, i) => {
        const vendor = vendorOf(p.vendorId);
        const rotate = (i % 3 === 0) ? "-1.5deg" : (i % 3 === 1) ? "1deg" : "-0.5deg";
        return (
          <div
            key={p.id}
            className="cm-card cm-fade-up relative rounded-sm p-4 pt-6"
            style={{ transform: `rotate(${rotate})`, animationDelay: `${i * 40}ms` }}
          >
            <div className="cm-tape rounded-sm" />
            {p.imageUrl ? (
              <img src={p.imageUrl} alt={p.name} className="cm-thumb" onError={(e) => { e.target.style.display = "none"; }} />
            ) : (
              <div className="text-3xl mb-2">{p.icon || "🛍️"}</div>
            )}
            <h3 className="cm-body font-semibold text-[15px] leading-snug" style={{ color: "#2b2b2b" }}>{p.name}</h3>
            <p className="cm-body text-xs mt-1 mb-3" style={{ color: "#5a5a5a" }}>{p.desc}</p>
            <div className="flex items-center justify-between mb-3">
              <span className="cm-mono text-sm font-bold" style={{ color: "#2b2b2b" }}>{money(p.price)}</span>
              <span className="cm-body text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#EFE9D8", color: "#5a5a5a" }}>
                {vendor.name}
              </span>
            </div>
            <button
              onClick={() => onOpenChat(p)}
              className="cm-body cm-focus w-full text-sm font-semibold rounded-md py-2 flex items-center justify-center gap-1.5"
              style={{ background: "#20301f", color: CHALK_YELLOW }}
            >
              <MessageCircle size={15} /> Chat with seller
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Chat panel ------------------------------ */
function ChatPanel({ product, vendor, buyerUsername, buyerDisplayName, onClose, showOrderForm, setShowOrderForm, orderSent, setOrderSent }) {
  const convoKey = `conv:${product.id}:${buyerUsername}`;
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadJSON(convoKey, [], true).then((msgs) => {
      if (!cancelled) { setMessages(msgs); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [convoKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!draft.trim()) return;
    const msg = { sender: "buyer", name: buyerDisplayName, text: draft.trim(), ts: Date.now() };
    const next = [...messages, msg];
    setMessages(next);
    setDraft("");
    await saveJSON(convoKey, next, true);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose} />
      <div className="cm-slide-in relative w-full sm:w-[420px] h-full flex flex-col cm-scrollbar" style={{ background: CARD_PAPER }}>
        <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: "#e5ddc8" }}>
          <button onClick={onClose} className="cm-focus p-1 rounded-full" style={{ color: "#2b2b2b" }}>
            <ArrowLeft size={20} />
          </button>
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="w-9 h-9 rounded object-cover" />
          ) : (
            <div className="text-2xl">{product.icon || "🛍️"}</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="cm-body font-semibold text-sm truncate" style={{ color: "#2b2b2b" }}>{product.name}</p>
            <p className="cm-body text-xs" style={{ color: "#7a7a7a" }}>{vendor.name} · {vendor.tag}</p>
          </div>
          <button onClick={onClose} className="cm-focus p-1 rounded-full" style={{ color: "#2b2b2b" }}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto cm-scrollbar px-4 py-4 space-y-3">
          <div className="cm-body text-xs text-center py-2 px-3 rounded-lg mx-auto max-w-[85%]" style={{ background: "#EFE9D8", color: "#7a7a7a" }}>
            Chatting about <strong>{product.name}</strong> (listed at {money(product.price)}). Agree on a final price here, then send the order below.
          </div>

          {loading ? (
            <p className="cm-body text-xs text-center" style={{ color: "#9a9a9a" }}>loading conversation...</p>
          ) : messages.length === 0 ? (
            <p className="cm-hand text-lg text-center mt-6" style={{ color: "#9a9a9a" }}>say hi to get things moving 👋</p>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === "buyer" ? "justify-end" : "justify-start"}`}>
                <div
                  className="cm-body text-sm max-w-[78%] px-3 py-2 rounded-2xl"
                  style={{
                    background: m.sender === "buyer" ? "#20301f" : "#EFE9D8",
                    color: m.sender === "buyer" ? CHALK_YELLOW : "#2b2b2b",
                    borderBottomRightRadius: m.sender === "buyer" ? 4 : 16,
                    borderBottomLeftRadius: m.sender === "buyer" ? 16 : 4,
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-3 py-3 border-t flex items-center gap-2" style={{ borderColor: "#e5ddc8" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type a message..."
            className="cm-body cm-focus flex-1 text-sm rounded-full px-4 py-2 border"
            style={{ borderColor: "#d8cfb4" }}
          />
          <button onClick={sendMessage} className="cm-focus p-2.5 rounded-full" style={{ background: "#20301f", color: CHALK_YELLOW }}>
            <Send size={16} />
          </button>
        </div>

        <div className="px-4 pb-4">
          {orderSent ? (
            <div className="cm-body text-sm rounded-lg px-3 py-3 flex items-center gap-2" style={{ background: "#dff0d8", color: "#2b5a2b" }}>
              <Check size={16} /> Order sent — {vendor.name} and management have it. Delivery fee is ₦{DELIVERY_FEE}, payable by transfer or cash.
            </div>
          ) : (
            <button
              onClick={() => setShowOrderForm(true)}
              className="cm-body cm-focus w-full text-sm font-semibold rounded-md py-2.5 flex items-center justify-center gap-1.5"
              style={{ background: CHALK_YELLOW, color: "#20301f" }}
            >
              <Package size={15} /> Ready to order — send delivery details
            </button>
          )}
        </div>
      </div>

      {showOrderForm && (
        <OrderForm
          product={product}
          vendor={vendor}
          buyerUsername={buyerUsername}
          buyerDisplayName={buyerDisplayName}
          onClose={() => setShowOrderForm(false)}
          onSent={() => { setShowOrderForm(false); setOrderSent(true); }}
        />
      )}
    </div>
  );
}

/* ------------------------------ Order form ------------------------------ */
function OrderForm({ product, vendor, buyerUsername, buyerDisplayName, onClose, onSent }) {
  const [qty, setQty] = useState(1);
  const [agreedPrice, setAgreedPrice] = useState(product.price);
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transfer");
  const [submitting, setSubmitting] = useState(false);

  const grandTotal = (Number(agreedPrice) || 0) * qty + DELIVERY_FEE;

  async function submit() {
    if (!location.trim() || !phone.trim() || !agreedPrice || Number(agreedPrice) <= 0) return;
    setSubmitting(true);
    const order = {
      id: `ord_${Date.now()}`,
      productId: product.id,
      productName: product.name,
      vendorId: product.vendorId,
      buyerUsername,
      buyerName: buyerDisplayName,
      qty,
      agreedPrice: Number(agreedPrice),
      deliveryFee: DELIVERY_FEE,
      paymentMethod,
      location,
      phone,
      notes,
      ts: Date.now(),
      status: "new",
    };
    const existing = await loadJSON("orders", [], true);
    await saveJSON("orders", [...existing, order], true);
    setSubmitting(false);
    onSent();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div className="cm-fade-up relative w-full max-w-sm rounded-lg p-5 max-h-[90vh] overflow-y-auto cm-scrollbar" style={{ background: CARD_PAPER }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cm-display text-lg" style={{ color: "#2b2b2b" }}>Delivery details</h3>
          <button onClick={onClose} className="cm-focus" style={{ color: "#7a7a7a" }}><X size={18} /></button>
        </div>
        <p className="cm-body text-xs mb-4" style={{ color: "#7a7a7a" }}>{product.icon || "🛍️"} {product.name} — from {vendor.name}</p>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Quantity</label>
              <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, +e.target.value))}
                className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
            </div>
            <div className="flex-1">
              <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Price agreed (₦ per item)</label>
              <input type="number" min={1} value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)}
                className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
            </div>
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Delivery location (hostel/room/block)</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hostel B, Room 214"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Phone number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 080..."
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Payment method</label>
            <div className="flex gap-2 mt-1">
              {["transfer", "cash"].map((m) => (
                <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                  className="cm-body cm-focus flex-1 text-sm rounded-md py-2 border capitalize"
                  style={{
                    borderColor: paymentMethod === m ? "#20301f" : "#d8cfb4",
                    background: paymentMethod === m ? "#20301f" : "transparent",
                    color: paymentMethod === m ? CHALK_YELLOW : "#5a5a5a",
                  }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Notes (optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything else the seller should know"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1 resize-none" style={{ borderColor: "#d8cfb4" }} />
          </div>
        </div>

        <div className="cm-body text-xs rounded-md px-3 py-2 mt-3 space-y-0.5" style={{ background: "#EFE9D8", color: "#5a5a5a" }}>
          <div className="flex justify-between"><span>{qty} × {money(agreedPrice)}</span><span>{money((Number(agreedPrice) || 0) * qty)}</span></div>
          <div className="flex justify-between"><span>Delivery fee</span><span>{money(DELIVERY_FEE)}</span></div>
          <div className="flex justify-between font-bold pt-1 border-t mt-1" style={{ borderColor: "#d8cfb4", color: "#2b2b2b" }}>
            <span>Total ({paymentMethod})</span><span>{money(grandTotal)}</span>
          </div>
        </div>

        <button
          disabled={!location.trim() || !phone.trim() || !agreedPrice || submitting}
          onClick={submit}
          className="cm-body cm-focus w-full mt-4 text-sm font-semibold rounded-md py-2.5 disabled:opacity-40"
          style={{ background: "#20301f", color: CHALK_YELLOW }}
        >
          {submitting ? "Sending..." : "Send order"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- Vendor area (pick -> auth -> dashboard) ---------------------------- */
function VendorArea({ vendors, products, vendorOf, onDataChanged }) {
  const [stage, setStage] = useState("pick");
  const [selectedId, setSelectedId] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTag, setNewTag] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [dashboardConvo, setDashboardConvo] = useState(null);

  async function registerNewVendor() {
    if (!newName.trim()) { setAuthError("Give your shop a name."); return; }
    const id = `v_${slugify(newName)}_${Date.now().toString(36)}`;
    const vendor = { id, name: newName.trim(), tag: newTag.trim() || "Campus seller" };
    const existing = await loadJSON("vendors", [], true);
    await saveJSON("vendors", [...existing, vendor], true);
    await onDataChanged();
    setSelectedId(id);
    setIsNew(true);
    setAuthError("");
    setStage("auth");
  }

  async function submitAuth() {
    if (password.trim().length < 4) { setAuthError("Password needs to be at least 4 characters."); return; }
    setAuthBusy(true);
    setAuthError("");
    const authKey = `vendorAuth:${selectedId}`;
    const existing = await loadJSON(authKey, null, true);
    if (existing) {
      if (existing.password !== password.trim()) {
        setAuthError("Wrong password for this shop.");
        setAuthBusy(false);
        return;
      }
    } else {
      await saveJSON(authKey, { password: password.trim() }, true);
    }
    setAuthBusy(false);
    setStage("dashboard");
  }

  if (stage === "pick") {
    return (
      <div className="max-w-3xl mx-auto px-5 pt-10 pb-24">
        <div className="cm-fade-up mb-6 text-center">
          <p className="cm-hand text-2xl mb-1" style={{ color: CHALK_BLUE }}>seller check-in</p>
          <h2 className="cm-display text-3xl" style={{ color: CHALK }}>Who's setting up shop?</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          {vendors.map((v) => (
            <button
              key={v.id}
              onClick={() => { setSelectedId(v.id); setIsNew(false); setPassword(""); setAuthError(""); setStage("auth"); }}
              className="cm-card cm-focus text-left rounded-md p-4"
            >
              <p className="cm-body font-semibold text-sm" style={{ color: "#2b2b2b" }}>{v.name}</p>
              <p className="cm-body text-xs mt-0.5" style={{ color: "#7a7a7a" }}>{v.tag}</p>
            </button>
          ))}
        </div>

        <div className="cm-card rounded-md p-4">
          <p className="cm-body text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: "#2b2b2b" }}>
            <Plus size={15} /> Register a new shop
          </p>
          <div className="space-y-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Shop name"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border" style={{ borderColor: "#d8cfb4" }} />
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Where to find you (e.g. Hostel A, Room 12)"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border" style={{ borderColor: "#d8cfb4" }} />
            {authError && !selectedId && <p className="cm-body text-xs" style={{ color: CHALK_CORAL }}>{authError}</p>}
            <button onClick={registerNewVendor} className="cm-body cm-focus text-sm font-semibold rounded-md px-4 py-2"
              style={{ background: "#20301f", color: CHALK_YELLOW }}>
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "auth") {
    const v = vendorOf(selectedId);
    return (
      <div className="max-w-sm mx-auto px-5 pt-16 pb-24 text-center">
        <ShieldCheck size={28} style={{ color: CHALK_YELLOW }} className="mx-auto mb-3" />
        <h2 className="cm-display text-2xl mb-1" style={{ color: CHALK }}>{v.name}</h2>
        <p className="cm-body text-sm mb-4" style={{ color: "rgba(243,240,231,0.7)" }}>
          {isNew ? "Set a password to protect your shop's chats and orders." : "Enter your shop's password to continue."}
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAuth()}
          placeholder="Password"
          className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mb-2"
          style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
        />
        {authError && <p className="cm-body text-xs mb-2" style={{ color: CHALK_CORAL }}>{authError}</p>}
        <div className="flex gap-2">
          <button onClick={() => setStage("pick")} className="cm-body cm-focus flex-1 text-sm rounded-md px-4 py-2"
            style={{ background: "rgba(243,240,231,0.1)", color: CHALK }}>
            Back
          </button>
          <button disabled={authBusy} onClick={submitAuth} className="cm-body cm-focus flex-1 text-sm font-semibold rounded-md px-4 py-2 disabled:opacity-40"
            style={{ background: CHALK_YELLOW, color: "#20301f" }}>
            {authBusy ? "Checking..." : isNew ? "Set password" : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <VendorDashboard
      vendorId={selectedId}
      vendor={vendorOf(selectedId)}
      products={products.filter((p) => p.vendorId === selectedId)}
      onDataChanged={onDataChanged}
      dashboardConvo={dashboardConvo}
      setDashboardConvo={setDashboardConvo}
      onSwitchShop={() => setStage("pick")}
    />
  );
}

/* ---------------------------- Vendor dashboard ---------------------------- */
function VendorDashboard({ vendorId, vendor, products, onDataChanged, dashboardConvo, setDashboardConvo, onSwitchShop }) {
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [showAddItem, setShowAddItem] = useState(false);

  useEffect(() => {
    setLoadingOrders(true);
    loadJSON("orders", [], true).then((all) => {
      setOrders(all.filter((o) => o.vendorId === vendorId));
      setLoadingOrders(false);
    });
  }, [vendorId]);

  return (
    <div className="max-w-5xl mx-auto px-5 pb-24 pt-10">
      <div className="cm-fade-up mb-8 flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="cm-hand text-2xl mb-1" style={{ color: CHALK_BLUE }}>seller view</p>
          <h2 className="cm-display text-3xl" style={{ color: CHALK }}>{vendor.name}'s counter</h2>
          <p className="cm-body text-sm mt-1" style={{ color: "rgba(243,240,231,0.7)" }}>{vendor.tag}</p>
        </div>
        <button onClick={onSwitchShop} className="cm-body cm-focus text-xs rounded-full px-3 py-1.5" style={{ background: "rgba(243,240,231,0.1)", color: CHALK }}>
          Switch shop
        </button>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="cm-body text-sm font-semibold flex items-center gap-1.5" style={{ color: CHALK_YELLOW }}>
            <Package size={15} /> Your listings
          </h3>
          <button onClick={() => setShowAddItem(true)} className="cm-body cm-focus text-xs font-semibold rounded-full px-3 py-1.5 flex items-center gap-1"
            style={{ background: CHALK_YELLOW, color: "#20301f" }}>
            <Plus size={13} /> List an item
          </button>
        </div>
        {products.length === 0 ? (
          <p className="cm-hand text-lg" style={{ color: "rgba(243,240,231,0.6)" }}>nothing listed yet — add your first item</p>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {products.map((p) => (
              <div key={p.id} className="cm-card rounded-md p-3">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="cm-thumb" style={{ height: 70 }} onError={(e) => { e.target.style.display = "none"; }} />
                ) : null}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{p.icon || "🛍️"}</span>
                  <span className="cm-body text-sm font-semibold" style={{ color: "#2b2b2b" }}>{p.name}</span>
                </div>
                <p className="cm-mono text-xs font-bold mb-2" style={{ color: "#2b2b2b" }}>{money(p.price)}</p>
                <button
                  onClick={() => setDashboardConvo(p)}
                  className="cm-body cm-focus w-full text-xs rounded-md py-1.5 flex items-center justify-center gap-1"
                  style={{ background: "#EFE9D8", color: "#2b2b2b" }}
                >
                  <MessageCircle size={12} /> View chats
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="cm-body text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: CHALK_YELLOW }}>
          <ClipboardList size={15} /> Orders sent to you
        </h3>
        {loadingOrders ? (
          <p className="cm-body text-xs" style={{ color: "rgba(243,240,231,0.6)" }}>loading...</p>
        ) : orders.length === 0 ? (
          <p className="cm-hand text-lg" style={{ color: "rgba(243,240,231,0.6)" }}>no orders yet — check back after a chat closes</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {orders.slice().reverse().map((o) => (
              <div key={o.id} className="cm-card rounded-md p-3">
                <p className="cm-body text-sm font-semibold" style={{ color: "#2b2b2b" }}>{o.qty}× {o.productName} @ {money(o.agreedPrice)}</p>
                <p className="cm-body text-xs mt-1" style={{ color: "#5a5a5a" }}>
                  <MapPin size={11} className="inline -mt-0.5" /> {o.location}
                </p>
                <p className="cm-body text-xs" style={{ color: "#5a5a5a" }}>
                  <Phone size={11} className="inline -mt-0.5" /> {o.phone} · from {o.buyerName || "guest"}
                </p>
                <p className="cm-body text-xs mt-1" style={{ color: "#7a7a7a" }}>{o.paymentMethod === "cash" ? "Pays cash on delivery" : "Pays by transfer"}</p>
                {o.notes && <p className="cm-body text-xs mt-1 italic" style={{ color: "#7a7a7a" }}>"{o.notes}"</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {dashboardConvo && (
        <VendorConvoView product={dashboardConvo} vendorName={vendor.name} onClose={() => setDashboardConvo(null)} />
      )}

      {showAddItem && (
        <AddItemForm vendorId={vendorId} onClose={() => setShowAddItem(false)} onAdded={async () => { setShowAddItem(false); await onDataChanged(); }} />
      )}
    </div>
  );
}

function AddItemForm({ vendorId, onClose, onAdded }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [price, setPrice] = useState("");
  const [icon, setIcon] = useState("🛍️");
  const [imageUrl, setImageUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || !price || Number(price) <= 0) {
      setError("Give the item a name and a price above 0.");
      return;
    }
    setSubmitting(true);
    const product = {
      id: `p_${slugify(name)}_${Date.now().toString(36)}`,
      name: name.trim(),
      category,
      price: Number(price),
      vendorId,
      icon: icon.trim() || "🛍️",
      imageUrl: imageUrl.trim(),
      desc: desc.trim(),
    };
    const existing = await loadJSON("products", [], true);
    await saveJSON("products", [...existing, product], true);
    setSubmitting(false);
    onAdded();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div className="cm-fade-up relative w-full max-w-sm rounded-lg p-5 max-h-[90vh] overflow-y-auto cm-scrollbar" style={{ background: CARD_PAPER }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cm-display text-lg" style={{ color: "#2b2b2b" }}>List an item</h3>
          <button onClick={onClose} className="cm-focus" style={{ color: "#7a7a7a" }}><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Item name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jollof rice (large)"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="w-20">
              <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Emoji</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4}
                className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1 text-center" style={{ borderColor: "#d8cfb4" }} />
            </div>
          </div>
          <div>
            <label className="cm-body text-xs font-medium flex items-center gap-1" style={{ color: "#5a5a5a" }}>
              <ImageIcon size={12} /> Image URL (optional)
            </label>
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... (a link to a photo)"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Price (₦)</label>
            <input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1500"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1" style={{ borderColor: "#d8cfb4" }} />
          </div>
          <div>
            <label className="cm-body text-xs font-medium" style={{ color: "#5a5a5a" }}>Description</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="What buyers should know before they chat you"
              className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mt-1 resize-none" style={{ borderColor: "#d8cfb4" }} />
          </div>
        </div>
        {error && <p className="cm-body text-xs mt-2" style={{ color: CHALK_CORAL }}>{error}</p>}
        <button
          disabled={submitting}
          onClick={submit}
          className="cm-body cm-focus w-full mt-4 text-sm font-semibold rounded-md py-2.5 disabled:opacity-40"
          style={{ background: "#20301f", color: CHALK_YELLOW }}
        >
          {submitting ? "Listing..." : "Add to the board"}
        </button>
      </div>
    </div>
  );
}

function VendorConvoView({ product, vendorName, onClose }) {
  const [buyers, setBuyers] = useState([]);
  const [selectedBuyer, setSelectedBuyer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.list(`conv:${product.id}:`, true);
        setBuyers(res?.keys || []);
      } catch {
        setBuyers([]);
      }
    })();
  }, [product.id]);

  useEffect(() => {
    if (!selectedBuyer) return;
    loadJSON(selectedBuyer, [], true).then(setMessages);
  }, [selectedBuyer]);

  async function reply() {
    if (!draft.trim() || !selectedBuyer) return;
    const msg = { sender: "vendor", name: vendorName, text: draft.trim(), ts: Date.now() };
    const next = [...messages, msg];
    setMessages(next);
    setDraft("");
    await saveJSON(selectedBuyer, next, true);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose} />
      <div className="cm-fade-up relative w-full max-w-md rounded-lg p-5 max-h-[80vh] flex flex-col" style={{ background: CARD_PAPER }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cm-body text-sm font-semibold" style={{ color: "#2b2b2b" }}>{product.icon || "🛍️"} {product.name} — chats</h3>
          <button onClick={onClose} className="cm-focus" style={{ color: "#7a7a7a" }}><X size={18} /></button>
        </div>

        {!selectedBuyer ? (
          buyers.length === 0 ? (
            <p className="cm-body text-sm" style={{ color: "#7a7a7a" }}>No one has messaged about this item yet.</p>
          ) : (
            <div className="space-y-2 overflow-y-auto cm-scrollbar">
              {buyers.map((k) => (
                <button key={k} onClick={() => setSelectedBuyer(k)}
                  className="cm-body cm-focus w-full text-left text-sm rounded-md px-3 py-2 border"
                  style={{ borderColor: "#d8cfb4", color: "#2b2b2b" }}>
                  {k.split(":")[2] || "guest"}
                </button>
              ))}
            </div>
          )
        ) : (
          <>
            <button onClick={() => setSelectedBuyer(null)} className="cm-body cm-focus text-xs mb-2 flex items-center gap-1" style={{ color: "#7a7a7a" }}>
              <ArrowLeft size={12} /> back to buyers
            </button>
            <div className="flex-1 overflow-y-auto cm-scrollbar space-y-2 mb-2">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.sender === "vendor" ? "justify-end" : "justify-start"}`}>
                  <div className="cm-body text-sm max-w-[78%] px-3 py-2 rounded-2xl"
                    style={{ background: m.sender === "vendor" ? "#20301f" : "#EFE9D8", color: m.sender === "vendor" ? CHALK_YELLOW : "#2b2b2b" }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reply()}
                placeholder="Reply..." className="cm-body cm-focus flex-1 text-sm rounded-full px-3 py-2 border" style={{ borderColor: "#d8cfb4" }} />
              <button onClick={reply} className="cm-focus p-2 rounded-full" style={{ background: "#20301f", color: CHALK_YELLOW }}>
                <Send size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- Owner / Management area ---------------------------- */
function OwnerArea({ vendorOf }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    loadJSON("ownerAuth", null, true).then((v) => setIsNew(!v));
  }, []);

  async function submit() {
    if (password.trim().length < 4) { setError("Password needs to be at least 4 characters."); return; }
    setBusy(true);
    setError("");
    const existing = await loadJSON("ownerAuth", null, true);
    if (existing) {
      if (existing.password !== password.trim()) {
        setError("Wrong management password.");
        setBusy(false);
        return;
      }
    } else {
      await saveJSON("ownerAuth", { password: password.trim() }, true);
    }
    setBusy(false);
    setUnlocked(true);
  }

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto px-5 pt-16 pb-24 text-center">
        <ShieldCheck size={28} style={{ color: CHALK_YELLOW }} className="mx-auto mb-3" />
        <h2 className="cm-display text-2xl mb-1" style={{ color: CHALK }}>Management</h2>
        <p className="cm-body text-sm mb-4" style={{ color: "rgba(243,240,231,0.7)" }}>
          {isNew ? "First time here — set the management password." : "Enter the management password."}
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          className="cm-body cm-focus w-full text-sm rounded-md px-3 py-2 border mb-2"
          style={{ borderColor: "rgba(243,240,231,0.3)", background: "rgba(243,240,231,0.08)", color: CHALK }}
        />
        {error && <p className="cm-body text-xs mb-2" style={{ color: CHALK_CORAL }}>{error}</p>}
        <button disabled={busy} onClick={submit} className="cm-body cm-focus w-full text-sm font-semibold rounded-md px-4 py-2.5 disabled:opacity-40"
          style={{ background: CHALK_YELLOW, color: "#20301f" }}>
          {busy ? "Checking..." : isNew ? "Set password" : "Unlock"}
        </button>
      </div>
    );
  }

  return <OwnerDashboard vendorOf={vendorOf} />;
}

function OwnerDashboard({ vendorOf }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("today"); // 'today' | 'all'

  async function refresh() {
    setLoading(true);
    const all = await loadJSON("orders", [], true);
    setOrders(all);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function markDelivered(orderId) {
    const all = await loadJSON("orders", [], true);
    const next = all.map((o) => o.id === orderId ? { ...o, status: "delivered", deliveredAt: Date.now() } : o);
    await saveJSON("orders", next, true);
    setOrders(next);
  }

  const todays = orders.filter((o) => isToday(o.ts));
  const shown = filter === "today" ? todays : orders;
  const deliveredToday = todays.filter((o) => o.status === "delivered");
  const revenueDeliveredToday = deliveredToday.reduce((sum, o) => sum + orderTotal(o), 0);
  const expectedRevenueToday = todays.reduce((sum, o) => sum + orderTotal(o), 0);
  const pendingCount = todays.filter((o) => o.status !== "delivered").length;

  return (
    <div className="max-w-5xl mx-auto px-5 pb-24 pt-10">
      <div className="cm-fade-up mb-6">
        <p className="cm-hand text-2xl mb-1" style={{ color: CHALK_BLUE }}>management</p>
        <h2 className="cm-display text-3xl" style={{ color: CHALK }}>Today at a glance</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard icon={<Package size={16} />} label="Orders today" value={todays.length} />
        <StatCard icon={<Truck size={16} />} label="Delivered today" value={deliveredToday.length} />
        <StatCard icon={<Wallet size={16} />} label="Revenue (delivered)" value={money(revenueDeliveredToday)} />
        <StatCard icon={<TrendingUp size={16} />} label="Expected revenue today" value={money(expectedRevenueToday)} sub={`${pendingCount} still pending`} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="cm-body text-sm font-semibold flex items-center gap-1.5" style={{ color: CHALK_YELLOW }}>
          <ClipboardList size={15} /> Orders
        </h3>
        <div className="flex rounded-full p-1" style={{ background: "rgba(243,240,231,0.08)" }}>
          <button onClick={() => setFilter("today")} className="cm-body cm-focus text-xs px-3 py-1 rounded-full"
            style={{ background: filter === "today" ? CHALK_YELLOW : "transparent", color: filter === "today" ? "#20301f" : CHALK }}>
            Today
          </button>
          <button onClick={() => setFilter("all")} className="cm-body cm-focus text-xs px-3 py-1 rounded-full"
            style={{ background: filter === "all" ? CHALK_YELLOW : "transparent", color: filter === "all" ? "#20301f" : CHALK }}>
            All time
          </button>
        </div>
      </div>

      {loading ? (
        <p className="cm-body text-sm" style={{ color: "rgba(243,240,231,0.6)" }}>loading orders...</p>
      ) : shown.length === 0 ? (
        <p className="cm-hand text-lg" style={{ color: "rgba(243,240,231,0.6)" }}>no orders here yet</p>
      ) : (
        <div className="space-y-3">
          {shown.slice().reverse().map((o) => (
            <div key={o.id} className="cm-card rounded-md p-4 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="cm-body text-sm font-semibold" style={{ color: "#2b2b2b" }}>
                  {o.qty}× {o.productName} — {vendorOf(o.vendorId).name}
                </p>
                <p className="cm-body text-xs mt-1" style={{ color: "#5a5a5a" }}>
                  <MapPin size={11} className="inline -mt-0.5" /> {o.location} · <Phone size={11} className="inline -mt-0.5" /> {o.phone}
                </p>
                <p className="cm-body text-xs mt-1" style={{ color: "#7a7a7a" }}>
                  from {o.buyerName} · {new Date(o.ts).toLocaleString()} · pays {o.paymentMethod}
                </p>
                {o.notes && <p className="cm-body text-xs mt-1 italic" style={{ color: "#7a7a7a" }}>"{o.notes}"</p>}
              </div>
              <div className="text-right">
                <p className="cm-mono text-sm font-bold" style={{ color: "#2b2b2b" }}>{money(orderTotal(o))}</p>
                <p className="cm-body text-[11px] mb-2" style={{ color: "#9a9a9a" }}>incl. {money(o.deliveryFee)} delivery</p>
                {o.status === "delivered" ? (
                  <span className="cm-body text-xs px-2 py-1 rounded-full inline-flex items-center gap-1" style={{ background: "#dff0d8", color: "#2b5a2b" }}>
                    <Check size={11} /> Delivered
                  </span>
                ) : (
                  <button onClick={() => markDelivered(o.id)} className="cm-body cm-focus text-xs font-semibold rounded-full px-3 py-1.5"
                    style={{ background: "#20301f", color: CHALK_YELLOW }}>
                    Mark delivered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="cm-card rounded-md p-3">
      <div className="flex items-center gap-1.5 mb-1" style={{ color: "#7a7a7a" }}>
        {icon}
        <span className="cm-body text-[11px]">{label}</span>
      </div>
      <p className="cm-mono text-lg font-bold" style={{ color: "#2b2b2b" }}>{value}</p>
      {sub && <p className="cm-body text-[10px]" style={{ color: "#9a9a9a" }}>{sub}</p>}
    </div>
  );
}
