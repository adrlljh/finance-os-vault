import { useState, useEffect, useCallback, useContext, createContext } from "react";

const MaskContext = createContext(false);
function useMask() { return useContext(MaskContext); }
function masked(val, placeholder="••••••") { return val; } // overridden by context
function MaskProvider({ children, isMasked }) {
  return <MaskContext.Provider value={isMasked}>{children}</MaskContext.Provider>;
}
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

// ── Supabase storage helpers ─────────────────────────────────────────────────
const SUPABASE_URL = "https://xpqwghcdjzwyezwrrdlt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwcXdnaGNkanp3eWV6d3JyZGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTEzNzgsImV4cCI6MjA5NTE4NzM3OH0.NEqlMLJ29AP6cKR4h60z2m2wrmXniN7WmKt60gaia5g";

const KEYS = {
  profile: "pg_profile",
  assetSources: "pg_asset_sources",
  snapshots: "pg_snapshots",
  checkinDraft: "pg_checkin_draft",
};

function getAuthHeaders() {
  return {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
    "x-vault-secret": import.meta.env.VITE_VAULT_SECRET || "",
  };
}

async function load(key, retries=2) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/vault_data?key=eq.${key}&select=value`, {
        headers: getAuthHeaders()
      });
      const rows = await res.json();
      if (rows && rows.length > 0) return JSON.parse(rows[0].value);
    } catch {}
    if (i < retries-1) await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function save(key, val) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/vault_data`, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key, value: JSON.stringify(val), updated_at: new Date().toISOString() })
    });
  } catch {}
}

// ── Constants ────────────────────────────────────────────────────────────────
const EXPENSE_CATS = [
  "Housing","Food","Transport","Entertainment",
  "Health","Shopping","Insurance","Subscriptions","Travel","Family/Parents","Others"
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtSGD(n) {
  if (n === undefined || n === null || isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `S$${(n/1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `S$${(n/1_000).toFixed(1)}k`;
  return `S$${Number(n).toFixed(0)}`;
}
function fmtPct(n) {
  if (!n && n !== 0) return "–";
  return `${n.toFixed(1)}%`;
}

// Component that masks monetary values when privacy mode is on
function M({ val, pct }) {
  const masked = useMask();
  if (masked) return <span style={{ letterSpacing:"0.1em", color:"#bbb" }}>••••••</span>;
  return <span>{pct ? fmtPct(val) : fmtSGD(val)}</span>;
}

// Hook that returns chart-safe formatters respecting mask state
function useChartFmt() {
  const masked = useMask();
  const amt = masked ? ()=>"••••" : v=>fmtSGD(v);
  const amtTip = masked ? (v,n)=>["••••",n] : (v,n)=>[fmtSGD(v),n];
  const amtTipSingle = masked ? v=>["••••",""] : v=>[fmtSGD(v),""];
  return { amt, amtTip, amtTipSingle };
}
function monthKey(y, m) { return `${y}-${String(m+1).padStart(2,"0")}`; }
function nowKey() { const d = new Date(); return monthKey(d.getFullYear(), d.getMonth()); }
function nowLabel() { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

// ── Default data ─────────────────────────────────────────────────────────────
const defaultProfile = {
  name: "Adriel",
  salary: 5484,

  hdbGoal: { price: 550000, tenure: 25, rate: 2.6 },
  hdbBankGoal: { price: 550000, tenure: 30, rate: 2.5 },
  condoGoal: { price: 1200000, tenure: 30, rate: 2.5 },
};
const defaultSources = {
  cash: [],
  investments: [],
};

// ── Dummy snapshots (6 months of data) ───────────────────────────────────────
// ── Mortgage calc ─────────────────────────────────────────────────────────────
function monthlyInstalment(principal, annualRate, tenureYears) {
  if (!principal || !annualRate || !tenureYears) return 0;
  const r = annualRate / 100 / 12;
  const n = tenureYears * 12;
  if (r === 0) return principal / n;
  return principal * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════
async function signInWithGoogle() {
  const redirectTo = window.location.origin + window.location.pathname;
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

async function getSession() {
  try {
    // Check URL for access_token (OAuth callback)
    const hash = window.location.hash;
    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken) {
        sessionStorage.setItem("vault_token", accessToken);
        if (refreshToken) sessionStorage.setItem("vault_refresh", refreshToken);
        window.history.replaceState(null, "", window.location.pathname);
        return accessToken;
      }
    }
    // Check sessionStorage
    const stored = sessionStorage.getItem("vault_token");
    if (stored) return stored;
    return null;
  } catch { return null; }
}

async function signOut() {
  const token = sessionStorage.getItem("vault_token");
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${token}`,
      }
    });
  }
  sessionStorage.removeItem("vault_token");
  sessionStorage.removeItem("vault_refresh");
  window.location.reload();
}

function LoginScreen() {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#f8f7f4", fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ textAlign:"center", padding:"48px 40px", background:"#fff", borderRadius:24, border:"1px solid #ede9e0", width:320 }}>
        <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:32, marginBottom:4 }}>Vault</div>
        <div style={{ fontSize:13, color:"#aaa", marginBottom:40 }}>own your finances</div>
        <button
          onClick={() => { setLoading(true); signInWithGoogle(); }}
          disabled={loading}
          style={{ width:"100%", padding:"14px 20px", borderRadius:12, border:"1px solid #ede9e0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:12, fontSize:15, fontWeight:500, fontFamily:"'DM Sans',sans-serif", color:"#1a1a1a", transition:"background 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.background="#f8f7f4"}
          onMouseLeave={e=>e.currentTarget.style.background="#fff"}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.04a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.48A4.8 4.8 0 0 1 4.5 7.5V5.43H1.83a8 8 0 0 0 0 7.14z"/><path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.54-2.54A8 8 0 0 0 1.83 5.43L4.5 7.5a4.8 4.8 0 0 1 4.48-3.92z"/></svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        <div style={{ fontSize:12, color:"#ccc", marginTop:24 }}>Only authorised accounts can access this dashboard.</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [token, setToken] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [profile, setProfile] = useState(null);
  const [sources, setSources] = useState(null);
  const [snapshots, setSnapshots] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [isMasked, setIsMasked] = useState(false);

  useEffect(() => {
    (async () => {
      let [p, s, snaps] = await Promise.all([
        load(KEYS.profile), load(KEYS.assetSources), load(KEYS.snapshots)
      ]);
      if (!p) { p = defaultProfile; await save(KEYS.profile, p); }
      if (!s) { s = defaultSources; } // don't auto-save empty sources
      if (!snaps) { snaps = {}; }
      setProfile(p);
      setSources(s);
      setSnapshots(snaps);
      setLoaded(true);
    })();
  }, []);

  const saveProfile = useCallback(async (p) => { setProfile(p); await save(KEYS.profile, p); }, []);
  const saveSources = useCallback(async (s) => { setSources(s); await save(KEYS.assetSources, s); }, []);
  const saveSnapshot = useCallback(async (key, snap) => {
    const next = { ...snapshots, [key]: snap };
    setSnapshots(next);
    await save(KEYS.snapshots, next);
  }, [snapshots]);

  useEffect(() => {
    getSession().then(t => { setToken(t); setAuthChecked(true); });
  }, []);

  if (!authChecked) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#f8f7f4", fontFamily:"'DM Sans', sans-serif", color:"#aaa" }}>
      Loading…
    </div>
  );

  if (!token) return <LoginScreen />;

  if (!loaded) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#f8f7f4", fontFamily:"'DM Sans', sans-serif", color:"#888" }}>
      Loading your dashboard…
    </div>
  );

  // is current month logged?
  const currentLogged = snapshots && snapshots[nowKey()];
  const latestSnap = snapshots && Object.keys(snapshots).sort().reverse().map(k => snapshots[k])[0];

  const pages = {
    dashboard: <Dashboard profile={profile} sources={sources} snapshots={snapshots} currentLogged={currentLogged} latestSnap={latestSnap} setPage={setPage} />,
    checkin: <CheckIn profile={profile} sources={sources} snapshots={snapshots} saveSnapshot={saveSnapshot} saveSources={saveSources} setPage={setPage} />,
    assets: <Assets sources={sources} latestSnap={latestSnap} setPage={setPage} />,
    expenses: <Expenses snapshots={snapshots} />,
    homegoal: <HomeGoal profile={profile} saveProfile={saveProfile} latestSnap={latestSnap} />,
    trends: <Trends snapshots={snapshots} />,
    settings: <Settings profile={profile} saveProfile={saveProfile} sources={sources} saveSources={saveSources} setPage={setPage} />,
  };

  return (
    <div style={{ background:"#f8f7f4", fontFamily:"'DM Sans', sans-serif", color:"#1a1a1a" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display:ital@0;1&display=swap');
        * { box-sizing: border-box; margin:0; padding:0; }
        body { background:#f8f7f4; }
        input, select { outline:none; }
        input:focus, select:focus { border-color:#2d6a4f !important; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:#d4d0c8; border-radius:2px; }
        .card { background:#fff; border-radius:16px; padding:24px; border:1px solid #ede9e0; }
        .btn-primary { background:#2d6a4f; color:#fff; border:none; border-radius:10px; padding:12px 24px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; cursor:pointer; transition:background 0.15s; }
        .btn-primary:hover { background:#1e4d39; }
        .btn-ghost { background:transparent; color:#2d6a4f; border:1px solid #2d6a4f; border-radius:10px; padding:10px 20px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; cursor:pointer; transition:all 0.15s; }
        .btn-ghost:hover { background:#f0f7f4; }
        .btn-danger { background:transparent; color:#c0392b; border:1px solid #e8bbb7; border-radius:8px; padding:6px 14px; font-family:'DM Sans',sans-serif; font-size:13px; cursor:pointer; }
        .input-field { width:100%; border:1px solid #e8e4db; border-radius:10px; padding:10px 14px; font-family:'DM Sans',sans-serif; font-size:14px; color:#1a1a1a; background:#fafaf8; transition:border 0.15s; }
        .label { font-size:12px; font-weight:500; color:#888; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px; display:block; }
        .page-title { font-family:'DM Serif Display', serif; font-size:28px; color:#1a1a1a; margin-bottom:4px; }
        .page-sub { font-size:14px; color:#888; margin-bottom:24px; }
        .nav-item { display:flex; align-items:center; gap:8px; padding:10px 14px; border-radius:10px; cursor:pointer; font-size:14px; font-weight:500; color:#666; transition:all 0.15s; border:none; background:transparent; font-family:'DM Sans',sans-serif; width:100%; }
        .nav-item:hover { background:#f0f0ec; color:#1a1a1a; }
        .nav-item.active { background:#2d6a4f; color:#fff; }
        .progress-bar { height:8px; background:#ede9e0; border-radius:99px; overflow:hidden; }
        .progress-fill { height:100%; background:#2d6a4f; border-radius:99px; transition:width 0.5s ease; }
        .tag { display:inline-block; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:500; }
        .tag-green { background:#e8f5ee; color:#2d6a4f; }
        .tag-amber { background:#fef3e2; color:#d97706; }
        .tag-red { background:#fde8e6; color:#c0392b; }
        .step-dot { width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600; flex-shrink:0; }
        .divider { height:1px; background:#ede9e0; margin:20px 0; }
        .stat-card { background:#fff; border:1px solid #ede9e0; border-radius:14px; padding:20px; }
        .stat-val { font-family:'DM Serif Display',serif; font-size:26px; color:#1a1a1a; }
        .stat-lbl { font-size:12px; color:#aaa; font-weight:500; margin-top:2px; }
        .toggle-pill { display:flex; background:#f0f0ec; border-radius:10px; padding:3px; gap:2px; }
        .toggle-opt { padding:7px 18px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:none; font-family:'DM Sans',sans-serif; transition:all 0.15s; }
        .toggle-opt.active { background:#fff; color:#1a1a1a; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
        .toggle-opt:not(.active) { background:transparent; color:#888; }
        .step-mobile { display:none; } @media (max-width: 767px) { .card { padding:16px; border-radius:12px; } .page-title { font-size:22px; } .stat-val { font-size:20px; } .stat-grid { grid-template-columns: repeat(2,1fr) !important; } .stat-grid > *:last-child:nth-child(odd) { grid-column: span 2; } .chart-grid { grid-template-columns: 1fr !important; } .goal-grid { grid-template-columns: repeat(2,1fr) !important; } .step-desktop { display:none !important; } .step-mobile { display:block !important; } .home-goal-grid { grid-template-columns: 1fr !important; } .mobile-single-col { grid-template-columns: 1fr !important; } }
      `}</style>

      <MaskProvider isMasked={isMasked}>
      <ResponsiveLayout page={page} setPage={setPage} currentLogged={currentLogged} nowLabel={nowLabel} isMasked={isMasked} toggleMask={()=>setIsMasked(m=>!m)}>
        {/* Banner */}
        {!currentLogged && page !== "checkin" && (
          <div onClick={()=>setPage("checkin")} style={{ background:"#fffbeb", border:"1px solid #fde68a", borderRadius:12, padding:"12px 18px", marginBottom:24, display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:18 }}>📅</span>
              <span style={{ fontSize:14, color:"#92400e" }}>You haven't logged <strong>{nowLabel()}</strong> yet.</span>
            </div>
            <span style={{ fontSize:13, color:"#d97706", fontWeight:500 }}>Start Check-in →</span>
          </div>
        )}
        {pages[page]}
      </ResponsiveLayout>
      </MaskProvider>
    </div>
  );
}

const NAV_ITEMS = [
  { id:"dashboard", icon:"⬡", label:"Dashboard" },
  { id:"trends", icon:"⟋", label:"Trends" },
  { id:"assets", icon:"◈", label:"Assets" },
  { id:"expenses", icon:"◉", label:"Expenses" },
  { id:"homegoal", icon:"⌂", label:"Home Goal" },
  { id:"settings", icon:"⚙", label:"Settings" },
];

function EyeIcon({ masked }) {
  return masked ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function ResponsiveLayout({ page, setPage, currentLogged, nowLabel, isMasked, toggleMask, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  if (isMobile) {
    return (
      <div style={{ display:"flex", flexDirection:"column", minHeight:"100vh", overflowX:"hidden" }}>
        {/* Mobile top bar */}
        <div style={{ background:"#fff", borderBottom:"1px solid #ede9e0", padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:50 }}>
          <div>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:18, color:"#1a1a1a" }}>Vault</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {!currentLogged && <div style={{ width:8, height:8, borderRadius:"50%", background:"#d97706" }} />}
            <button onClick={toggleMask} title={isMasked?"Show numbers":"Hide numbers"} style={{ background:"none", border:"none", cursor:"pointer", color: isMasked?"#2d6a4f":"#aaa", display:"flex", alignItems:"center", padding:4 }}>
              <EyeIcon masked={isMasked} />
            </button>
          </div>
        </div>
        {/* Page content */}
        <main style={{ flex:1, padding:"20px 16px 90px" }}>
          {children}
        </main>
        {/* Mobile bottom nav */}
        <nav style={{ position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #ede9e0", display:"flex", zIndex:50, paddingBottom:"env(safe-area-inset-bottom)" }}>
          {NAV_ITEMS.map(n => (
            <button key={n.id} onClick={()=>setPage(n.id)} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"10px 4px 8px", border:"none", background:"transparent", cursor:"pointer", gap:3, fontFamily:"'DM Sans',sans-serif" }}>
              <span style={{ fontSize:18, lineHeight:1 }}>{n.icon}</span>
              <span style={{ fontSize:9, fontWeight:500, color: page===n.id?"#2d6a4f":"#aaa", letterSpacing:"0.02em" }}>{n.label}</span>
              {page===n.id && <div style={{ width:16, height:2, background:"#2d6a4f", borderRadius:99, marginTop:1 }} />}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  // Desktop: collapsible sidebar
  const sidebarWidth = collapsed ? 64 : 220;
  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", position:"fixed", top:0, left:0, right:0, bottom:0 }}>
      <aside style={{ width:sidebarWidth, background:"#fff", borderRight:"1px solid #ede9e0", display:"flex", flexDirection:"column", gap:4, flexShrink:0, transition:"width 0.2s ease", overflow:"hidden", padding: collapsed?"16px 8px":"28px 16px", height:"100vh" }}>
        {/* Logo row */}
        <div style={{ display:"flex", alignItems:"center", justifyContent: collapsed?"center":"space-between", marginBottom:24, paddingLeft: collapsed?0:6 }}>
          {!collapsed && (
            <div>
              <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:20, color:"#1a1a1a" }}>Vault</div>
              <div style={{ fontSize:11, color:"#aaa", marginTop:2 }}>own your finances</div>
            </div>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            {!collapsed && (
              <button onClick={toggleMask} title={isMasked?"Show numbers":"Hide numbers"} style={{ background:"none", border:"none", cursor:"pointer", color: isMasked?"#2d6a4f":"#bbb", display:"flex", alignItems:"center", padding:4, borderRadius:6 }}>
                <EyeIcon masked={isMasked} />
              </button>
            )}
            <button onClick={()=>setCollapsed(c=>!c)} style={{ background:"#f4f0e8", border:"none", borderRadius:8, width:30, height:30, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:"#888", flexShrink:0 }}>
              {collapsed ? "→" : "←"}
            </button>
          </div>
        </div>

        {/* Nav items */}
        {NAV_ITEMS.slice(0,-1).map(n => (
          <button key={n.id} className={`nav-item${page===n.id?" active":""}`}
            onClick={()=>setPage(n.id)}
            title={collapsed ? n.label : ""}
            style={{ justifyContent: collapsed?"center":"flex-start", padding: collapsed?"10px":"10px 14px" }}>
            <span style={{ fontSize:17, flexShrink:0 }}>{n.icon}</span>
            {!collapsed && <span>{n.label}</span>}
          </button>
        ))}

        <div style={{ flex:1 }} />
        <button className={`nav-item${page==="settings"?" active":""}`}
          onClick={()=>setPage("settings")}
          title={collapsed ? "Settings" : ""}
          style={{ justifyContent: collapsed?"center":"flex-start", padding: collapsed?"10px":"10px 14px" }}>
          <span style={{ fontSize:17 }}>⚙</span>
          {!collapsed && <span>Settings</span>}
        </button>
        <button className="nav-item" onClick={signOut}
          title={collapsed ? "Sign out" : ""}
          style={{ justifyContent: collapsed?"center":"flex-start", padding: collapsed?"10px":"10px 14px", color:"#c0392b" }}>
          <span style={{ fontSize:17 }}>⇥</span>
          {!collapsed && <span>Sign out</span>}
        </button>
      </aside>

      <main style={{ flex:1, padding:"32px 36px", overflowY:"auto", maxWidth:960, height:"100vh" }}>
        {children}
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DYNAMIC SUBTEXT
// ════════════════════════════════════════════════════════════════════════════
function DynamicSubtext({ nwDelta, savingsRate, expTotal, income, snapshots }) {
  const allKeys = Object.keys(snapshots||{}).sort();
  const prevKey = allKeys.length >= 2 ? allKeys[allKeys.length-2] : null;
  const prevExpTotal = prevKey ? Object.values(snapshots[prevKey]?.expenses||{}).reduce((s,v)=>s+v,0) : null;
  const expDelta = prevExpTotal !== null ? expTotal - prevExpTotal : null;

  let insight = null;
  let subInsight = null;

  if (savingsRate !== null && savingsRate > 30) {
    insight = `Saving ${fmtPct(savingsRate)} of income this month`;
    subInsight = "— great progress.";
  } else if (nwDelta !== null && nwDelta > 0) {
    insight = `Net worth up ${fmtSGD(nwDelta)} this month`;
    subInsight = "— keep it up.";
  } else if (nwDelta !== null && nwDelta < 0) {
    insight = `Net worth down ${fmtSGD(Math.abs(nwDelta))} this month`;
    subInsight = "— worth a closer look.";
  } else if (expDelta !== null && expDelta > 0) {
    insight = `Expenses up ${fmtSGD(expDelta)} vs last month`;
    subInsight = "— worth reviewing before next check-in.";
  } else if (expDelta !== null && expDelta < 0) {
    insight = `Expenses down ${fmtSGD(Math.abs(expDelta))} vs last month`;
    subInsight = "— nice work.";
  } else if (savingsRate !== null) {
    insight = `Saving ${fmtPct(savingsRate)} of income this month`;
    subInsight = savingsRate > 15 ? "— on track." : "— consider cutting back.";
  } else {
    insight = "Here's where you stand today";
    subInsight = ".";
  }

  return (
    <div className="page-sub" style={{ marginBottom:24 }}>
      {insight}<span style={{ color:"#aaa" }}>{subInsight}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function Dashboard({ profile, sources, snapshots, currentLogged, latestSnap, setPage }) {
  const snap = latestSnap;
  const snapKeys = Object.keys(snapshots||{}).sort();
  const prevSnap = snapKeys.length >= 2 ? snapshots[snapKeys[snapKeys.length-2]] : null;

  // Net worth
  const cashTotal = snap ? (sources?.cash||[]).reduce((s,c)=> s+(snap.cash?.[c.id]||0),0) : 0;
  const investTotal = snap ? (sources?.investments||[]).reduce((s,i)=> s+(snap.investments?.[i.id]?.current||0),0) : 0;
  const cpfOaCash = snap?.cpf?.oaCash || snap?.cpf?.oa || 0; // fallback to oa for legacy data
  const cpfCpfisCurrent = snap?.cpf?.cpfisCurrent || 0;
  const cpfTotal = snap ? (cpfOaCash + cpfCpfisCurrent + (snap.cpf?.sa||0) + (snap.cpf?.ma||0)) : 0;
  const netWorth = cashTotal + investTotal + cpfTotal;
  const deployable = cashTotal + cpfOaCash + cpfCpfisCurrent;

  // Prev net worth for MoM delta
  const prevNetWorth = prevSnap ? (
    (sources?.cash||[]).reduce((s,c)=>s+(prevSnap.cash?.[c.id]||0),0) +
    (sources?.investments||[]).reduce((s,i)=>s+(prevSnap.investments?.[i.id]?.current||0),0) +
    (prevSnap.cpf?.oaCash||prevSnap.cpf?.oa||0)+(prevSnap.cpf?.cpfisCurrent||0)+(prevSnap.cpf?.sa||0)+(prevSnap.cpf?.ma||0)
  ) : null;
  const nwDelta = prevNetWorth !== null ? netWorth - prevNetWorth : null;

  // Savings rate + expenses
  const income = snap?.income || Number(profile?.salary) || 0;
  const expTotal = snap ? Object.values(snap.expenses||{}).reduce((s,v)=>s+v,0) : 0;
  const prevExpTotal = prevSnap ? Object.values(prevSnap.expenses||{}).reduce((s,v)=>s+v,0) : null;
  const expDelta = prevExpTotal !== null ? expTotal - prevExpTotal : null;
  const savingsRate = income > 0 ? ((income - expTotal) / income * 100) : null;

  // Last updated
  const lastKey = snapKeys[snapKeys.length-1];
  const lastUpdatedLabel = lastKey ? (() => { const [y,m]=lastKey.split("-"); return `${MONTHS[parseInt(m)-1]} ${y}`; })() : null;
  const isStale = lastKey ? (() => { const [y,m]=lastKey.split("-"); const d=new Date(parseInt(y),parseInt(m)-1,1); const now=new Date(); return (now.getFullYear()*12+now.getMonth())-(d.getFullYear()*12+d.getMonth()) > 1; })() : false;

  // Biggest expense
  const topExpCat = snap ? Object.entries(snap.expenses||{}).sort((a,b)=>b[1]-a[1])[0] : null;

  // Net worth trend (last 6)
  const trendData = snapKeys.slice(-6).map(k => {
    const s = snapshots[k];
    const c = (sources?.cash||[]).reduce((sum,ac)=>sum+(s.cash?.[ac.id]||0),0);
    const iv = (sources?.investments||[]).reduce((sum,ac)=>sum+(s.investments?.[ac.id]?.current||0),0);
    const cpOa = s.cpf?.oaCash||s.cpf?.oa||0;
    const cpCpfis = s.cpf?.cpfisCurrent||0;
    const cp = cpOa + cpCpfis + (s.cpf?.sa||0) + (s.cpf?.ma||0);
    const [y,m] = k.split("-");
    return { label: `${MONTHS[parseInt(m)-1]}`, value: c+iv+cp };
  });

  // Empty state
  if (snapKeys.length === 0) {
    return (
      <div>
        <div className="page-title">Good {greeting()}{profile?.name ? `, ${profile.name}` : ""}.</div>
        <div style={{ marginTop:40, textAlign:"center" }}>
          <div className="card" style={{ maxWidth:420, margin:"0 auto", padding:"48px 32px" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🌱</div>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:22, marginBottom:10 }}>Welcome to Vault</div>
            <div style={{ fontSize:14, color:"#888", marginBottom:28, lineHeight:1.6 }}>Own your finances now. Complete your first monthly check-in to see your net worth, spending trends, and home goal progress.</div>
            <button className="btn-primary" onClick={()=>setPage("checkin")} style={{ width:"100%" }}>Start First Check-in →</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4, flexWrap:"wrap", gap:8 }}>
        <div className="page-title">Good {greeting()}{profile?.name ? `, ${profile.name}` : ""}.</div>
        {lastUpdatedLabel && (
          <span className={`tag ${isStale?"tag-amber":"tag-green"}`} style={{ marginTop:6 }}>
            {isStale ? "⚠ " : "✓ "}Last updated: {lastUpdatedLabel}
          </span>
        )}
      </div>
      <DynamicSubtext nwDelta={nwDelta} savingsRate={savingsRate} expTotal={expTotal} income={income} snapshots={snapshots} />

      {/* Top stats — 3 cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }} className="stat-grid">
        <StatCard
          label="Net Worth"
          value={fmtSGD(netWorth)} isAmount={true}
          sub={snapKeys.length>0?`as of ${lastUpdatedLabel}`:"no data yet"}
          delta={nwDelta}
        />
        <StatCard label="Total Expenses" value={expTotal?fmtSGD(expTotal):"–"} sub="this month" isAmount={true} delta={expDelta} deltaInvert={true} />
        <StatCard label="Savings Rate" value={savingsRate!==null?fmtPct(savingsRate):"–"} sub="this month" color={savingsRate>30?"#2d6a4f":savingsRate>15?"#d97706":"#c0392b"} />
      </div>

      {/* Biggest expense callout */}
      {topExpCat && topExpCat[1] > 0 && income > 0 && (
        <div style={{ background:"#fafaf8", border:"1px solid #ede9e0", borderRadius:12, padding:"11px 18px", marginBottom:20, fontSize:13, color:"#666", display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>💸</span>
          <span>Top spend this month: <strong style={{ color:"#1a1a1a" }}>{topExpCat[0]}</strong> at <strong style={{ color:"#1a1a1a" }}><M val={topExpCat[1]} /></strong></span>
          <span style={{ color:"#aaa" }}>· {fmtPct(topExpCat[1]/income*100)} of income</span>
        </div>
      )}

      {/* Net worth trend + expense breakdown */}
      <div style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr", gap:16, marginBottom:24 }} className="chart-grid">
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Net Worth Trend</div>
          {trendData.length >= 2 ? (
            <DashNetWorthChart data={trendData} />
          ) : (
            <EmptyState text="Log at least 2 months to see your trend" action="Start Check-in" onClick={()=>setPage("checkin")} />
          )}
        </div>

        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Assets Breakdown</div>
          {snap ? (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <MiniBar label="Cash" value={cashTotal} total={netWorth} color="#2d6a4f" />
              <MiniBar label="Investments" value={investTotal} total={netWorth} color="#52b788" />
              <MiniBar label="CPF OA" value={cpfOaCash} total={netWorth} color="#74c69d" />
              {cpfCpfisCurrent > 0 && <MiniBar label="CPFIS (Invested OA)" value={cpfCpfisCurrent} total={netWorth} color="#95d5b2" />}
              <MiniBar label="CPF SA+MA" value={(snap?.cpf?.sa||0)+(snap?.cpf?.ma||0)} total={netWorth} color="#b7e4c7" />
            </div>
          ) : (
            <EmptyState text="No data yet" action="Start Check-in" onClick={()=>setPage("checkin")} />
          )}
        </div>
      </div>

      {/* Home goal preview */}
      <HomeGoalPreview profile={profile} deployable={deployable} income={income} expTotal={expTotal} setPage={setPage} />
    </div>
  );
}

function StatCard({ label, value, sub, accent, color, delta, deltaInvert, isAmount }) {
  const masked = useMask();
  return (
    <div className="stat-card" style={accent?{background:"#f0f7f4",borderColor:"#b7e4c7"}:{}}>
      <div className="stat-lbl">{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" }}>
        <div className="stat-val" style={color?{color}:{}}>{masked && isAmount!==false ? <span style={{ letterSpacing:"0.1em", color:"#bbb" }}>••••••</span> : value}</div>
        {!masked && delta !== null && delta !== undefined && (
          <span style={{ fontSize:12, fontWeight:500, color: deltaInvert ? (delta<=0?"#2d6a4f":"#c0392b") : (delta>=0?"#2d6a4f":"#c0392b") }}>
            {delta>=0?"▲":"▼"} <M val={Math.abs(delta)} />
          </span>
        )}
      </div>
      <div style={{ fontSize:12, color:"#bbb", marginTop:4 }}>{sub}</div>
    </div>
  );
}

function MiniBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.min(100, value/total*100) : 0;
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:5 }}>
        <span style={{ color:"#555" }}>{label}</span>
        <span style={{ fontWeight:500 }}><M val={value} /></span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
    </div>
  );
}

function HomeGoalPreview({ profile, deployable, income, expTotal, setPage }) {
  const [mode, setMode] = useState("hdb");
  const [hdbLoanType, setHdbLoanType] = useState("hdb"); // "hdb" or "bank"

  const goalKey = mode === "hdb" ? (hdbLoanType === "hdb" ? "hdbGoal" : "hdbBankGoal") : "condoGoal";
  const goal = profile?.[goalKey];
  const price = goal?.price || 0;
  const dpPct = (mode === "hdb" && hdbLoanType === "hdb") ? 0.20 : 0.25;
  const minCashPct = (mode === "hdb" && hdbLoanType === "hdb") ? 0.00 : 0.05;
  const showMSR = mode === "hdb" && hdbLoanType === "hdb";
  const dpNeeded = price * dpPct;
  const gap = Math.max(0, dpNeeded - deployable);
  const pct = dpNeeded > 0 ? Math.min(100, deployable/dpNeeded*100) : 0;
  const instalment = monthlyInstalment(price*(1-dpPct), goal?.rate, goal?.tenure);
  const msrOk = income > 0 ? (instalment / income * 100 <= 30) : null;
  const monthlySavings = Math.max(0, income - (expTotal||0));
  const monthsToGoal = gap > 0 && monthlySavings > 0 ? Math.ceil(gap / monthlySavings) : null;
  const yearsToGoal = monthsToGoal ? Math.floor(monthsToGoal/12) : null;
  const remMonths = monthsToGoal ? monthsToGoal % 12 : null;

  return (
    <div className="card">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:mode==="hdb"?12:20, flexWrap:"wrap", gap:8 }}>
        <div style={{ fontWeight:600 }}>Home Goal</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div className="toggle-pill">
            <button className={`toggle-opt${mode==="hdb"?" active":""}`} onClick={()=>setMode("hdb")}>HDB</button>
            <button className={`toggle-opt${mode==="condo"?" active":""}`} onClick={()=>setMode("condo")}>Condo</button>
          </div>
          <button className="btn-ghost" style={{ padding:"7px 14px", fontSize:13 }} onClick={()=>setPage("homegoal")}>Details →</button>
        </div>
      </div>
      {mode === "hdb" && (
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          <div className="toggle-pill" style={{ background:"#f8f7f4" }}>
            <button className={`toggle-opt${hdbLoanType==="hdb"?" active":""}`} onClick={()=>setHdbLoanType("hdb")} style={{ fontSize:12, padding:"5px 14px" }}>HDB Loan</button>
            <button className={`toggle-opt${hdbLoanType==="bank"?" active":""}`} onClick={()=>setHdbLoanType("bank")} style={{ fontSize:12, padding:"5px 14px" }}>Bank Loan</button>
          </div>
          <span style={{ fontSize:11, color:"#aaa", alignSelf:"center" }}>
            {hdbLoanType==="hdb" ? "2.6% · MSR" : "Market rate · No MSR"}
          </span>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:20 }} className="goal-grid">
        <div><div className="label">Target Price</div><div style={{ fontWeight:600, fontSize:16 }}><M val={price} /></div></div>
        <div><div className="label">Down Payment ({(dpPct*100).toFixed(0)}%){minCashPct>0?` (${(minCashPct*100).toFixed(0)}% cash)`:""}</div><div style={{ fontWeight:600, fontSize:16 }}><M val={dpNeeded} /></div></div>
        <div><div className="label">You Have</div><div style={{ fontWeight:600, fontSize:16, color:"#2d6a4f" }}><M val={deployable} /></div></div>
        <div>
          <div className="label">Time to Goal</div>
          {gap === 0 ? (
            <div style={{ fontWeight:700, fontSize:16, color:"#2d6a4f" }}>✓ Ready!</div>
          ) : monthsToGoal ? (
            <div style={{ fontWeight:700, fontSize:16, color:"#1a1a1a" }}>
              {yearsToGoal>0?`${yearsToGoal}y `:""}{ remMonths>0?`${remMonths}m`:""}
              <div style={{ fontSize:11, color:"#aaa", fontWeight:400 }}><M val={gap} /> gap</div>
            </div>
          ) : (
            <div style={{ fontWeight:600, fontSize:14, color:"#aaa" }}>–</div>
          )}
        </div>
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#aaa", marginBottom:6 }}>
          <span>Down payment progress</span><span>{pct.toFixed(0)}%</span>
        </div>
        <div className="progress-bar" style={{ height:10 }}>
          <div className="progress-fill" style={{ width:`${pct}%` }} />
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:12, fontSize:13, color:"#888", flexWrap:"wrap" }}>
        <span>Est. monthly instalment: <strong style={{ color:"#1a1a1a" }}><M val={instalment} /></strong></span>
        {msrOk !== null && showMSR && (
          <span className={`tag ${msrOk?"tag-green":"tag-red"}`}>{msrOk?"MSR OK":"MSR exceeded"}</span>
        )}
        {monthlySavings > 0 && <span style={{ color:"#aaa" }}>Saving <M val={monthlySavings} />/mo</span>}
      </div>
    </div>
  );
}

function EmptyState({ text, action, onClick }) {
  return (
    <div style={{ textAlign:"center", padding:"30px 0", color:"#bbb" }}>
      <div style={{ fontSize:14, marginBottom:12 }}>{text}</div>
      {action && <button className="btn-ghost" style={{ fontSize:13 }} onClick={onClick}>{action}</button>}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// ════════════════════════════════════════════════════════════════════════════
// CHECK-IN
// ════════════════════════════════════════════════════════════════════════════
function CheckIn({ profile, sources, snapshots, saveSnapshot, saveSources, setPage }) {
  const [step, setStep] = useState(0);
  const key = nowKey();
  const existing = snapshots?.[key];

  const [data, setData] = useState(() => existing || {
    cash: {},
    investments: {},
    cpf: { oaCash: "", cpfisInvested: "", cpfisCurrent: "", sa: "", ma: "" },
    expenses: {},
    income: profile?.salary || "",
  });

  const [newCashLabel, setNewCashLabel] = useState("");
  const [newInvLabel, setNewInvLabel] = useState("");

  const steps = ["Assets", "Expenses", "Income", "Review & Save"];

  function setCash(id, val) { setData(d => ({ ...d, cash: { ...d.cash, [id]: Number(val)||0 } })); }
  function setInv(id, field, val) { setData(d => ({ ...d, investments: { ...d.investments, [id]: { ...(d.investments[id]||{}), [field]: Number(val)||0 } } })); }
  function setCPF(field, val) { setData(d => ({ ...d, cpf: { ...d.cpf, [field]: Number(val)||0 } })); }
  function setExp(cat, val) { setData(d => ({ ...d, expenses: { ...d.expenses, [cat]: Number(val)||0 } })); }

  function addCashAccount() {
    if (!newCashLabel.trim()) return;
    const id = "c" + Date.now();
    const next = { ...sources, cash: [...(sources.cash||[]), { id, label: newCashLabel.trim() }] };
    saveSources(next);
    setNewCashLabel("");
  }
  function addInvAccount() {
    if (!newInvLabel.trim()) return;
    const id = "i" + Date.now();
    const next = { ...sources, investments: [...(sources.investments||[]), { id, label: newInvLabel.trim() }] };
    saveSources(next);
    setNewInvLabel("");
  }

  async function handleSave() {
    await saveSnapshot(key, { ...data, savedAt: new Date().toISOString() });
    setPage("dashboard");
  }

  const totalAssets = (sources?.cash||[]).reduce((s,c)=>s+(data.cash[c.id]||0),0)
    + (sources?.investments||[]).reduce((s,i)=>s+(data.investments[i.id]?.current||0),0)
    + (data.cpf.oaCash||0)+(data.cpf.cpfisCurrent||0)+(data.cpf.sa||0)+(data.cpf.ma||0);
  const totalExp = Object.values(data.expenses).reduce((s,v)=>s+v,0);

  return (
    <div>
      <div className="page-title">Monthly Check-in</div>
      <div className="page-sub">{nowLabel()} snapshot</div>

      {/* Step indicator — full on desktop, compact on mobile */}
      <div className="step-desktop" style={{ display:"flex", alignItems:"center", gap:0, marginBottom:32 }}>
        {steps.map((s,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }} onClick={()=>setStep(i)}>
              <div className="step-dot" style={{ background: i===step?"#2d6a4f":i<step?"#b7e4c7":"#ede9e0", color: i===step?"#fff":i<step?"#2d6a4f":"#aaa" }}>
                {i < step ? "✓" : i+1}
              </div>
              <span style={{ fontSize:13, fontWeight: i===step?600:400, color: i===step?"#1a1a1a":"#aaa" }}>{s}</span>
            </div>
            {i < steps.length-1 && <div style={{ width:32, height:1, background:"#ede9e0", margin:"0 8px" }} />}
          </div>
        ))}
      </div>
      <div className="step-mobile" style={{ marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <span style={{ fontSize:14, fontWeight:600 }}>{steps[step]}</span>
          <span style={{ fontSize:13, color:"#aaa" }}>Step {step+1} of {steps.length}</span>
        </div>
        <div className="progress-bar" style={{ height:4 }}>
          <div className="progress-fill" style={{ width:`${((step+1)/steps.length)*100}%` }} />
        </div>
      </div>

      <div className="card" style={{ maxWidth:640 }}>
        {step === 0 && (
          <div>
            <SectionTitle>CPF Accounts</SectionTitle>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, marginBottom:12 }}>
              <div>
                <label className="label">Ordinary (OA)</label>
                <input className="input-field" type="number" placeholder="0" value={data.cpf.oaCash||""} onChange={e=>setCPF("oaCash",e.target.value)} />
              </div>
              <div>
                <label className="label">Special (SA)</label>
                <input className="input-field" type="number" placeholder="0" value={data.cpf.sa||""} onChange={e=>setCPF("sa",e.target.value)} />
              </div>
              <div>
                <label className="label">MediSave (MA)</label>
                <input className="input-field" type="number" placeholder="0" value={data.cpf.ma||""} onChange={e=>setCPF("ma",e.target.value)} />
              </div>
            </div>
            <div style={{ background:"#f0f7f4", border:"1px solid #b7e4c7", borderRadius:10, padding:"12px 14px", marginBottom:24 }}>
              <div style={{ fontSize:12, fontWeight:600, color:"#2d6a4f", marginBottom:8 }}>CPFIS (Invested OA)</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }} className="mobile-single-col">
                <div>
                  <label className="label">Amount Invested (Cost)</label>
                  <input className="input-field" type="number" placeholder="0" value={data.cpf.cpfisInvested||""} onChange={e=>setCPF("cpfisInvested",e.target.value)} />
                </div>
                <div>
                  <label className="label">Current Value</label>
                  <input className="input-field" type="number" placeholder="0" value={data.cpf.cpfisCurrent||""} onChange={e=>setCPF("cpfisCurrent",e.target.value)} />
                </div>
              </div>
              <div style={{ fontSize:11, color:"#888", marginTop:8 }}>Stocks, ETFs or gold bought via CPFIS-OA. Leave blank if none.</div>
            </div>

            <SectionTitle>Cash Accounts</SectionTitle>
            {[...(sources?.cash||[])].sort((a,b)=>a.label.localeCompare(b.label)).map(c => (
              <div key={c.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <span style={{ fontSize:14, color:"#555", width:130, flexShrink:0 }}>{c.label}</span>
                <input className="input-field" type="number" placeholder="0" value={data.cash[c.id]||""} onChange={e=>setCash(c.id,e.target.value)} />
                <button onClick={()=>saveSources({...sources, cash: sources.cash.filter(x=>x.id!==c.id)})} style={{ background:"none", border:"none", cursor:"pointer", color:"#ddd", fontSize:16, flexShrink:0, padding:"0 4px", lineHeight:1 }} title="Remove">✕</button>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8, marginBottom:24 }}>
              <input className="input-field" placeholder="+ Add account (e.g. OCBC 360)" value={newCashLabel} onChange={e=>setNewCashLabel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCashAccount()} style={{ flex:1 }} />
              <button className="btn-ghost" onClick={addCashAccount}>Add</button>
            </div>

            <SectionTitle>Investments</SectionTitle>
            {[...(sources?.investments||[])].sort((a,b)=>a.label.localeCompare(b.label)).map(inv => (
              <div key={inv.id} style={{ marginBottom:14, background:"#fafaf8", borderRadius:10, padding:"10px 12px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                  <span style={{ fontSize:14, color:"#555", fontWeight:500 }}>{inv.label}</span>
                  <button onClick={()=>saveSources({...sources, investments: sources.investments.filter(x=>x.id!==inv.id)})} style={{ background:"none", border:"none", cursor:"pointer", color:"#ddd", fontSize:14, padding:"0 2px", lineHeight:1 }} title="Remove">✕</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }} className="mobile-single-col">
                  <div>
                    <label className="label">Amount Invested (Cost)</label>
                    <input className="input-field" type="number" placeholder="0" value={data.investments[inv.id]?.invested||""} onChange={e=>setInv(inv.id,"invested",e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Current Value</label>
                    <input className="input-field" type="number" placeholder="0" value={data.investments[inv.id]?.current||""} onChange={e=>setInv(inv.id,"current",e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <input className="input-field" placeholder="+ Add platform (e.g. Tiger Brokers)" value={newInvLabel} onChange={e=>setNewInvLabel(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addInvAccount()} style={{ flex:1 }} />
              <button className="btn-ghost" onClick={addInvAccount}>Add</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <SectionTitle>Monthly Expenses</SectionTitle>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12 }}>
              {EXPENSE_CATS.map(cat => (
                <div key={cat}>
                  <label className="label">{cat}</label>
                  <input className="input-field" type="number" placeholder="0" value={data.expenses[cat]||""} onChange={e=>setExp(cat,e.target.value)} />
                </div>
              ))}
            </div>
            <div className="divider" />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:14 }}>
              <span style={{ color:"#888" }}>Total expenses</span>
              <span style={{ fontWeight:600 }}><M val={totalExp} /></span>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <SectionTitle>Income This Month</SectionTitle>
            <div style={{ marginBottom:8 }}>
              <label className="label">Gross Monthly Income</label>
              <input className="input-field" type="number" placeholder="0" value={data.income||""} onChange={e=>setData(d=>({...d,income:Number(e.target.value)||0}))} />
            </div>
            <div style={{ fontSize:13, color:"#aaa", marginTop:8 }}>Pre-filled from your profile. Edit if you received a bonus or extra income this month.</div>
          </div>
        )}

        {step === 3 && (
          <div>
            <SectionTitle>Review Snapshot — {nowLabel()}</SectionTitle>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12, marginBottom:20 }}>
              <ReviewRow label="Total Assets" value={fmtSGD(totalAssets)} masked />
              <ReviewRow label="Total Expenses" value={fmtSGD(totalExp)} />
              <ReviewRow label="Income" value={fmtSGD(data.income)} />
              <ReviewRow label="Savings" value={fmtSGD((data.income||0)-totalExp)} color={(data.income||0)-totalExp>=0?"#2d6a4f":"#c0392b"} />
              <ReviewRow label="CPF Total" value={fmtSGD((data.cpf.oaCash||0)+(data.cpf.cpfisCurrent||0)+(data.cpf.sa||0)+(data.cpf.ma||0))} />
              <ReviewRow label="Deployable CPF" value={fmtSGD((data.cpf.oaCash||0)+(data.cpf.cpfisCurrent||0))} color="#2d6a4f" />
            </div>
            <div style={{ background:"#f8f7f4", borderRadius:10, padding:"12px 16px", fontSize:13, color:"#888", marginBottom:20 }}>
              This snapshot will be saved permanently and used in your trend charts.
            </div>
            <button className="btn-primary" style={{ width:"100%" }} onClick={handleSave}>
              Save {nowLabel()} Snapshot ✓
            </button>
          </div>
        )}

        <div className="divider" />
        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button className="btn-ghost" onClick={()=>setStep(s=>Math.max(0,s-1))} style={{ visibility:step>0?"visible":"hidden" }}>← Back</button>
          {step < 3 && <button className="btn-primary" onClick={()=>setStep(s=>s+1)}>Continue →</button>}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontWeight:600, fontSize:14, color:"#1a1a1a", marginBottom:12, marginTop:4 }}>{children}</div>;
}
function ReviewRow({ label, value, color }) {
  const masked = useMask();
  return (
    <div style={{ background:"#fafaf8", borderRadius:10, padding:"12px 14px" }}>
      <div style={{ fontSize:11, color:"#aaa", marginBottom:3 }}>{label}</div>
      <div style={{ fontWeight:600, fontSize:16, color:color||"#1a1a1a" }}>
        {masked ? <span style={{ letterSpacing:"0.1em", color:"#bbb" }}>••••••</span> : value}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ASSETS
// ════════════════════════════════════════════════════════════════════════════
function Assets({ sources, latestSnap, setPage }) {
  return (
    <div>
      <div className="page-title">Assets</div>
      <div className="page-sub">View your accounts and investments. To add new ones, go to Check-in.</div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }} className="mobile-single-col">
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Cash Accounts</div>
          {[...(sources?.cash||[])].sort((a,b)=>a.label.localeCompare(b.label)).map(c => (
            <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:500 }}>{c.label}</div>
                <div style={{ fontSize:13, color:"#aaa" }}><M val={latestSnap?.cash?.[c.id]||0} /></div>
              </div>

            </div>
          ))}

        </div>

        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Investment Platforms</div>
          {[...(sources?.investments||[])].sort((a,b)=>a.label.localeCompare(b.label)).map(i => {
            const inv = latestSnap?.investments?.[i.id]||{};
            const gain = (inv.current||0)-(inv.invested||0);
            return (
              <div key={i.id} style={{ padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:500 }}>{i.label}</div>
                    <div style={{ fontSize:13, color:"#aaa" }}>Current: <M val={inv.current||0} /></div>
                    {inv.invested > 0 && <div style={{ fontSize:12, color: gain>=0?"#2d6a4f":"#c0392b" }}>{gain>=0?"▲":"▼"} <M val={Math.abs(gain)} /> unrealised</div>}
                  </div>

                </div>
              </div>
            );
          })}

          {/* Total investments including CPFIS */}
          {(() => {
            const nonCpfTotal = (sources?.investments||[]).reduce((s,i)=>s+(latestSnap?.investments?.[i.id]?.current||0),0);
            const cpfisTotal = latestSnap?.cpf?.cpfisCurrent||0;
            const grandTotal = nonCpfTotal + cpfisTotal;
            if (grandTotal === 0) return null;
            return (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px", background:"#f8f7f4", borderRadius:8, marginTop:12 }}>
                <span style={{ fontSize:13, color:"#888" }}>Total investments incl. CPFIS</span>
                <span style={{ fontWeight:700 }}><M val={grandTotal} /></span>
              </div>
            );
          })()}
        </div>

        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>CPF Accounts</div>
          {/* OA Cash */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:500 }}>Ordinary Account</div>
              <div style={{ fontSize:12, color:"#aaa" }}>Uninvested, deployable for housing</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:600 }}><M val={latestSnap?.cpf?.oaCash||latestSnap?.cpf?.oa||0} /></div>
              <span className="tag tag-green" style={{ fontSize:11 }}>Deployable</span>
            </div>
          </div>
          {/* CPFIS — investment style row */}
          {(() => {
            const invested = latestSnap?.cpf?.cpfisInvested||0;
            const current = latestSnap?.cpf?.cpfisCurrent||0;
            const gain = current - invested;
            return (
              <div style={{ padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:500 }}>CPFIS (Invested OA)</div>
                    <div style={{ fontSize:12, color:"#aaa" }}>Stocks/ETFs via CPFIS-OA · Cost: <M val={invested} /></div>
                    {invested > 0 && <div style={{ fontSize:12, color: gain>=0?"#2d6a4f":"#c0392b", marginTop:2 }}>{gain>=0?"▲":"▼"} <M val={Math.abs(gain)} /> unrealised</div>}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:600 }}>{current > 0 ? <M val={current} /> : "–"}</div>
                    <span className="tag tag-green" style={{ fontSize:11 }}>Deployable</span>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* SA + MA */}
          {[["sa","Special Account","Retirement savings"],["ma","MediSave Account","Healthcare only"]].map(([f,l,sub])=>(
            <div key={f} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
              <div>
                <div style={{ fontSize:14, fontWeight:500 }}>{l}</div>
                <div style={{ fontSize:12, color:"#aaa" }}>{sub}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:600 }}><M val={latestSnap?.cpf?.[f]||0} /></div>
                <span className="tag tag-amber" style={{ fontSize:11 }}>Locked</span>
              </div>
            </div>
          ))}
          {/* CPF total deployable */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", background:"#f0f7f4", borderRadius:8, paddingLeft:10, paddingRight:10, marginTop:8 }}>
            <span style={{ fontSize:13, fontWeight:500, color:"#2d6a4f" }}>Total Deployable (OA + CPFIS)</span>
            <span style={{ fontWeight:700, color:"#2d6a4f" }}><M val={(latestSnap?.cpf?.oaCash||latestSnap?.cpf?.oa||0)+(latestSnap?.cpf?.cpfisCurrent||0)} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════════════
function Expenses({ snapshots }) {
  const keys = Object.keys(snapshots||{}).sort().reverse();
  const [selKey, setSelKey] = useState(keys[0]||"");
  const snap = snapshots?.[selKey];
  const expenses = snap?.expenses||{};
  const total = Object.values(expenses).reduce((s,v)=>s+v,0);
  const income = snap?.income||0;

  // Previous month snapshot for MoM delta
  const allKeysSorted = Object.keys(snapshots||{}).sort();
  const selIdx = allKeysSorted.indexOf(selKey);
  const prevKey = selIdx > 0 ? allKeysSorted[selIdx-1] : null;
  const prevExp = prevKey ? (snapshots[prevKey]?.expenses||{}) : null;

  // bar data
  const barData = EXPENSE_CATS.filter(c=>expenses[c]>0).map(c=>({ name:c, amount:expenses[c] })).sort((a,b)=>b.amount-a.amount);

  return (
    <div>
      <div className="page-title">Expenses</div>
      <div className="page-sub">Monthly actuals by category</div>

      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
        <label className="label" style={{ marginBottom:0 }}>Month:</label>
        <select className="input-field" style={{ width:160 }} value={selKey} onChange={e=>setSelKey(e.target.value)}>
          {keys.map(k => {
            const [y,m] = k.split("-");
            return <option key={k} value={k}>{MONTHS[parseInt(m)-1]} {y}</option>;
          })}
        </select>
        {prevKey && (() => { const [y,m]=prevKey.split("-"); return <span style={{ fontSize:12, color:"#aaa" }}>vs {MONTHS[parseInt(m)-1]} {y}</span>; })()}
      </div>

      {snap ? (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:20 }} className="mobile-single-col">
          <div className="card">
            <div style={{ fontWeight:600, marginBottom:16 }}>Breakdown</div>
            {EXPENSE_CATS.map(cat => {
              const val = expenses[cat]||0;
              const pct = total>0?val/total*100:0;
              const prev = prevExp ? (prevExp[cat]||0) : null;
              const delta = prev !== null ? val - prev : null;
              return (
                <div key={cat} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, marginBottom:4 }}>
                    <span style={{ color:"#555" }}>{cat}</span>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      {delta !== null && val > 0 && (
                        <span style={{ fontSize:11, fontWeight:500, color: delta>0?"#c0392b":delta<0?"#2d6a4f":"#aaa" }}>
                          {delta>0?"▲":delta<0?"▼":"–"}{delta!==0?<M val={Math.abs(delta)} />:""}
                        </span>
                      )}
                      <span style={{ fontWeight:500 }}>{val>0?<M val={val} />:"–"}</span>
                    </div>
                  </div>
                  {val>0 && <div className="progress-bar"><div className="progress-fill" style={{ width:`${pct}%`, background:"#52b788" }} /></div>}
                </div>
              );
            })}
            <div className="divider" />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:14 }}>
              <span style={{ color:"#888" }}>Total</span>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {prevExp && (() => { const pt=Object.values(prevExp).reduce((s,v)=>s+v,0); const d=total-pt; return d!==0?<span style={{ fontSize:12, color:d>0?"#c0392b":"#2d6a4f" }}>{d>0?"▲":"▼"}<M val={Math.abs(d)} /></span>:null; })()}
                <span style={{ fontWeight:700 }}><M val={total} /></span>
              </div>
            </div>
            {income>0 && <div style={{ fontSize:13, color:"#aaa", marginTop:6 }}>
              {fmtPct(total/income*100)} of income · Saved <M val={income-total} />
            </div>}
          </div>

          <div className="card">
            <div style={{ fontWeight:600, marginBottom:16 }}>By Category</div>
            {barData.length > 0 ? (
              <ExpensesBarChart data={barData} />
            ) : <EmptyState text="No expenses logged this month" />}
          </div>
        </div>
      ) : <EmptyState text="No snapshots yet. Complete a Check-in first." />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HOME GOAL
// ════════════════════════════════════════════════════════════════════════════
function HomeGoal({ profile, saveProfile, latestSnap }) {
  const [mode, setMode] = useState("hdb");
  const [hdbLoanType, setHdbLoanType] = useState("hdb");

  const goalKey = mode==="hdb" ? (hdbLoanType==="hdb" ? "hdbGoal" : "hdbBankGoal") : "condoGoal";
  const goal = profile?.[goalKey] || (mode==="hdb" ? (hdbLoanType==="hdb" ? {price:550000,tenure:25,rate:2.6} : {price:550000,tenure:30,rate:2.5}) : {price:1300000,tenure:30,rate:2.5});
  const showMSR = mode==="hdb" && hdbLoanType==="hdb";

  function setGoalField(field, val) {
    saveProfile({ ...profile, [goalKey]: { ...goal, [field]: Number(val)||0 } });
  }

  const price = goal?.price||0;
  const tenure = goal?.tenure||(mode==="hdb"&&hdbLoanType==="hdb"?25:30);
  const rate = goal?.rate||(mode==="hdb"&&hdbLoanType==="hdb"?2.6:2.5);
  const dpPct = (mode==="hdb"&&hdbLoanType==="hdb")?0.20:0.25;
  const minCashPct = (mode==="hdb"&&hdbLoanType==="hdb")?0.00:0.05;
  const dpTotal = price*dpPct;
  const cashDp = price*minCashPct;
  const cpfDp = dpTotal-cashDp; // max portion coverable by CPF OA
  const loanAmt = price*(1-dpPct);
  const instalment = monthlyInstalment(loanAmt, rate, tenure);

  const cashLiquid = latestSnap ? Object.values(latestSnap.cash||{}).reduce((s,v)=>s+v,0) : 0;
  const cpfOA = latestSnap?.cpf?.oaCash || latestSnap?.cpf?.oa || 0; // fallback for legacy data
  const cpfCpfis = latestSnap?.cpf?.cpfisCurrent || 0;
  const deployable = cashLiquid + cpfOA + cpfCpfis;
  const gap = Math.max(0, dpTotal-deployable);
  const pct = dpTotal>0?Math.min(100,deployable/dpTotal*100):0;

  const income = Number(profile?.salary)||latestSnap?.income||0; // profile salary is source of truth for loan calcs
  const debtPayments = (profile?.debts||[]).reduce((s,d)=>s+(Number(d.monthly)||0),0);
  const maxTDSR = income*0.55 - debtPayments;
  const maxLoan = maxTDSR > 0 ? maxTDSR * tenure * 12 : 0; // simplified
  const msrPct = income>0?instalment/income*100:null;
  const tdsrPct = income>0?(instalment+debtPayments)/income*100:null;

  return (
    <div>
      <div className="page-title">Home Goal</div>
      <div className="page-sub">Track your affordability and plan your timeline.</div>

      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div className="toggle-pill">
            <button className={`toggle-opt${mode==="hdb"?" active":""}`} onClick={()=>setMode("hdb")}>HDB</button>
            <button className={`toggle-opt${mode==="condo"?" active":""}`} onClick={()=>setMode("condo")}>Condo</button>
          </div>
          {mode==="hdb" && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="toggle-pill" style={{ background:"#f8f7f4" }}>
                <button className={`toggle-opt${hdbLoanType==="hdb"?" active":""}`} onClick={()=>setHdbLoanType("hdb")} style={{ fontSize:12, padding:"5px 14px" }}>HDB Loan</button>
                <button className={`toggle-opt${hdbLoanType==="bank"?" active":""}`} onClick={()=>setHdbLoanType("bank")} style={{ fontSize:12, padding:"5px 14px" }}>Bank Loan</button>
              </div>
              <span style={{ fontSize:12, color:"#aaa" }}>
                {hdbLoanType==="hdb" ? "2.6% · MSR" : "Market rate · No MSR"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }} className="home-goal-grid">
        {/* Inputs */}
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Goal Parameters</div>
          <div style={{ display:"grid", gap:14 }}>
            <div>
              <label className="label">Target Property Price (S$)</label>
              <input className="input-field" type="number" value={goal?.price||""} onChange={e=>setGoalField("price",e.target.value)} />
            </div>
            <div>
              <label className="label">Loan Tenure (years)</label>
              <input className="input-field" type="number" value={goal?.tenure||""} onChange={e=>setGoalField("tenure",e.target.value)} />
            </div>
            <div>
              <label className="label">Interest Rate (%)</label>
              <input className="input-field" type="number" step="0.1" value={goal?.rate||""} onChange={e=>setGoalField("rate",e.target.value)} />
            </div>
          </div>
        </div>

        {/* Down payment */}
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Down Payment Breakdown</div>
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6 }}>
              <span style={{ color:"#888" }}>Total required ({(dpPct*100).toFixed(0)}%)</span>
              <span style={{ fontWeight:600 }}><M val={dpTotal} /></span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6 }}>
              <span style={{ color:"#888" }}>Min. hard cash ({(minCashPct*100).toFixed(0)}%)</span>
              <span style={{ fontWeight:500 }}><M val={cashDp} /></span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:16 }}>
              <span style={{ color:"#888" }}>Can use CPF OA</span>
              <span style={{ fontWeight:500 }}><M val={cpfDp} /></span>
            </div>
            <div className="divider" style={{ margin:"10px 0" }} />
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
              <span style={{ color:"#888" }}>Cash</span>
              <span style={{ fontWeight:500 }}><M val={cashLiquid} /></span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
              <span style={{ color:"#888" }}>CPF OA</span>
              <span style={{ fontWeight:500 }}><M val={cpfOA} /></span>
            </div>
            {cpfCpfis > 0 && <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:4 }}>
              <span style={{ color:"#888" }}>CPFIS (current value)</span>
              <span style={{ fontWeight:500 }}><M val={cpfCpfis} /></span>
            </div>}
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6, paddingTop:6, borderTop:"1px solid #f0ede6" }}>
              <span style={{ color:"#888", fontWeight:500 }}>Total deployable</span>
              <span style={{ fontWeight:600, color:"#2d6a4f" }}><M val={deployable} /></span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
              <span style={{ color:"#888" }}>Gap</span>
              <span style={{ fontWeight:700, color:gap===0?"#2d6a4f":"#c0392b" }}>{gap===0?"✓ Ready!":<M val={gap} />}</span>
            </div>
          </div>
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#aaa", marginBottom:6 }}>
              <span>Progress to down payment</span><span>{pct.toFixed(0)}%</span>
            </div>
            <div className="progress-bar" style={{ height:12 }}>
              <div className="progress-fill" style={{ width:`${pct}%` }} />
            </div>
          </div>
        </div>

        {/* Loan & affordability */}
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Loan & Monthly Cost</div>
          <div style={{ display:"grid", gap:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
              <span style={{ fontSize:13, color:"#888" }}>Loan amount</span>
              <span style={{ fontWeight:600 }}><M val={loanAmt} /></span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
              <span style={{ fontSize:13, color:"#888" }}>Monthly instalment</span>
              <span style={{ fontWeight:600 }}><M val={instalment} /></span>
            </div>
            {msrPct !== null && showMSR && (
              <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f4f0e8" }}>
                <span style={{ fontSize:13, color:"#888" }}>MSR (max 30%)</span>
                <span style={{ fontWeight:600 }}><span className={`tag ${msrPct<=30?"tag-green":"tag-red"}`}>{fmtPct(msrPct)}</span></span>
              </div>
            )}
            {tdsrPct !== null && (
              <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0" }}>
                <span style={{ fontSize:13, color:"#888" }}>TDSR (max 55%)</span>
                <span style={{ fontWeight:600 }}><span className={`tag ${tdsrPct<=55?"tag-green":"tag-red"}`}>{fmtPct(tdsrPct)}</span></span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Timeline Estimate</div>
          {gap > 0 && income > 0 ? (
            <TimelineEstimate gap={gap} income={income} expenses={latestSnap?.expenses||{}} salary={Number(profile?.salary)||income} />
          ) : gap === 0 ? (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>🎉</div>
              <div style={{ fontWeight:600, color:"#2d6a4f" }}>You can afford the down payment!</div>
              <div style={{ fontSize:13, color:"#aaa", marginTop:6 }}>Check your MSR/TDSR ratios and speak to a bank.</div>
            </div>
          ) : (
            <EmptyState text="Complete a Check-in first to see your timeline" />
          )}
          {/* CPF Projection */}
          {income > 0 && (
            <>
              <div className="divider" />
              <CPFProjection salary={income} currentOA={(latestSnap?.cpf?.oaCash||latestSnap?.cpf?.oa||0)+(latestSnap?.cpf?.cpfisCurrent||0)} />
            </>
          )}
          <div className="divider" />
          <div style={{ background:"#fffbeb", borderRadius:10, padding:"12px 14px", fontSize:12, color:"#92400e" }}>
            ⚠️ Budget separately for: Stamp duty, legal fees & misc (~S$15,000–30,000 not included above)
          </div>
        </div>
      </div>
    </div>
  );
}

function CPFProjection({ salary, currentOA }) {
  // OA growth: 37% total CPF (20% employee + 17% employer) × 62% OA allocation = ~23% of salary
  const monthlyOAContrib = Math.round(salary * 0.23); // ~23% of gross to OA (employee + employer combined)
  const monthlyCPFEmployee = Math.round(salary * 0.20); // 20% employee contribution shown in label
  const proj6 = currentOA + monthlyOAContrib * 6;
  const proj12 = currentOA + monthlyOAContrib * 12;
  return (
    <div>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:8, color:"#555" }}>CPF OA Auto-Growth Projection</div>
      <div style={{ fontSize:12, color:"#aaa", marginBottom:10 }}>Based on <M val={monthlyCPFEmployee} />/mo (20% × <M val={salary} />) CPF contributions from your salary</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }} className="mobile-single-col">
        <div style={{ background:"#f0f7f4", borderRadius:10, padding:"10px 14px" }}>
          <div style={{ fontSize:11, color:"#888", marginBottom:3 }}>In 6 months</div>
          <div style={{ fontWeight:600, fontSize:15, color:"#2d6a4f" }}><M val={proj6} /></div>
        </div>
        <div style={{ background:"#f0f7f4", borderRadius:10, padding:"10px 14px" }}>
          <div style={{ fontSize:11, color:"#888", marginBottom:3 }}>In 12 months</div>
          <div style={{ fontWeight:600, fontSize:15, color:"#2d6a4f" }}><M val={proj12} /></div>
        </div>
      </div>
    </div>
  );
}

function TimelineEstimate({ gap, income, expenses, salary }) {
  const totalExp = Object.values(expenses).reduce((s,v)=>s+v,0);
  const cashSavings = Math.max(0, income - totalExp);
  const monthlyOA = Math.round((salary||income) * 0.23); // employee + employer OA contributions
  const totalMonthlyProgress = cashSavings + monthlyOA;
  if (totalMonthlyProgress <= 0) return <div style={{ fontSize:14, color:"#c0392b" }}>Your expenses exceed income. Review your spending.</div>;
  const months = Math.ceil(gap / totalMonthlyProgress);
  const years = Math.floor(months/12);
  const rem = months % 12;
  return (
    <div>
      {/* Monthly progress breakdown */}
      <div style={{ background:"#f8f7f4", borderRadius:10, padding:"12px 14px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6 }}>
          <span style={{ color:"#888" }}>Cash savings</span>
          <span style={{ fontWeight:500 }}><M val={cashSavings} />/mo</span>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:8 }}>
          <span style={{ color:"#888" }}>CPF OA auto-growth</span>
          <span style={{ fontWeight:500 }}><M val={monthlyOA} />/mo</span>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, paddingTop:8, borderTop:"1px solid #ede9e0" }}>
          <span style={{ fontWeight:600 }}>Total monthly progress</span>
          <span style={{ fontWeight:700, color:"#2d6a4f" }}><M val={totalMonthlyProgress} />/mo</span>
        </div>
      </div>
      <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:36, color:"#2d6a4f", marginBottom:4 }}>
        {years>0?`${years}y `:""}{ rem>0?`${rem}m`:""}
      </div>
      <div style={{ fontSize:13, color:"#aaa", marginBottom:14 }}>{months} months to reach your down payment goal</div>
      <div>
        {[1000,2000,3000].map(extra => {
          const newRate = totalMonthlyProgress+extra;
          const newMonths = Math.ceil(gap/newRate);
          const saved = months-newMonths;
          return (
            <div key={extra} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"6px 0", borderBottom:"1px solid #f4f0e8" }}>
              <span style={{ color:"#888" }}>+<M val={extra} />/mo more cash savings</span>
              <span style={{ color:"#2d6a4f", fontWeight:500 }}>saves {saved} months</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MASKED CHART COMPONENTS
// ════════════════════════════════════════════════════════════════════════════
function DashNetWorthChart({ data }) {
  const { amt, amtTip } = useChartFmt();
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
        <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} width={70} />
        <Tooltip formatter={(v,n)=>amtTip(v,"Net Worth")} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
        <Line type="monotone" dataKey="value" stroke="#2d6a4f" strokeWidth={2.5} dot={{ r:4, fill:"#2d6a4f" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ExpensesBarChart({ data }) {
  const { amt, amtTip } = useChartFmt();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" horizontal={false} />
        <XAxis type="number" tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} />
        <YAxis type="category" dataKey="name" tick={{ fontSize:12, fill:"#555" }} axisLine={false} tickLine={false} width={100} />
        <Tooltip formatter={(v,n)=>amtTip(v,"Amount")} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
        <Bar dataKey="amount" fill="#52b788" radius={[0,6,6,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TRENDS
// ════════════════════════════════════════════════════════════════════════════
function Trends({ snapshots }) {
  const { amt, amtTip } = useChartFmt();
  const keys = Object.keys(snapshots||{}).sort();

  if (keys.length < 2) return (
    <div>
      <div className="page-title">Trends</div>
      <div className="page-sub">MoM charts appear after 2+ months of data</div>
      <div className="card" style={{ textAlign:"center", padding:"60px 0" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>📈</div>
        <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Not enough data yet</div>
        <div style={{ fontSize:14, color:"#aaa" }}>Complete at least 2 monthly check-ins to see your trends.</div>
      </div>
    </div>
  );

  // Build chart data
  const chartData = keys.map(k => {
    const s = snapshots[k];
    const [y,m] = k.split("-");
    const cash = Object.values(s.cash||{}).reduce((sum,v)=>sum+v,0);
    const inv = Object.values(s.investments||{}).reduce((sum,v)=>sum+(v.current||0),0);
    const cpf = (s.cpf?.oaCash||s.cpf?.oa||0)+(s.cpf?.cpfisCurrent||0)+(s.cpf?.sa||0)+(s.cpf?.ma||0);
    const exp = Object.values(s.expenses||{}).reduce((sum,v)=>sum+v,0);
    const inc = s.income||0;
    return {
      label: `${MONTHS[parseInt(m)-1]} ${y.slice(2)}`,
      netWorth: cash+inv+cpf,
      deployable: cash+(s.cpf?.oaCash||s.cpf?.oa||0)+(s.cpf?.cpfisCurrent||0),
      savingsRate: inc>0?Math.round((inc-exp)/inc*100):0,
      income: inc,
      expenses: exp,
      cash, investments: inv, cpfTotal: cpf,
      ...Object.fromEntries(EXPENSE_CATS.map(c=>[c, s.expenses?.[c]||0]))
    };
  });

  return (
    <div>
      <div className="page-title">Trends</div>
      <div className="page-sub">{keys.length} months of data</div>

      <div style={{ display:"grid", gap:20 }}>
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Net Worth over Time</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
              <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} width={75} />
              <Tooltip formatter={amtTip} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
              <Legend />
              <Line type="monotone" dataKey="netWorth" name="Net Worth" stroke="#2d6a4f" strokeWidth={2.5} dot={{ r:4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }} className="mobile-single-col">
          <div className="card">
            <div style={{ fontWeight:600, marginBottom:16 }}>Savings Rate (%)</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
                <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} width={40} />
                <Tooltip formatter={v=>[`${v}%`,"Savings Rate"]} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
                <Line type="monotone" dataKey="savingsRate" stroke="#52b788" strokeWidth={2.5} dot={{ r:4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div style={{ fontWeight:600, marginBottom:16 }}>Income vs Expenses</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
                <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} width={70} />
                <Tooltip formatter={amtTip} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
                <Legend />
                <Bar dataKey="income" name="Income" fill="#2d6a4f" radius={[4,4,0,0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#f4a261" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Expense Breakdown over Time</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
              <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} width={70} />
              <Tooltip formatter={amtTip} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
              <Legend />
              {EXPENSE_CATS.slice(0,6).map((c,i)=>(
                <Bar key={c} dataKey={c} stackId="a" fill={["#2d6a4f","#52b788","#74c69d","#b7e4c7","#f4a261","#e9c46a","#e76f51"][i%7]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Asset Composition over Time</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede6" />
              <XAxis dataKey="label" tick={{ fontSize:12, fill:"#aaa" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize:11, fill:"#aaa" }} axisLine={false} tickLine={false} tickFormatter={amt} width={75} />
              <Tooltip formatter={amtTip} contentStyle={{ borderRadius:8, border:"1px solid #ede9e0", fontSize:13 }} />
              <Legend />
              <Bar dataKey="cash" name="Cash" stackId="a" fill="#2d6a4f" />
              <Bar dataKey="investments" name="Investments" stackId="a" fill="#52b788" />
              <Bar dataKey="cpfTotal" name="CPF" stackId="a" fill="#b7e4c7" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════
function Settings({ profile, saveProfile, sources, saveSources, setPage }) {
  const [name, setName] = useState(profile?.name||"");
  const [salary, setSalary] = useState(profile?.salary||"");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await saveProfile({ ...profile, name: name.trim(), salary: Number(salary)||0, debts: [] });
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  }

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4, flexWrap:"wrap", gap:8 }}>
        <div className="page-title">Settings</div>
        <button className="btn-primary" onClick={()=>setPage("checkin")} style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span>✦</span> Monthly Check-in
        </button>
      </div>
      <div className="page-sub">Your profile and financial baseline</div>

      <div style={{ maxWidth:400 }}>
        <div className="card">
          <div style={{ fontWeight:600, marginBottom:16 }}>Profile</div>
          <label className="label">Your Name</label>
          <input className="input-field" type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Adriel" style={{ marginBottom:14 }} />
          <label className="label">Gross Monthly Salary (S$)</label>
          <input className="input-field" type="number" value={salary} onChange={e=>setSalary(e.target.value)} placeholder="e.g. 5000" />
          <div style={{ fontSize:12, color:"#aaa", marginTop:8 }}>Used to calculate TDSR, MSR and savings rate.</div>
        </div>
      </div>

      <div style={{ marginTop:20, maxWidth:720 }}>
        <button className="btn-primary" onClick={handleSave}>{saved?"✓ Saved!":"Save Settings"}</button>
      </div>
    </div>
  );
}
