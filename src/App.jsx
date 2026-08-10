import { useState, useEffect } from "react";

// ========== CONSTANTS ==========
const SITES = [
  { id: "qatour", name: "عنبر قطور", barns: ["عنبر 1"] },
  { id: "sayari", name: "مزرعة الصيري", barns: ["عنبر 1", "عنبر 2", "عنبر 3"] },
  { id: "elwad", name: "مزرعة الوادي", barns: ["عنبر 1", "عنبر 2", "عنبر 3", "عنبر 4"] },
  { id: "taha", name: "عنبر طه", barns: ["عنبر 1", "عنبر 2", "عنبر 3", "عنبر 4"] },
];

const SUPA_URL = "https://devxozrfoxvypllmhijj.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRldnhvenJmb3h2eXBsbG1oaWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTA1NzgsImV4cCI6MjA5Njc4NjU3OH0.JnYQyOnYf501SjkNtMBp1GGyLhtQQ8gAY6ElXnjrVRk";
const SUPA_HDR = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" };

// ========== DATA HELPERS ==========
const num = (v) => parseFloat(v) || 0;
const genId = () => Math.random().toString(36).slice(2, 9);

const emptyShift = () => ({ mortality: "", feed: "" });
const emptySession = (barnName) => ({
  barnName, startDate: "", birdCount: "", active: true,
  dailyRecords: [], weeklyWeights: [],
});

const makeEmpty = () => {
  const sites = {};
  SITES.forEach(s => {
    sites[s.id] = { sessions: {}, archive: [], feedStore: { received: [], dispatched: [], returned: [] }, medStore: { received: [], returned: [] }, gasStore: { received: [] }, injections: [] };
    s.barns.forEach(b => { sites[s.id].sessions[b] = null; });
  });
  return { sites };
};

// المواقع اللي المدير ضافها من الإعدادات بيتم مزامنتها هنا مع قائمة SITES الأساسية
const syncCustomSites = (d) => {
  (d?.customSites || []).forEach(cs => {
    if (cs?.id && !SITES.find(s => s.id === cs.id)) SITES.push(cs);
  });
  // العنابر اللي اتضافت بعدين لأي موقع (سواء موقع أساسي أو مُضاف) بتتزامن هنا
  Object.entries(d?.extraBarns || {}).forEach(([siteId, barns]) => {
    const s = SITES.find(x => x.id === siteId);
    if (s && Array.isArray(barns)) {
      barns.forEach(b => { if (!s.barns.includes(b)) s.barns.push(b); });
    }
  });
};

const mergeData = (d) => {
  syncCustomSites(d);
  const empty = makeEmpty();
  if (!d || !d.sites) return empty;
  SITES.forEach(site => {
    if (!d.sites[site.id]) { d.sites[site.id] = empty.sites[site.id]; return; }
    site.barns.forEach(b => { if (!(b in d.sites[site.id].sessions)) d.sites[site.id].sessions[b] = null; });
    if (!d.sites[site.id].feedStore) d.sites[site.id].feedStore = { received: [], dispatched: [], returned: [] };
    if (!d.sites[site.id].feedStore.returned) d.sites[site.id].feedStore.returned = [];
    if (!d.sites[site.id].archive) d.sites[site.id].archive = [];
    if (!d.sites[site.id].medStore || Array.isArray(d.sites[site.id].medStore)) d.sites[site.id].medStore = { received: [], returned: [] };
    if (!d.sites[site.id].medStore.received) d.sites[site.id].medStore.received = [];
    if (!d.sites[site.id].medStore.returned) d.sites[site.id].medStore.returned = [];
    if (!d.sites[site.id].gasStore) d.sites[site.id].gasStore = { received: [] };
    if (!d.sites[site.id].gasStore.received) d.sites[site.id].gasStore.received = [];
    if (!d.sites[site.id].injections) d.sites[site.id].injections = [];
  });
  return d;
};

const calcDayStats = (r) => ({
  mortality: num(r.night.mortality) + num(r.day.mortality),
  feed: num(r.night.feed) + num(r.day.feed),
});

const calcAge = (startDate, endDate) => {
  if (!startDate) return 0;
  const end = endDate ? new Date(endDate) : new Date();
  return Math.floor((end - new Date(startDate)) / 86400000);
};

const calcFCR = (totalFeed, avgWeightG, birds) => {
  if (!avgWeightG || !birds || !totalFeed) return "-";
  const meat = (num(avgWeightG) / 1000) * num(birds);
  return meat ? (totalFeed / meat).toFixed(2) : "-";
};

// ========== SUPABASE ==========
const supaCall = async (path, query = "", method = "GET", body = null, prefer = "") => {
  try {
    const h = { ...SUPA_HDR };
    if (prefer) h["Prefer"] = prefer;
    const url = `${SUPA_URL}/rest/v1/${path}${query ? "?" + query : ""}`;
    const res = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : null });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
};

const saveToSupa = async (data) => {
  try {
    await fetch(`${SUPA_URL}/rest/v1/farm_data`, {
      method: "POST",
      headers: { ...SUPA_HDR, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ id: "main", data, updated_at: new Date().toISOString() })
    });
  } catch {}
};

const loadFromSupa = async () => {
  try {
    const rows = await supaCall("farm_data", "id=eq.main&select=*");
    return rows?.[0]?.data || null;
  } catch { return null; }
};

const saveData = async (data) => {
  try { localStorage.setItem("poultry_data", JSON.stringify(data)); } catch {}
  await saveToSupa(data);
};

const loadSaved = async () => {
  try {
    const remote = await loadFromSupa();
    if (remote) { try { localStorage.setItem("poultry_data", JSON.stringify(remote)); } catch {} return mergeData(remote); }
  } catch {}
  try { const s = localStorage.getItem("poultry_data"); if (s) return mergeData(JSON.parse(s)); } catch {}
  return null;
};

const downloadBackup = (data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `backup_${new Date().toISOString().split("T")[0]}.json`; a.click();
  URL.revokeObjectURL(url);
};

const restoreBackup = (file, onSuccess) => {
  const r = new FileReader();
  r.onload = async (e) => { try { const d = JSON.parse(e.target.result); await saveData(d); onSuccess(d); } catch { alert("ملف غلط!"); } };
  r.readAsText(file);
};

// ========== SUPABASE BACKUP ==========
const fetchBackups = async () => { try { return await supaCall("backups", "select=id,label,created_at&order=created_at.desc&limit=10") || []; } catch { return []; } };
const saveBackup = async (data, label) => { await supaCall("backups", "", "POST", { data, label: label || `نسخة ${new Date().toLocaleString("ar-EG")}` }); };
const restoreBackupById = async (id) => { try { const rows = await supaCall("backups", `id=eq.${id}&select=data`); return rows?.[0]?.data || null; } catch { return null; } };
const deleteBackupById = async (id) => { await supaCall("backups", `id=eq.${id}`, "DELETE"); };

// ========== SUPABASE USERS ==========
const fetchUsers = async () => {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/users?select=*`, { headers: SUPA_HDR });
    return await res.json() || [];
  } catch { return []; }
};
const createUser = async (u) => { try { await fetch(`${SUPA_URL}/rest/v1/users`, { method: "POST", headers: { ...SUPA_HDR, "Prefer": "return=representation" }, body: JSON.stringify(u) }); } catch {} };
const updateUser = async (id, u) => { try { await fetch(`${SUPA_URL}/rest/v1/users?id=eq.${id}`, { method: "PATCH", headers: SUPA_HDR, body: JSON.stringify(u) }); } catch {} };
const deleteUser = async (id) => { try { await fetch(`${SUPA_URL}/rest/v1/users?id=eq.${id}`, { method: "DELETE", headers: SUPA_HDR }); } catch {} };

// ========== الإشعارات (Web Push) ==========
// بيوصل إشعار لكل أجهزة المستخدمين اللي فعّلوا الإشعارات، حتى لو البرنامج مقفول تماماً على أجهزتهم
const VAPID_PUBLIC_KEY = "BK_kuuSTp45LjleDMwIHkmTemFEZ9J5HeTPppAVHwQSKOklGMyyJGea0St4gelaPdxnFy5QwcRm6wIwtN2h9Jzg";

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

const registerSW = async () => {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; }
};

const getNotifStatus = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

// يفعّل الإشعارات على الجهاز الحالي ويربطه بحساب المستخدم في قاعدة البيانات
const enablePush = async (userId) => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    return { ok: false, err: "الجهاز أو المتصفح ده مش بيدعم الإشعارات" };
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, err: "لازم توافق على إذن الإشعارات من المتصفح" };
    const reg = await registerSW();
    if (!reg) return { ok: false, err: "تعذر تسجيل خدمة الإشعارات" };
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    }
    const json = sub.toJSON();
    await fetch(`${SUPA_URL}/rest/v1/push_subscriptions`, {
      method: "POST",
      headers: { ...SUPA_HDR, "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_id: userId, updated_at: new Date().toISOString() }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: "حصلت مشكلة أثناء تفعيل الإشعارات" };
  }
};

// يوقف الإشعارات على الجهاز الحالي بس
const disablePush = async () => {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await fetch(`${SUPA_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE", headers: SUPA_HDR });
      await sub.unsubscribe();
    }
  } catch {}
};

// يبعث إشعار لكل المستخدمين اللي مفعّلين الإشعارات (غير اللي بعت هو نفسه، اختياري)
const notifyAll = async (title, body, excludeUserId) => {
  try {
    await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, excludeUserId }),
    });
  } catch {}
};

// بيقارن نسخة البيانات القديمة بالجديدة عشان يعرف "الحاجة اللي اتسجلت فعلاً" ويكتب إشعار مفهوم عنها
const describeChange = (oldD, newD) => {
  try {
    const oldSites = oldD?.sites || {};
    const newSites = newD?.sites || {};
    for (const siteId of Object.keys(newSites)) {
      const os = oldSites[siteId] || {};
      const ns = newSites[siteId] || {};
      const site = SITES.find((s) => s.id === siteId);
      const siteName = site?.name || "موقع";

      const barns = Object.keys(ns.sessions || {});
      for (const b of barns) {
        const oldSess = os.sessions?.[b];
        const newSess = ns.sessions?.[b];
        if (!oldSess && newSess) return { title: "🐣 بدء دورة جديدة", body: `${siteName} — ${b}` };
        if (oldSess && newSess) {
          if ((newSess.dailyRecords || []).length > (oldSess.dailyRecords || []).length) {
            return { title: "📝 تسجيل يومية جديد", body: `${siteName} — ${b}` };
          }
          if ((newSess.weeklyWeights || []).length > (oldSess.weeklyWeights || []).length) {
            return { title: "⚖️ وزن أسبوعي جديد", body: `${siteName} — ${b}` };
          }
        }
      }

      for (const k of ["received", "dispatched", "returned"]) {
        if ((ns.feedStore?.[k] || []).length > (os.feedStore?.[k] || []).length) {
          return { title: "🌾 حركة جديدة في مخزن العلف", body: siteName };
        }
      }
      for (const k of ["received", "returned"]) {
        if ((ns.medStore?.[k] || []).length > (os.medStore?.[k] || []).length) {
          return { title: "💊 حركة جديدة في مخزن الدواء", body: siteName };
        }
      }
      if ((ns.gasStore?.received || []).length > (os.gasStore?.received || []).length) {
        return { title: "🔥 حركة جديدة في خزان الجاز", body: siteName };
      }
      if ((ns.injections || []).length > (os.injections || []).length) {
        return { title: "💉 تسجيل حقن وتقطير جديد", body: siteName };
      }
    }
    if (Object.keys(newSites).length > Object.keys(oldSites).length) {
      return { title: "🏭 تم إضافة موقع جديد", body: "" };
    }
  } catch {}
  return null;
};

// ========== COLORS ==========
// هوية بصرية "مخزن الحبوب" — خلفية قمحية دافئة + ذهبي كهرماني كلون أساسي
// بدل الأزرق التقليدي، وألوان حالة مستوحاة من المزرعة (أخضر مرعى / أحمر طوب / تركواز حوض مياه)
const C = {
  bg: "#F1E8CB", card: "#FFFFFF", cardAlt: "#E9DCAF",
  accent: "#9C6B1F", accentD: "#7C5417",
  green: "#2F6B3A", red: "#9C3327", blue: "#2A5F65", purple: "#5E3A6B", orange: "#B25E17",
  text: "#2B2318", muted: "#786B4D", border: "#D7C48C", input: "#FBF7E9",
};
// تحويل الكود اللوني السداسي لصيغة rgb عشان نقدر نستخدمه في rgba() بشفافية متغيرة
const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

// ========== CSS ==========
const css = `
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',sans-serif;background:${C.bg};color:${C.text};direction:rtl;min-height:100vh}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
input,select,textarea{font-family:'Cairo',sans-serif;direction:rtl}

.topbar{background:${C.card};border-bottom:3px solid ${C.accent};padding:0 14px;display:flex;align-items:center;justify-content:space-between;height:56px;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(${hexToRgb(C.text)},.08)}
.logo{font-size:18px;font-weight:800;color:${C.accent};display:flex;align-items:center;gap:8px;letter-spacing:1.5px}
.logo-sub{font-size:10px;color:${C.muted};font-weight:600}
.menu-btn{background:none;border:none;color:${C.text};font-size:22px;cursor:pointer;padding:4px 8px}

.main{display:flex;min-height:calc(100vh - 56px)}
.sidebar{width:240px;background:${C.card};border-left:1px solid ${C.border};padding:12px 0;flex-shrink:0;box-shadow:2px 0 8px rgba(${hexToRgb(C.text)},.04)}
.sec-lbl{padding:6px 14px;font-size:10px;color:${C.muted};font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-top:8px}
.site-btn{width:100%;text-align:right;padding:10px 14px;background:none;border:none;color:${C.text};font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border-right:3px solid transparent;transition:all .2s;display:flex;align-items:center;gap:7px}
.site-btn:hover,.site-btn.active{background:${C.cardAlt};color:${C.accentD};border-right-color:${C.accent}}
.barn-btn{width:100%;text-align:right;padding:8px 14px 8px 28px;background:none;border:none;color:${C.muted};font-family:'Cairo',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border-right:3px solid transparent;transition:all .2s;display:flex;align-items:center;gap:6px}
.barn-btn:hover{color:${C.text};background:rgba(${hexToRgb(C.accent)},.06)}
.barn-btn.active{color:${C.accentD};border-right-color:${C.accent};background:rgba(${hexToRgb(C.accent)},.1)}
.dot{width:7px;height:7px;border-radius:50%;background:${C.border};flex-shrink:0}
.dot.on{background:${C.green}}

.content{flex:1;padding:18px;overflow-y:auto}
.pg-title{font-size:18px;font-weight:900;color:${C.text};margin-bottom:3px;position:relative;padding-right:13px}
.pg-title::before{content:"";position:absolute;right:0;top:2px;bottom:2px;width:5px;border-radius:3px;background:linear-gradient(180deg,${C.accent},${C.green})}
.pg-sub{font-size:11px;color:${C.muted};margin-bottom:16px;font-weight:600;padding-right:13px}

.card{background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 1px 5px rgba(${hexToRgb(C.text)},.05)}
.card-t{font-size:13px;font-weight:800;color:${C.text};margin-bottom:12px;display:flex;align-items:center;gap:5px}

.btn{padding:8px 16px;border-radius:8px;border:none;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:4px}
.btn-p{background:${C.accent};color:#fff}.btn-p:hover{background:${C.accentD}}
.btn-s{background:${C.green};color:#fff}.btn-s:hover{filter:brightness(1.12)}
.btn-d{background:${C.red};color:#fff}.btn-d:hover{filter:brightness(1.12)}
.btn-n{background:${C.cardAlt};color:${C.text};border:1px solid ${C.border}}.btn-n:hover{border-color:${C.accent};color:${C.accentD}}
.btn-w{background:rgba(${hexToRgb(C.orange)},.13);color:${C.orange};border:1px solid rgba(${hexToRgb(C.orange)},.4)}
.btn-sm{padding:5px 11px;font-size:11px}
.btn-xs{padding:3px 8px;font-size:11px}

.fg{display:flex;flex-direction:column;gap:4px}
.lbl{font-size:11px;color:${C.muted};font-weight:700;letter-spacing:.2px}
.inp{background:${C.input};border:1.5px solid ${C.border};border-radius:8px;padding:9px 11px;color:${C.text};font-family:'Cairo',sans-serif;font-size:13px;outline:none;transition:border .2s,background .2s;width:100%}
.inp:focus{border-color:${C.accent};background:#fff}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}

.shift-wrap{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.shift-box{background:${C.cardAlt};border-radius:10px;padding:13px;border:1px solid ${C.border}}
.shift-t{font-size:12px;font-weight:800;margin-bottom:10px}
.night{color:${C.purple}}.day{color:${C.orange}}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.stat{background:${C.card};border-radius:10px;padding:12px;border:1px solid ${C.border};border-top:3px solid ${C.border};text-align:center;box-shadow:0 1px 4px rgba(${hexToRgb(C.text)},.04);transition:transform .15s,box-shadow .15s}
.stat:hover{transform:translateY(-2px);box-shadow:0 4px 10px rgba(${hexToRgb(C.text)},.08)}
.stat:has(.cg){border-top-color:${C.green}}
.stat:has(.cr){border-top-color:${C.red}}
.stat:has(.cy){border-top-color:${C.accent}}
.stat:has(.cb){border-top-color:${C.blue}}
.stat:has(.cp){border-top-color:${C.purple}}
.sv{font-size:20px;font-weight:900;letter-spacing:.2px}
.sl{font-size:11px;color:${C.muted};margin-top:3px;font-weight:700}
.cg{color:${C.green}}.cr{color:${C.red}}.cy{color:${C.accent}}.cb{color:${C.blue}}.cp{color:${C.purple}}

.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{background:${C.cardAlt};padding:9px 8px;text-align:center;color:${C.text};font-weight:800;border-bottom:2px solid ${C.border}}
.tbl td{padding:8px 8px;text-align:center;border-bottom:1px solid ${C.border};color:${C.text}}
.tbl tr:hover td{background:rgba(${hexToRgb(C.accent)},.04)}

.tabs{display:flex;gap:3px;margin-bottom:16px;background:${C.cardAlt};padding:3px;border-radius:10px;width:fit-content;flex-wrap:wrap}
.tab{padding:7px 14px;border-radius:7px;border:none;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;background:none;color:${C.muted}}
.tab.active{background:${C.accent};color:#fff;box-shadow:0 2px 6px rgba(${hexToRgb(C.accent)},.35)}

.badge{display:inline-block;padding:2px 8px;border-radius:16px;font-size:11px;font-weight:700}
.bg{background:rgba(${hexToRgb(C.green)},.12);color:${C.green}}
.br{background:rgba(${hexToRgb(C.red)},.12);color:${C.red}}
.by{background:rgba(${hexToRgb(C.accent)},.12);color:${C.accentD}}
.bb{background:rgba(${hexToRgb(C.blue)},.12);color:${C.blue}}

.alert{padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:12px;font-weight:700}
.alert-ok{background:rgba(${hexToRgb(C.green)},.1);border:1px solid rgba(${hexToRgb(C.green)},.3);color:${C.green}}
.alert-err{background:rgba(${hexToRgb(C.red)},.1);border:1px solid rgba(${hexToRgb(C.red)},.3);color:${C.red}}

.home-grid{display:flex;flex-direction:column;gap:16px}
.site-card{background:${C.card};border:1.5px solid ${C.border};border-radius:16px;padding:0;cursor:pointer;transition:all .25s;box-shadow:0 2px 9px rgba(${hexToRgb(C.text)},.07);overflow:hidden;display:flex;align-items:stretch;min-height:118px}
.site-card:hover{transform:translateY(-3px);box-shadow:0 10px 22px rgba(${hexToRgb(C.text)},.12)}
.site-card-body{flex:1;padding:14px 16px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.site-card-title{font-weight:800;font-size:15px;display:flex;align-items:center;gap:6px}
.site-card-sub{display:flex;align-items:center;justify-content:space-between;margin-top:4px}
.site-card-sub-text{font-size:11.5px;color:${C.muted}}
.site-card-chevron{font-size:18px;color:${C.muted};opacity:.6}
.site-card-img{width:104px;flex:0 0 104px;position:relative;display:flex;align-items:center;justify-content:center;font-size:36px}
.site-card-img .emblem{position:absolute;bottom:8px;left:8px;width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 6px rgba(${hexToRgb(C.text)},.3)}
.barn-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.btag{font-size:11px;padding:4px 11px 4px 8px;border-radius:20px;background:${C.cardAlt};color:${C.muted};border:1px solid ${C.border};font-weight:700;display:inline-flex;align-items:center;gap:5px}
.btag .dot{width:6px;height:6px;border-radius:50%;background:${C.muted};display:inline-block}
.btag.on{background:rgba(${hexToRgb(C.green)},.1);color:${C.green};border-color:rgba(${hexToRgb(C.green)},.3)}
.btag.on .dot{background:${C.green}}

.empty{text-align:center;padding:40px 20px;color:${C.muted}}
.empty .ico{font-size:40px;margin-bottom:10px}

.modal-bg{position:fixed;inset:0;background:rgba(${hexToRgb(C.text)},.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:14px}
.modal{background:${C.card};border:1.5px solid ${C.border};border-radius:14px;padding:22px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(${hexToRgb(C.text)},.18)}
.modal-t{font-size:14px;font-weight:800;color:${C.accentD};margin-bottom:14px}

@media(max-width:700px){
  .sidebar{position:fixed;top:56px;right:-250px;width:240px;height:calc(100vh - 56px);z-index:300;transition:right .3s;overflow-y:auto}
  .sidebar.open{right:0}
  .content{padding:12px}
  .shift-wrap{grid-template-columns:1fr}
  .stats{grid-template-columns:repeat(2,1fr)}
  .tabs{width:100%}.tab{flex:1;text-align:center;font-size:11px;padding:6px 4px}
  .g2,.g3,.g4{grid-template-columns:1fr 1fr}
  .tbl{font-size:11px}.tbl th,.tbl td{padding:6px 4px}
  .sv{font-size:18px}
}
@media(min-width:701px){.menu-btn{display:none}}
`;

// ========== CONFIRM ==========
function Confirm({ msg, onOk, onCancel }) {
  return (
    <div className="modal-bg">
      <div className="modal" style={{ textAlign: "center", borderColor: C.red, maxWidth: 360 }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 18, lineHeight: 1.7 }}>{msg}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-n" style={{ flex: 1 }} onClick={onCancel}>إلغاء</button>
          <button className="btn btn-d" style={{ flex: 1 }} onClick={onOk}>تأكيد</button>
        </div>
      </div>
    </div>
  );
}

// ========== LOGIN ==========
function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const go = async () => {
    if (!username || !pass) return;
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&select=*`, { headers: SUPA_HDR });
      const rows = await res.json();
      if (!rows || rows.length === 0 || rows[0].password !== pass) {
        setErr("اسم المستخدم أو كلمة المرور غلط!"); setLoading(false); return;
      }
      onLogin(rows[0]);
    } catch { setErr("مشكلة في الاتصال"); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{css}</style>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: "100%", maxWidth: 320, textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,.1)" }}>
        <img src="/logo.png" alt="مزارع أبوشريف" style={{ width: 175, height: 175, objectFit: "contain", marginBottom: 10 }} onError={e => { e.target.style.display='none'; }} />
        <div style={{ fontSize: 22, fontWeight: 800, color: C.accent, marginBottom: 2, letterSpacing: 2 }}>مزارع أبوشريف</div>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 22 }}>MAZARIE ABO SHERIF</div>
        {err && <div className="alert alert-err">{err}</div>}
        <div className="fg" style={{ textAlign: "right", marginBottom: 10 }}>
          <label className="lbl">👤 اسم المستخدم</label>
          <input className="inp" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} autoFocus />
        </div>
        <div className="fg" style={{ textAlign: "right", marginBottom: 18 }}>
          <label className="lbl">🔒 كلمة المرور</label>
          <input className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} />
        </div>
        <button className="btn btn-p" style={{ width: "100%", fontSize: 13, padding: "10px" }} onClick={go} disabled={loading}>{loading ? "جاري التحقق..." : "دخول"}</button>
      </div>
    </div>
  );
}

// ========== DAILY TAB ==========
// ========== DAILY TAB ==========
function DailyTab({ session, siteId, onUpdate, feedStore, medStore, onSaveRecord, onEditRecord, onDeleteRecord, isAdmin }) {
  const canEdit = !!onUpdate;
  const today = new Date().toISOString().split("T")[0];
  const hideFeed = siteId === "qatour"; // عنبر قطور: بدون تسجيل علف في الشفتين
  const [form, setForm] = useState({ id: genId(), date: today, night: emptyShift(), day: emptyShift(), medicines: [] });
  const [medForm, setMedForm] = useState({ name: "", hours: "" });
  const [saved, setSaved] = useState(false);
  const [editRec, setEditRec] = useState(null);
  const [editMedForm, setEditMedForm] = useState({ name: "", hours: "" });
  const [confirm, setConfirm] = useState(null);
  const [err, setErr] = useState("");
  const [editErr, setEditErr] = useState("");

  const setShift = (s, f, v) => setForm(p => ({ ...p, [s]: { ...p[s], [f]: v } }));

  const addMed = () => {
    if (!medForm.name.trim()) return;
    setForm(p => ({ ...p, medicines: [...p.medicines, { id: genId(), name: medForm.name.trim(), hours: medForm.hours }] }));
    setMedForm({ name: "", hours: "" });
  };

  const save = () => {
    if (!onSaveRecord) return;
    const result = onSaveRecord({ ...form });
    if (!result.ok) { setErr(result.err || "حدث خطأ"); setTimeout(() => setErr(""), 4000); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    setForm({ id: genId(), date: today, night: emptyShift(), day: emptyShift(), medicines: [] });
  };

  const saveEdit = () => {
    if (!editRec) return;
    if (onEditRecord) {
      const result = onEditRecord(editRec.id, editRec);
      if (!result.ok) { setEditErr(result.err || "حدث خطأ"); setTimeout(() => setEditErr(""), 4000); return; }
    } else if (onUpdate) {
      onUpdate({ ...session, dailyRecords: session.dailyRecords.map(r => r.id === editRec.id ? editRec : r) });
    }
    setEditRec(null);
  };

  const addEditMed = () => {
    if (!editMedForm.name.trim()) return;
    setEditRec(p => ({ ...p, medicines: [...(p.medicines || []), { id: genId(), name: editMedForm.name.trim(), hours: editMedForm.hours }] }));
    setEditMedForm({ name: "", hours: "" });
  };

  const deleteRec = (id) => {
    setConfirm({ msg: "هتمسح السجل اليومي ده؟ سيتم إرجاع العلف والدواء المسحوبين تلقائياً للمخزن.", fn: () => onDeleteRecord && onDeleteRecord(id) });
  };

  const tot = { mortality: num(form.night.mortality) + num(form.day.mortality), feed: num(form.night.feed) + num(form.day.feed) };
  const feedBalance = (feedStore?.received || []).reduce((s, r) => s + num(r.qty), 0) - (feedStore?.dispatched || []).reduce((s, r) => s + num(r.qty), 0) - (feedStore?.returned || []).reduce((s, r) => s + num(r.qty), 0);

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editRec && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل السجل — {editRec.date}</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>تعديل كمية العلف هنا بيتحدث تلقائياً في مخزن العلف بتاع الموقع</div>
            {editErr && <div className="alert alert-err" style={{ marginBottom: 10 }}>⚠️ {editErr}</div>}
            <div className="shift-wrap">
              {["night", "day"].map(s => (
                <div className="shift-box" key={s}>
                  <div className={`shift-t ${s}`}>{s === "night" ? "🌙 ليل" : "☀️ نهار"}</div>
                  <div className="g2">
                    <div className="fg"><label className="lbl">نافق</label><input className="inp" type="number" value={editRec[s].mortality} onChange={e => setEditRec(p => ({ ...p, [s]: { ...p[s], mortality: e.target.value } }))} /></div>
                    {!hideFeed && <div className="fg"><label className="lbl">علف (كجم)</label><input className="inp" type="number" value={editRec[s].feed} onChange={e => setEditRec(p => ({ ...p, [s]: { ...p[s], feed: e.target.value } }))} /></div>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="lbl" style={{ display: "block", marginBottom: 6 }}>💊 أدوية اليوم ده</label>
              <div className="g2" style={{ marginBottom: 8 }}>
                <div className="fg"><input className="inp" placeholder="اسم الدواء" value={editMedForm.name} onChange={e => setEditMedForm(p => ({ ...p, name: e.target.value }))} onKeyDown={e => e.key === "Enter" && addEditMed()} /></div>
                <div className="fg"><input className="inp" type="number" placeholder="عدد الساعات" value={editMedForm.hours} onChange={e => setEditMedForm(p => ({ ...p, hours: e.target.value }))} onKeyDown={e => e.key === "Enter" && addEditMed()} /></div>
              </div>
              <button className="btn btn-n btn-sm" onClick={addEditMed}>+ إضافة دواء</button>
              {(editRec.medicines || []).map((m, i) => (
                <div key={m.id || i} style={{ display: "flex", gap: 8, padding: "5px 10px", background: C.input, borderRadius: 6, marginTop: 6, fontSize: 11, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>💊 {m.name}</span>
                  {m.hours && <span className="badge by">⏱️ {m.hours} ساعة</span>}
                  <button style={{ marginRight: "auto", background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 13 }} onClick={() => setEditRec(p => ({ ...p, medicines: p.medicines.filter((_, j) => j !== i) }))}>✕</button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-n" style={{ flex: 1 }} onClick={() => { setEditRec(null); setEditErr(""); }}>إلغاء</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button>
            </div>
          </div>
        </div>
      )}

      {saved && <div className="alert alert-ok">✅ تم الحفظ — تم خصم العلف والدواء من المخزن تلقائي</div>}
      {err && <div className="alert alert-err">⚠️ {err}</div>}
      <div className="card">
        <div className="card-t">📅 تسجيل يومي جديد</div>
        <div className="fg" style={{ marginBottom: 12, maxWidth: 180 }}>
          <label className="lbl">التاريخ</label>
          <input className="inp" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
        </div>
        <div className="shift-wrap">
          {["night", "day"].map(s => (
            <div className="shift-box" key={s}>
              <div className={`shift-t ${s}`}>{s === "night" ? "🌙 شفت الليل" : "☀️ شفت النهار"}</div>
              <div className="g2">
                <div className="fg"><label className="lbl">نافق</label><input className="inp" type="number" placeholder="0" value={form[s].mortality} onChange={e => setShift(s, "mortality", e.target.value)} /></div>
                {!hideFeed && <div className="fg"><label className="lbl">علف (كجم)</label><input className="inp" type="number" placeholder="0" value={form[s].feed} onChange={e => setShift(s, "feed", e.target.value)} /></div>}
              </div>
            </div>
          ))}
        </div>
        <div className="stats" style={{ marginTop: 10 }}>
          <div className="stat"><div className="sv cr">{tot.mortality}</div><div className="sl">إجمالي النافق</div></div>
          {!hideFeed && <div className="stat"><div className="sv cy">{tot.feed} كجم</div><div className="sl">إجمالي العلف</div></div>}
          {!hideFeed && <div className="stat"><div className="sv" style={{color: feedBalance >= tot.feed ? C.green : C.red}}>{feedBalance.toFixed(0)} كجم</div><div className="sl">رصيد المخزن المتاح</div></div>}
        </div>
      </div>

      <div className="card">
        <div className="card-t">💊 الأدوية المستخدمة اليوم</div>
        <div className="g2" style={{ marginBottom: 10 }}>
          <div className="fg">
            <label className="lbl">اسم الدواء المستخدم</label>
            <input className="inp" value={medForm.name} onChange={e => setMedForm(p => ({ ...p, name: e.target.value }))} onKeyDown={e => e.key === "Enter" && addMed()} placeholder="اكتب اسم الدواء" />
          </div>
          <div className="fg">
            <label className="lbl">عدد الساعات</label>
            <input className="inp" type="number" value={medForm.hours} onChange={e => setMedForm(p => ({ ...p, hours: e.target.value }))} onKeyDown={e => e.key === "Enter" && addMed()} placeholder="مثال: 6" />
          </div>
        </div>
        <button className="btn btn-n btn-sm" onClick={addMed}>+ إضافة دواء</button>
        {form.medicines.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, padding: "5px 10px", background: C.input, borderRadius: 6, marginTop: 6, fontSize: 11, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>💊 {m.name}</span>
            {m.hours && <span className="badge by">⏱️ {m.hours} ساعة</span>}
            <button style={{ marginRight: "auto", background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 13 }} onClick={() => setForm(p => ({ ...p, medicines: p.medicines.filter((_, j) => j !== i) }))}>✕</button>
          </div>
        ))}
      </div>

      {canEdit && <button className="btn btn-p" style={{ fontSize: 13, padding: "10px 24px", marginBottom: 18 }} onClick={save}>💾 حفظ اليوم</button>}

      {session.dailyRecords.length > 0 && (
        <div className="card">
          <div className="card-t">📋 السجلات السابقة</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>التاريخ</th><th>العمر</th><th>نافق ل</th><th>نافق ن</th><th>إج نافق</th>{!hideFeed && <><th>علف ل</th><th>علف ن</th><th>إج علف</th></>}<th>أدوية</th>{canEdit && <th>إجراء</th>}</tr>
              </thead>
              <tbody>
                {[...session.dailyRecords].reverse().map(r => {
                  const s = calcDayStats(r);
                  const age = session.startDate ? Math.floor((new Date(r.date) - new Date(session.startDate)) / 86400000) : "-";
                  return (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td><span className="badge by">{age} يوم</span></td>
                      <td style={{ color: C.red }}>{r.night.mortality || 0}</td>
                      <td style={{ color: C.red }}>{r.day.mortality || 0}</td>
                      <td><span className="badge br">{s.mortality}</span></td>
                      {!hideFeed && <><td>{r.night.feed || 0}</td>
                      <td>{r.day.feed || 0}</td>
                      <td><span className="badge by">{s.feed} كجم</span></td></>}
                      <td>{(r.medicines || []).length > 0 ? <span className="badge" style={{background:`rgba(${hexToRgb(C.purple)},.12)`, color:C.purple}}>{r.medicines.length} 💊</span> : "-"}</td>
                      {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={() => setEditRec({ ...r })}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={() => deleteRec(r.id)}>🗑️</button>}</div></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== WEIGHT TAB ==========
// ========== WEIGHT TAB ==========
function WeightTab({ session, onUpdate, isAdmin }) {
  const canEdit = !!onUpdate;
  const [form, setForm] = useState({ age: "", sampleCount: "", totalWeight: "", note: "" });
  const [editW, setEditW] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saved, setSaved] = useState(false);

  const avg = form.sampleCount && form.totalWeight ? ((num(form.totalWeight) * 1000) / num(form.sampleCount)).toFixed(0) : "";
  const totalMort = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0);
  const remaining = num(session.birdCount) - totalMort;

  // يدعم السجلات القديمة اللي كانت مسجلة بالأسبوع بدل العمر
  const ageOf = (w) => w.age != null && w.age !== "" ? num(w.age) : (w.week != null ? num(w.week) * 7 : 0);

  const feedUpToAge = (ageDays) => {
    const start = new Date(session.startDate);
    return (session.dailyRecords || []).filter(r => (new Date(r.date) - start) / 86400000 < ageDays).reduce((s, r) => s + calcDayStats(r).feed, 0);
  };

  const save = () => {
    if (!form.age || !form.sampleCount || !form.totalWeight || !onUpdate) return;
    const rec = { id: genId(), ...form, avgWeight: avg };
    onUpdate({ ...session, weeklyWeights: [...session.weeklyWeights, rec] });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setForm({ age: "", sampleCount: "", totalWeight: "", note: "" });
  };

  const saveEdit = () => {
    if (!onUpdate || !editW) return;
    const newAvg = editW.sampleCount && editW.totalWeight ? ((num(editW.totalWeight) * 1000) / num(editW.sampleCount)).toFixed(0) : editW.avgWeight;
    onUpdate({ ...session, weeklyWeights: session.weeklyWeights.map(w => w.id === editW.id ? { ...editW, avgWeight: newAvg } : w) });
    setEditW(null);
  };

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editW && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل وزن عمر {ageOf(editW)} يوم</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">العمر (يوم)</label><input className="inp" type="number" value={editW.age ?? ""} onChange={e => setEditW(p => ({ ...p, age: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">عدد العينة</label><input className="inp" type="number" value={editW.sampleCount} onChange={e => setEditW(p => ({ ...p, sampleCount: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">إجمالي الوزن (كجم)</label><input className="inp" type="number" value={editW.totalWeight} onChange={e => setEditW(p => ({ ...p, totalWeight: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">ملاحظة</label><input className="inp" value={editW.note || ""} onChange={e => setEditW(p => ({ ...p, note: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditW(null)}>إلغاء</button>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button>
            </div>
          </div>
        </div>
      )}
      {saved && <div className="alert alert-ok">✅ تم الحفظ</div>}
      <div className="card">
        <div className="card-t">⚖️ تسجيل الوزن بالعمر</div>
        <div className="g4">
          <div className="fg"><label className="lbl">العمر (يوم)</label><input className="inp" type="number" placeholder="7" value={form.age} onChange={e => setForm(p => ({ ...p, age: e.target.value }))} /></div>
          <div className="fg"><label className="lbl">عدد العينة</label><input className="inp" type="number" placeholder="50" value={form.sampleCount} onChange={e => setForm(p => ({ ...p, sampleCount: e.target.value }))} /></div>
          <div className="fg"><label className="lbl">إجمالي الوزن (كجم)</label><input className="inp" type="number" value={form.totalWeight} onChange={e => setForm(p => ({ ...p, totalWeight: e.target.value }))} /></div>
          <div className="fg"><label className="lbl">متوسط (جم) — تلقائي</label><input className="inp" value={avg ? `${avg} جم` : ""} readOnly style={{ background: C.cardAlt, color: C.accent, fontWeight: 700 }} /></div>
        </div>
        <div className="fg" style={{ marginTop: 10 }}><label className="lbl">ملاحظة</label><input className="inp" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="اكتب أي ملاحظة عن هذا الوزن (اختياري)" /></div>
        {canEdit && <button className="btn btn-p btn-sm" style={{ marginTop: 10 }} onClick={save}>💾 حفظ</button>}
      </div>
      {session.weeklyWeights.length > 0 && (
        <div className="card">
          <div className="card-t">📊 معامل التحويل حسب العمر</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>العمر</th><th>متوسط الوزن</th><th>إجمالي العلف</th><th>FCR</th><th>ملاحظة</th>{canEdit && <th>إجراء</th>}</tr></thead>
              <tbody>
                {session.weeklyWeights.map(w => {
                  const ageDays = ageOf(w);
                  const tf = feedUpToAge(ageDays);
                  const fcr = calcFCR(tf, num(w.avgWeight), remaining);
                  return (
                    <tr key={w.id}>
                      <td>{ageDays} يوم</td>
                      <td style={{ color: C.accent, fontWeight: 700 }}>{w.avgWeight} جم</td>
                      <td>{tf.toFixed(0)} كجم</td>
                      <td><span className="badge" style={{ background: num(fcr) < 2 ? `rgba(${hexToRgb(C.green)},.12)` : `rgba(${hexToRgb(C.red)},.12)`, color: num(fcr) < 2 ? C.green : C.red }}>{fcr}</span></td>
                      <td style={{ fontSize: 11, color: C.muted }}>{w.note || "-"}</td>
                      {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={() => setEditW({ ...w })}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={() => setConfirm({ msg: "هتمسح الوزن ده؟", fn: () => onUpdate({ ...session, weeklyWeights: session.weeklyWeights.filter(x => x.id !== w.id) }) })}>🗑️</button>}</div></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== MEDICINE TAB ==========
function MedicineTab({ session, onEditMed, onDeleteMed, barnName, siteName, currentUser }) {
  const [editEntry, setEditEntry] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showReport, setShowReport] = useState(false);

  const allMeds = (session?.dailyRecords || [])
    .flatMap(r => (r.medicines || []).map(m => ({
      ...m,
      recordId: r.id,
      date: r.date,
      age: session.startDate ? Math.floor((new Date(r.date) - new Date(session.startDate)) / 86400000) : "-"
    })))
    .sort((a, b) => a.date > b.date ? 1 : -1);

  // ==== دمج ذكي لأسماء الأدوية المتشابهة ====
  // 1- توحيد الحروف المتقاربة والتشكيل والمسافات
  const normalizeMedName = (s) => (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .toLowerCase();

  // 2- شيل كلمات ووحدات الجرعة/التوقيت اللي ممكن تتكتب جوا اسم الدواء زي "12 ساعة" أو "نص جرعة"
  const dosageWords = ["ساعة", "ساعه", "ساعات", "جرعة", "جرعه", "جرعات", "نص", "كامل", "صباحا", "صباحاً", "مساء", "مساءً", "ليل", "نهار", "يوميا", "يومي", "مرتين", "مره", "مرة"];
  const stripDosage = (s) => {
    let out = s;
    dosageWords.forEach(w => { out = out.split(w).join(" "); });
    out = out.replace(/\d+/g, " "); // شيل أي أرقام (زي 12، 24)
    return out.replace(/\s+/g, " ").trim();
  };

  // 3- مسافةليفنشتاين لقياس التشابه بين اسمين
  const levenshtein = (a, b) => {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  };
  const tokenize = (s) => s.split(" ").filter(Boolean);
  const isSimilar = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    // احتواء بادئة/لاحقة فقط — امتداد لنفس الكلمة (زي "اموكسي" جوا "اموكسيسيلين")
    // من غير ما يبلع كلمة إضافية كاملة (زي "تتراسيكلين" جوا "أوكسي تتراسيكلين" أو "أموكسيسيلين" جوا "أموكسيسيلين كلافيولانيك")
    if (a.length >= 4 && b.length >= 4) {
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      let extra = null;
      if (longer.startsWith(shorter)) extra = longer.slice(shorter.length);
      else if (longer.endsWith(shorter)) extra = longer.slice(0, longer.length - shorter.length);
      if (extra !== null && !extra.includes(" ") && shorter.length / longer.length >= 0.4) return true;
    }
    // لو الاسمين بنفس عدد الكلمات وبيختلفوا في كلمة واحدة بس قصيرة (زي حرف أو رمز مميز)، امنع الدمج
    // ده بيحمي حالات زي "فيتامين ج" و"فيتامين ك3" — دول فيتامينات مختلفة تمامًا مش خطأ إملائي
    const ta = tokenize(a), tb = tokenize(b);
    if (ta.length === tb.length && ta.length > 0) {
      const diffIdx = [];
      for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) diffIdx.push(i);
      if (diffIdx.length === 1) {
        const t1 = ta[diffIdx[0]], t2 = tb[diffIdx[0]];
        if (Math.min(t1.length, t2.length) <= 3) return false;
      }
    }
    // خطأ إملائي بسيط بس — مش سماح بفروق كبيرة، عشان منجمعش أدوية مختلفة شكلها قريب زي "أموكسيسيلين" و"أمبيسيلين"
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    const sim = maxLen > 0 ? 1 - dist / maxLen : 1;
    return dist <= 2 && sim >= 0.85;
  };

  // 4- تجميع كل الأدوية في مجموعات حسب التشابه
  const clusters = []; // [{ key, names:{}, count, dates:[], totalHours }]
  allMeds.forEach(m => {
    const cleanKey = stripDosage(normalizeMedName(m.name)) || normalizeMedName(m.name) || "-";
    let cluster = clusters.find(c => isSimilar(c.key, cleanKey));
    if (!cluster) {
      cluster = { key: cleanKey, names: {}, count: 0, dates: [], totalHours: 0 };
      clusters.push(cluster);
    }
    cluster.count++;
    cluster.dates.push(m.date);
    cluster.totalHours += num(m.hours);
    cluster.names[m.name] = (cluster.names[m.name] || 0) + 1;
  });

  const summary = {};
  clusters.forEach((c, i) => {
    const displayName = Object.entries(c.names).sort((a, b) => b[1] - a[1])[0][0];
    summary[`cluster_${i}`] = { count: c.count, dates: c.dates, totalHours: c.totalHours, displayName, variantCount: Object.keys(c.names).length };
  });

  const saveEdit = () => {
    if (!onEditMed || !editEntry) return;
    onEditMed(editEntry.recordId, editEntry.id, editEntry.name, editEntry.hours);
    setEditEntry(null);
  };

  return (
    <div>
      {showReport && (
        <SimpleReport
          title="تقرير سجل الأدوية"
          badge={`العنبر: ${barnName || "-"} — ${siteName || "-"}`}
          currentUser={currentUser}
          onClose={() => setShowReport(false)}
          sections={
            <>
              <div className="a4sechead">ملخص الأدوية</div>
              <table className="a4tbl">
                <thead><tr><th>الدواء</th><th>عدد الأيام</th><th>إجمالي الساعات</th><th>آخر استخدام</th></tr></thead>
                <tbody>
                  {Object.entries(summary).map(([key, info], i) => (
                    <tr key={i}><td><strong>{info.displayName}</strong></td><td>{info.count}</td><td>{info.totalHours ? `${info.totalHours} ساعة` : "-"}</td><td>{info.dates[info.dates.length - 1]}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="a4sechead">سجل الأدوية يوم بيوم</div>
              <table className="a4tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>الدواء</th></tr></thead>
                <tbody>
                  {allMeds.map((m, i) => (
                    <tr key={i}><td>{m.date}</td><td>{m.age}</td><td>{m.name}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          }
        />
      )}
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {allMeds.length > 0 && <button className="btn btn-n btn-sm" style={{ marginBottom: 14 }} onClick={() => setShowReport(true)}>🖨️ طباعة تقرير الدواء</button>}
      {editEntry && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل دواء — {editEntry.date}</div>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label className="lbl">اسم الدواء</label>
              <input className="inp" value={editEntry.name} onChange={e => setEditEntry(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="fg" style={{ marginBottom: 12 }}>
              <label className="lbl">عدد الساعات</label>
              <input className="inp" type="number" value={editEntry.hours || ""} onChange={e => setEditEntry(p => ({ ...p, hours: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditEntry(null)}>إلغاء</button><button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button></div>
          </div>
        </div>
      )}

      {allMeds.length === 0 ? (
        <div className="empty"><div className="ico">💊</div><p>لا توجد أدوية مسجلة</p></div>
      ) : (
        <>
          <div className="card">
            <div className="card-t">📊 ملخص الأدوية</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>الدواء</th><th>عدد الأيام</th><th>إجمالي الساعات</th><th>آخر استخدام</th></tr></thead>
                <tbody>
                  {Object.entries(summary).map(([key, info], i) => (
                    <tr key={i}>
                      <td>
                        <strong>💊 {info.displayName}</strong>
                        {info.variantCount > 1 && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>(جمعنا {info.variantCount} أشكال كتابة متشابهة لنفس الاسم)</div>}
                      </td>
                      <td><span className="badge by">{info.count} يوم</span></td>
                      <td>{info.totalHours ? `${info.totalHours} ساعة` : "-"}</td>
                      <td>{info.dates[info.dates.length - 1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-t">📅 سجل الأدوية يوم بيوم</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>الدواء</th><th>عدد الساعات</th>{(onEditMed || onDeleteMed) && <th>إجراء</th>}</tr></thead>
                <tbody>
                  {allMeds.map((m, i) => (
                    <tr key={i}>
                      <td>{m.date}</td>
                      <td><span className="badge by">{m.age} يوم</span></td>
                      <td style={{ color: "#7b2d8b", fontWeight: 700 }}>💊 {m.name}</td>
                      <td>{m.hours ? `${m.hours} ساعة` : "-"}</td>
                      {(onEditMed || onDeleteMed) && (
                        <td>
                          <div style={{ display: "flex", gap: 3 }}>
                            {onEditMed && <button className="btn btn-n btn-xs" onClick={() => setEditEntry({ ...m })}>✏️</button>}
                            {onDeleteMed && <button className="btn btn-d btn-xs" onClick={() => setConfirm({ msg: `هتمسح دواء "${m.name}" من يوم ${m.date}؟`, fn: () => onDeleteMed(m.recordId, m.id) })}>🗑️</button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ========== DAY SUMMARY TAB ==========// ========== DAY SUMMARY TAB ==========
function DaySummaryTab({ session, hideFeed }) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const record = (session.dailyRecords || []).find(r => r.date === date);
  const age = session.startDate && date ? Math.floor((new Date(date) - new Date(session.startDate)) / 86400000) : "-";

  return (
    <div>
      <div className="fg" style={{ maxWidth: 200, marginBottom: 14 }}>
        <label className="lbl">📅 التاريخ</label>
        <input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      {!record ? (
        <div className="empty"><div className="ico">📭</div><p>لم يتم التسجيل في هذا اليوم</p></div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <span className="badge by" style={{ fontSize: 13, padding: "4px 14px" }}>عمر الدورة: {age} يوم</span>
          </div>
          <div className="shift-wrap">
            <div className="card" style={{ margin: 0 }}>
              <div className="card-t night">🌙 شفت الليل</div>
              <div className="stats" style={{ marginBottom: 0 }}>
                <div className="stat"><div className="sv cr">{record.night.mortality || 0}</div><div className="sl">نافق الليل</div></div>
                {!hideFeed && <div className="stat"><div className="sv cy">{record.night.feed || 0} كجم</div><div className="sl">علف الليل</div></div>}
              </div>
            </div>
            <div className="card" style={{ margin: 0 }}>
              <div className="card-t day">☀️ شفت النهار</div>
              <div className="stats" style={{ marginBottom: 0 }}>
                <div className="stat"><div className="sv cr">{record.day.mortality || 0}</div><div className="sl">نافق النهار</div></div>
                {!hideFeed && <div className="stat"><div className="sv cy">{record.day.feed || 0} كجم</div><div className="sl">علف النهار</div></div>}
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-t">📊 إجمالي اليوم</div>
            <div className="stats" style={{ marginBottom: 0 }}>
              <div className="stat"><div className="sv cr">{num(record.night.mortality) + num(record.day.mortality)}</div><div className="sl">إجمالي النافق</div></div>
              {!hideFeed && <div className="stat"><div className="sv cy">{num(record.night.feed) + num(record.day.feed)} كجم</div><div className="sl">إجمالي العلف</div></div>}
            </div>
          </div>
          {(record.medicines || []).length > 0 && (
            <div className="card">
              <div className="card-t">💊 الأدوية</div>
              <table className="tbl">
                <thead><tr><th>الدواء</th><th>عدد الساعات</th></tr></thead>
                <tbody>
                  {record.medicines.map((m, i) => (
                    <tr key={i}><td style={{ fontWeight: 700 }}>💊 {m.name}</td><td>{m.hours ? `${m.hours} ساعة` : "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ========== SUMMARY TAB ==========
function SummaryTab({ session }) {
  const totalMort = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0);
  const totalFeed = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).feed, 0);
  const remaining = num(session.birdCount) - totalMort;
  const mortRate = session.birdCount ? ((totalMort / num(session.birdCount)) * 100).toFixed(2) : 0;
  const age = calcAge(session.startDate, session.endDate);
  const lastW = (session.weeklyWeights || []).slice(-1)[0];
  const fcr = lastW ? calcFCR(totalFeed, num(lastW.avgWeight), remaining) : "-";

  return (
    <div className="card">
      <div className="card-t">📊 ملخص الدورة</div>
      <div className="stats">
        <div className="stat"><div className="sv cy">{age}</div><div className="sl">عمر الدورة (يوم)</div></div>
        <div className="stat"><div className="sv cg">{remaining.toLocaleString()}</div><div className="sl">الطيور الحالية</div></div>
        <div className="stat"><div className="sv cr">{totalMort.toLocaleString()}</div><div className="sl">إجمالي النافق</div></div>
        <div className="stat"><div className="sv cr">{mortRate}%</div><div className="sl">نسبة النفق</div></div>
        <div className="stat"><div className="sv cy">{totalFeed.toFixed(0)} كجم</div><div className="sl">إجمالي العلف</div></div>
        <div className="stat"><div className="sv cp">{fcr}</div><div className="sl">FCR</div></div>
        {lastW && <div className="stat"><div className="sv cg">{lastW.avgWeight} جم</div><div className="sl">آخر متوسط وزن</div></div>}
      </div>
    </div>
  );
}

// ========== SITE STORE (FEED) ==========
function SiteStorePage({ siteId, data, onUpdate, isAdmin, currentUser, onBack }) {
  const canEdit = !!onUpdate;
  const site = SITES.find(s => s.id === siteId);
  const siteData = data?.sites?.[siteId] || { feedStore: { received: [], dispatched: [], returned: [] } };
  const store = siteData.feedStore || { received: [], dispatched: [], returned: [] };
  if (!store.returned) store.returned = [];
  const [recForm, setRecForm] = useState({ date: new Date().toISOString().split("T")[0], item: "", qty: "", notes: "" });
  const [dispForm, setDispForm] = useState({ date: new Date().toISOString().split("T")[0], barn: site.barns[0], item: "", qty: "" });
  const [retForm, setRetForm] = useState({ date: new Date().toISOString().split("T")[0], item: "", qty: "", notes: "" });
  const [editRec, setEditRec] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saved, setSaved] = useState("");
  const [showReport, setShowReport] = useState(false);

  const totalIn = store.received.reduce((s, r) => s + num(r.qty), 0);
  const totalOut = store.dispatched.reduce((s, r) => s + num(r.qty), 0);
  const totalReturned = store.returned.reduce((s, r) => s + num(r.qty), 0);
  const balance = totalIn - totalOut - totalReturned;

  const deepUpdate = (newStore) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    if (!d.sites[siteId]) return;
    d.sites[siteId].feedStore = newStore;
    onUpdate(d);
  };

  const addRec = (type, form, reset) => {
    if (!form.qty || !canEdit) return;
    deepUpdate({ ...store, [type]: [...store[type], { id: genId(), ...form }] });
    setSaved(type); setTimeout(() => setSaved(""), 2000); reset();
  };

  const deleteEntry = (type, id) => {
    setConfirm({ msg: "هتمسح السجل ده؟", fn: () => deepUpdate({ ...store, [type]: store[type].filter(r => r.id !== id) }) });
  };

  const saveEdit = () => {
    if (!editRec) return;
    const type = editRec._type;
    deepUpdate({ ...store, [type]: store[type].map(r => r.id === editRec.id ? editRec : r) });
    setEditRec(null);
  };

  const allRows = [...store.received.map(r => ({ ...r, _type: "received" })), ...store.dispatched.map(r => ({ ...r, _type: "dispatched" })), ...store.returned.map(r => ({ ...r, _type: "returned" }))].sort((a, b) => a.date > b.date ? 1 : -1);
  const barnBalance = site.barns.map(b => ({ barn: b, total: store.dispatched.filter(r => r.barn === b).reduce((s, r) => s + num(r.qty), 0) }));

  // إجمالي الأصناف المتشابهة (مجمّعة بالاسم)
  const itemTotals = {};
  store.received.forEach(r => {
    const key = (r.item || "بدون اسم").trim();
    if (!itemTotals[key]) itemTotals[key] = { in: 0, out: 0, ret: 0 };
    itemTotals[key].in += num(r.qty);
  });
  store.dispatched.forEach(r => {
    const key = (r.item || "بدون اسم").trim();
    if (!itemTotals[key]) itemTotals[key] = { in: 0, out: 0, ret: 0 };
    itemTotals[key].out += num(r.qty);
  });
  store.returned.forEach(r => {
    const key = (r.item || "بدون اسم").trim();
    if (!itemTotals[key]) itemTotals[key] = { in: 0, out: 0, ret: 0 };
    itemTotals[key].ret += num(r.qty);
  });
  const itemTotalsList = Object.entries(itemTotals).map(([name, v]) => ({ name, in: v.in, out: v.out, ret: v.ret, balance: v.in - v.out - v.ret }));

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editRec && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل السجل</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={editRec.date} onChange={e => setEditRec(p => ({ ...p, date: e.target.value }))} /></div>
              {editRec._type === "dispatched" && <div className="fg"><label className="lbl">العنبر</label><select className="inp" value={editRec.barn} onChange={e => setEditRec(p => ({ ...p, barn: e.target.value }))}>{site.barns.map(b => <option key={b}>{b}</option>)}</select></div>}
              <div className="fg"><label className="lbl">الصنف</label><input className="inp" value={editRec.item || ""} onChange={e => setEditRec(p => ({ ...p, item: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الكمية</label><input className="inp" type="number" value={editRec.qty} onChange={e => setEditRec(p => ({ ...p, qty: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditRec(null)}>إلغاء</button><button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button></div>
          </div>
        </div>
      )}

      {showReport && (
        <SimpleReport
          title="تقرير مخزن العلف"
          badge={`الموقع: ${site.name}`}
          currentUser={currentUser}
          onClose={() => setShowReport(false)}
          sections={
            <>
              <div className="a4sechead">ملخص المخزن</div>
              <div className="a4stats">
                <div className="a4box"><div className="v">+{totalIn.toFixed(0)} كجم</div><div className="l">إجمالي الوارد</div></div>
                <div className="a4box"><div className="v">-{totalOut.toFixed(0)} كجم</div><div className="l">إجمالي الصادر</div></div>
                <div className="a4box"><div className="v">-{totalReturned.toFixed(0)} كجم</div><div className="l">إجمالي المرتجع للمكتب</div></div>
                <div className="a4box"><div className="v">{balance.toFixed(0)} كجم</div><div className="l">الرصيد الحالي</div></div>
              </div>
              <div className="a4sechead">إجمالي الأصناف المتشابهة</div>
              <table className="a4tbl">
                <thead><tr><th>الصنف</th><th>إجمالي الوارد</th><th>إجمالي الصادر</th><th>مرتجع للمكتب</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {itemTotalsList.map((it, i) => (
                    <tr key={i}><td><strong>{it.name}</strong></td><td>+{it.in.toFixed(0)}</td><td>-{it.out.toFixed(0)}</td><td>-{it.ret.toFixed(0)}</td><td><strong>{it.balance.toFixed(0)}</strong></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="a4sechead">سجل المخزن</div>
              <table className="a4tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>العنبر</th><th>الصنف</th><th>وارد</th><th>صادر</th><th>مرتجع للمكتب</th></tr></thead>
                <tbody>
                  {allRows.map((r, i) => (
                    <tr key={i}><td>{r.date}</td><td>{r._type === "received" ? "وارد" : r._type === "dispatched" ? "صرف" : "مرتجع للمكتب"}</td><td>{r.barn || "-"}</td><td>{r.item || "-"}</td><td>{r._type === "received" ? `+${r.qty}` : ""}</td><td>{r._type === "dispatched" ? `-${r.qty}` : ""}</td><td>{r._type === "returned" ? `-${r.qty}` : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          }
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>🌾 مخزن علف {site.name}</div>
        <button className="btn btn-n btn-sm" style={{ marginRight: "auto" }} onClick={() => setShowReport(true)}>🖨️ طباعة تقرير</button>
      </div>
      <div className="pg-sub">مخزن مشترك لكل العنابر — يُسحب منه تلقائياً عند تسجيل العلف اليومي</div>

      <div className="stats">
        <div className="stat"><div className="sv cg">+{totalIn.toFixed(0)}</div><div className="sl">إجمالي الوارد</div></div>
        <div className="stat"><div className="sv cr">-{totalOut.toFixed(0)}</div><div className="sl">إجمالي الصادر</div></div>
        <div className="stat"><div className="sv cr">-{totalReturned.toFixed(0)}</div><div className="sl">مرتجع للمكتب</div></div>
        <div className="stat"><div className="sv" style={{ color: balance >= 0 ? C.green : C.red }}>{balance.toFixed(0)}</div><div className="sl">الرصيد</div></div>
      </div>

      <div className="card">
        <div className="card-t">📦 صرف على العنابر</div>
        <div className="stats" style={{ marginBottom: 0 }}>
          {barnBalance.map(b => <div className="stat" key={b.barn}><div className="sv cr">{b.total.toFixed(0)}</div><div className="sl">{b.barn}</div></div>)}
        </div>
      </div>

      {itemTotalsList.length > 0 && (
        <div className="card">
          <div className="card-t">🧮 إجمالي الأصناف المتشابهة</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>الصنف</th><th>إجمالي الوارد</th><th>إجمالي الصادر</th><th>مرتجع للمكتب</th><th>الرصيد</th></tr></thead>
              <tbody>
                {itemTotalsList.map((it, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 700 }}>{it.name}</td>
                    <td style={{ color: C.green }}>+{it.in.toFixed(0)}</td>
                    <td style={{ color: C.red }}>-{it.out.toFixed(0)}</td>
                    <td style={{ color: C.red }}>-{it.ret.toFixed(0)}</td>
                    <td><span className="badge by">{it.balance.toFixed(0)} كجم</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canEdit && (
        <>
          <div className="card">
            <div className="card-t">📥 إضافة وارد</div>
            {saved === "received" && <div className="alert alert-ok">✅ تم</div>}
            <div className="g4">
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={recForm.date} onChange={e => setRecForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الصنف</label><input className="inp" value={recForm.item} onChange={e => setRecForm(p => ({ ...p, item: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الكمية (كجم)</label><input className="inp" type="number" value={recForm.qty} onChange={e => setRecForm(p => ({ ...p, qty: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={recForm.notes} onChange={e => setRecForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <button className="btn btn-s btn-sm" style={{ marginTop: 10 }} onClick={() => addRec("received", recForm, () => setRecForm(p => ({ ...p, item: "", qty: "", notes: "" })))}>+ وارد</button>
          </div>

          {!["sayari", "elwad", "taha"].includes(siteId) && (
            <div className="card">
              <div className="card-t">📤 صرف لعنبر (يدوي)</div>
              {saved === "dispatched" && <div className="alert alert-ok">✅ تم الصرف</div>}
              <div className="g4">
                <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={dispForm.date} onChange={e => setDispForm(p => ({ ...p, date: e.target.value }))} /></div>
                <div className="fg"><label className="lbl">العنبر</label><select className="inp" value={dispForm.barn} onChange={e => setDispForm(p => ({ ...p, barn: e.target.value }))}>{site.barns.map(b => <option key={b}>{b}</option>)}</select></div>
                <div className="fg"><label className="lbl">الصنف</label><input className="inp" value={dispForm.item} onChange={e => setDispForm(p => ({ ...p, item: e.target.value }))} /></div>
                <div className="fg"><label className="lbl">الكمية (كجم)</label><input className="inp" type="number" value={dispForm.qty} onChange={e => setDispForm(p => ({ ...p, qty: e.target.value }))} /></div>
              </div>
              <button className="btn btn-d btn-sm" style={{ marginTop: 10 }} onClick={() => addRec("dispatched", dispForm, () => setDispForm(p => ({ ...p, item: "", qty: "" })))}>📤 صرف</button>
            </div>
          )}

          <div className="card">
            <div className="card-t">↩️ مرتجع للمكتب</div>
            {saved === "returned" && <div className="alert alert-ok">✅ تم تسجيل المرتجع</div>}
            <div className="g4">
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={retForm.date} onChange={e => setRetForm(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الصنف</label><input className="inp" value={retForm.item} onChange={e => setRetForm(p => ({ ...p, item: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الكمية (كجم)</label><input className="inp" type="number" value={retForm.qty} onChange={e => setRetForm(p => ({ ...p, qty: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={retForm.notes} onChange={e => setRetForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <button className="btn btn-d btn-sm" style={{ marginTop: 10 }} onClick={() => addRec("returned", retForm, () => setRetForm(p => ({ ...p, item: "", qty: "", notes: "" })))}>↩️ تسجيل مرتجع</button>
          </div>
        </>
      )}

      {allRows.length > 0 && (
        <div className="card">
          <div className="card-t">📋 سجل المخزن</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>العنبر</th><th>الصنف</th><th>وارد</th><th>صادر</th><th>مرتجع للمكتب</th>{canEdit && <th>إجراء</th>}</tr></thead>
              <tbody>
                {allRows.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r._type === "received" ? <span className="badge bg">وارد</span> : r._type === "dispatched" ? <span className="badge br">صرف</span> : <span className="badge br">مرتجع للمكتب</span>}</td>
                    <td>{r.barn || "-"}</td>
                    <td>{r.item || "-"}</td>
                    <td style={{ color: C.green }}>{r._type === "received" ? `+${r.qty}` : ""}</td>
                    <td style={{ color: C.red }}>{r._type === "dispatched" ? `-${r.qty}` : ""}</td>
                    <td style={{ color: C.red }}>{r._type === "returned" ? `-${r.qty}` : ""}</td>
                    {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={() => setEditRec({ ...r })}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={() => deleteEntry(r._type, r.id)}>🗑️</button>}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== MEDICINE STORE ==========
function MedStorePage({ siteId, data, onUpdate, isAdmin, currentUser, onBack }) {
  const canEdit = !!onUpdate;
  const site = SITES.find(s => s.id === siteId);
  const medStore = data?.sites?.[siteId]?.medStore || { received: [], returned: [] };
  const receivedList = medStore.received || [];
  const returnedList = medStore.returned || [];
  const emptyItem = () => ({ id: genId(), name: "", qty: "", unit: "مل" });
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], notes: "", items: [emptyItem()] });
  const [retForm, setRetForm] = useState({ date: new Date().toISOString().split("T")[0], notes: "", items: [emptyItem()] });
  const [editRec, setEditRec] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saved, setSaved] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedRec, setSelectedRec] = useState(null);

  const updateItem = (setter, id, field, val) => setter(p => ({ ...p, items: p.items.map(it => it.id === id ? { ...it, [field]: val } : it) }));
  const addItemRow = (setter) => setter(p => ({ ...p, items: [...p.items, emptyItem()] }));
  const removeItemRow = (setter, id) => setter(p => ({ ...p, items: p.items.length > 1 ? p.items.filter(it => it.id !== id) : p.items }));

  const deepUpdate = (newReceived, newReturned) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    if (!d.sites[siteId]) return;
    d.sites[siteId].medStore = { received: newReceived !== undefined ? newReceived : receivedList, returned: newReturned !== undefined ? newReturned : returnedList };
    onUpdate(d);
  };

  const addRec = () => {
    if (!canEdit) return;
    const validItems = form.items.filter(it => it.name && it.qty);
    if (validItems.length === 0) return;
    const invoiceId = genId();
    const newRecords = validItems.map(it => ({ id: genId(), invoiceId, date: form.date, name: it.name.trim(), qty: it.qty, unit: it.unit, notes: form.notes }));
    deepUpdate([...receivedList, ...newRecords], undefined);
    setSaved("received"); setTimeout(() => setSaved(""), 2000);
    setForm({ date: form.date, notes: "", items: [emptyItem()] });
  };

  const addReturn = () => {
    if (!canEdit) return;
    const validItems = retForm.items.filter(it => it.name && it.qty);
    if (validItems.length === 0) return;
    const invoiceId = genId();
    const newRecords = validItems.map(it => ({ id: genId(), invoiceId, date: retForm.date, name: it.name.trim(), qty: it.qty, unit: it.unit, notes: retForm.notes }));
    deepUpdate(undefined, [...returnedList, ...newRecords]);
    setSaved("returned"); setTimeout(() => setSaved(""), 2000);
    setRetForm({ date: retForm.date, notes: "", items: [emptyItem()] });
  };

  const saveEdit = () => {
    if (!editRec) return;
    if (editRec._type === "returned") {
      deepUpdate(undefined, returnedList.map(r => r.id === editRec.id ? editRec : r));
    } else {
      deepUpdate(receivedList.map(r => r.id === editRec.id ? editRec : r), undefined);
    }
    setEditRec(null);
  };

  const deleteEntry = (type, id) => {
    setConfirm({ msg: "هتمسح السجل ده؟", fn: () => {
      if (type === "returned") deepUpdate(undefined, returnedList.filter(r => r.id !== id));
      else deepUpdate(receivedList.filter(r => r.id !== id), undefined);
    }});
  };

  // إجمالي كل صنف (وارد - مرتجع للمكتب = الرصيد)
  const itemTotals = {};
  receivedList.forEach(r => {
    const key = (r.name || "بدون اسم").trim();
    if (!itemTotals[key]) itemTotals[key] = { in: 0, ret: 0, unit: r.unit || "" };
    itemTotals[key].in += num(r.qty);
  });
  returnedList.forEach(r => {
    const key = (r.name || "بدون اسم").trim();
    if (!itemTotals[key]) itemTotals[key] = { in: 0, ret: 0, unit: r.unit || "" };
    itemTotals[key].ret += num(r.qty);
    if (!itemTotals[key].unit) itemTotals[key].unit = r.unit || "";
  });
  const itemTotalsList = Object.entries(itemTotals).map(([name, v]) => ({ name, in: v.in, ret: v.ret, total: v.in - v.ret, unit: v.unit }));

  const totalReturnedAll = returnedList.reduce((s, r) => s + num(r.qty), 0);

  const filteredTotals = itemTotalsList.filter(it => !search || it.name.toLowerCase().includes(search.toLowerCase()));
  const allRows = [...receivedList.map(r => ({ ...r, _type: "received" })), ...returnedList.map(r => ({ ...r, _type: "returned" }))];
  const filteredRows = allRows.filter(r => !search || (r.name || "").toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.date > b.date ? 1 : -1);

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editRec && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل سجل {editRec._type === "returned" ? "المرتجع" : "الوارد"}</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={editRec.date} onChange={e => setEditRec(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">اسم الدواء</label><input className="inp" value={editRec.name} onChange={e => setEditRec(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الكمية</label><input className="inp" type="number" value={editRec.qty} onChange={e => setEditRec(p => ({ ...p, qty: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الوحدة</label><select className="inp" value={editRec.unit} onChange={e => setEditRec(p => ({ ...p, unit: e.target.value }))}><option value="مل">مل</option><option value="جم">جم</option><option value="كجم">كجم</option><option value="لتر">لتر</option><option value="عبوة">عبوة</option></select></div>
              <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={editRec.notes || ""} onChange={e => setEditRec(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditRec(null)}>إلغاء</button><button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button></div>
          </div>
        </div>
      )}

      {showReport && (
        <SimpleReport
          title="تقرير مخزن الدواء"
          badge={`الموقع: ${site.name}`}
          currentUser={currentUser}
          onClose={() => setShowReport(false)}
          sections={
            <>
              <div className="a4sechead">إجمالي الأصناف</div>
              <table className="a4tbl">
                <thead><tr><th>الدواء</th><th>إجمالي الوارد</th><th>مرتجع للمكتب</th><th>الرصيد</th><th>الوحدة</th></tr></thead>
                <tbody>{itemTotalsList.map((it, i) => (<tr key={i}><td><strong>{it.name}</strong></td><td>+{it.in}</td><td>-{it.ret}</td><td><strong>{it.total}</strong></td><td>{it.unit}</td></tr>))}</tbody>
              </table>
              <div className="a4sechead">سجل الوارد والمرتجع</div>
              <table className="a4tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>الدواء</th><th>الكمية</th><th>الوحدة</th><th>ملاحظات</th></tr></thead>
                <tbody>{[...allRows].sort((a, b) => a.date > b.date ? 1 : -1).map((r, i) => (<tr key={i}><td>{r.date}</td><td>{r._type === "received" ? "وارد" : "مرتجع للمكتب"}</td><td>{r.name}</td><td>{r._type === "received" ? "+" : "-"}{r.qty}</td><td>{r.unit}</td><td>{r.notes || "-"}</td></tr>))}</tbody>
              </table>
            </>
          }
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>💊 مخزن دواء {site.name}</div>
        <button className="btn btn-n btn-sm" style={{ marginRight: "auto" }} onClick={() => setShowReport(true)}>🖨️ طباعة تقرير</button>
      </div>
      <div className="pg-sub">مخزن الدواء — وارد ومرتجع للمكتب، رصيد تراكمي بالكمية</div>

      {saved === "received" && <div className="alert alert-ok">✅ تم إضافة الوارد</div>}
      {saved === "returned" && <div className="alert alert-ok">✅ تم تسجيل المرتجع للمكتب</div>}

      {canEdit && (
        <div className="card">
          <div className="card-t">📥 إضافة وارد دواء (فاتورة)</div>
          <div className="g2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="lbl">تاريخ الفاتورة</label><input className="inp" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="fg"><label className="lbl">ملاحظات على الفاتورة (اختياري)</label><input className="inp" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="مثال: فاتورة رقم..." /></div>
          </div>
          {form.items.map((it, idx) => (
            <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8, flexWrap: "wrap", background: C.cardAlt, padding: 10, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div className="fg" style={{ flex: "2 1 140px" }}><label className="lbl">صنف {idx + 1}</label><input className="inp" value={it.name} onChange={e => updateItem(setForm, it.id, "name", e.target.value)} placeholder="اسم الدواء" /></div>
              <div className="fg" style={{ flex: "1 1 90px" }}><label className="lbl">الكمية</label><input className="inp" type="number" value={it.qty} onChange={e => updateItem(setForm, it.id, "qty", e.target.value)} /></div>
              <div className="fg" style={{ flex: "1 1 90px" }}><label className="lbl">الوحدة</label><select className="inp" value={it.unit} onChange={e => updateItem(setForm, it.id, "unit", e.target.value)}><option value="مل">مل</option><option value="جم">جم</option><option value="كجم">كجم</option><option value="لتر">لتر</option><option value="عبوة">عبوة</option></select></div>
              {form.items.length > 1 && <button className="btn btn-d btn-xs" onClick={() => removeItemRow(setForm, it.id)}>🗑️</button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button className="btn btn-n btn-sm" onClick={() => addItemRow(setForm)}>➕ إضافة صنف تاني</button>
            <button className="btn btn-s btn-sm" onClick={addRec}>💾 حفظ الفاتورة ({form.items.filter(i => i.name && i.qty).length} صنف)</button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="card">
          <div className="card-t">↩️ مرتجع للمكتب (فاتورة)</div>
          <div className="g2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={retForm.date} onChange={e => setRetForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="fg"><label className="lbl">ملاحظات (اختياري)</label><input className="inp" value={retForm.notes} onChange={e => setRetForm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          {retForm.items.map((it, idx) => (
            <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8, flexWrap: "wrap", background: C.cardAlt, padding: 10, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div className="fg" style={{ flex: "2 1 140px" }}><label className="lbl">صنف {idx + 1}</label><input className="inp" value={it.name} onChange={e => updateItem(setRetForm, it.id, "name", e.target.value)} placeholder="اسم الدواء" /></div>
              <div className="fg" style={{ flex: "1 1 90px" }}><label className="lbl">الكمية</label><input className="inp" type="number" value={it.qty} onChange={e => updateItem(setRetForm, it.id, "qty", e.target.value)} /></div>
              <div className="fg" style={{ flex: "1 1 90px" }}><label className="lbl">الوحدة</label><select className="inp" value={it.unit} onChange={e => updateItem(setRetForm, it.id, "unit", e.target.value)}><option value="مل">مل</option><option value="جم">جم</option><option value="كجم">كجم</option><option value="لتر">لتر</option><option value="عبوة">عبوة</option></select></div>
              {retForm.items.length > 1 && <button className="btn btn-d btn-xs" onClick={() => removeItemRow(setRetForm, it.id)}>🗑️</button>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <button className="btn btn-n btn-sm" onClick={() => addItemRow(setRetForm)}>➕ إضافة صنف تاني</button>
            <button className="btn btn-d btn-sm" onClick={addReturn}>↩️ حفظ المرتجع ({retForm.items.filter(i => i.name && i.qty).length} صنف)</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-t">🧮 إجمالي الأصناف</div>
        <div className="fg" style={{ maxWidth: 280, marginBottom: 12 }}>
          <label className="lbl">🔍 بحث عن صنف</label>
          <input className="inp" placeholder="اكتب اسم الدواء..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {filteredTotals.length === 0 ? (
          <div className="empty"><div className="ico">💊</div><p>{search ? "لا توجد نتائج مطابقة" : "لا توجد أدوية في المخزن"}</p></div>
        ) : (
          <table className="tbl">
            <thead><tr><th>الدواء</th><th>إجمالي الوارد</th><th>مرتجع للمكتب</th><th>الرصيد</th><th>الوحدة</th></tr></thead>
            <tbody>
              {filteredTotals.map((it, i) => {
                const isSel = selectedItem === it.name;
                return (
                  <tr key={i} onClick={() => setSelectedItem(isSel ? null : it.name)} style={{ cursor: "pointer", background: isSel ? `rgba(${hexToRgb(C.accent)},.2)` : undefined, outline: isSel ? `2px solid ${C.accent}` : "none", outlineOffset: -2, transition: "background .15s" }}>
                    <td style={{ fontWeight: 700 }}>💊 {it.name}</td><td style={{ color: C.green }}>+{it.in}</td><td style={{ color: C.red }}>-{it.ret}</td><td><span className="badge by">{it.total}</span></td><td>{it.unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filteredRows.length > 0 && (
        <div className="card">
          <div className="card-t">📋 سجل المخزن</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الدواء</th><th>الكمية</th><th>الوحدة</th><th>ملاحظات</th>{canEdit && <th>إجراء</th>}</tr></thead>
              <tbody>
                {filteredRows.map(r => {
                  const isSel = selectedRec === r.id;
                  return (
                    <tr key={r.id} onClick={() => setSelectedRec(isSel ? null : r.id)} style={{ cursor: "pointer", background: isSel ? `rgba(${hexToRgb(C.accent)},.2)` : undefined, outline: isSel ? `2px solid ${C.accent}` : "none", outlineOffset: -2, transition: "background .15s" }}>
                      <td>{r.date}</td>
                      <td>{r._type === "received" ? <span className="badge bg">وارد</span> : <span className="badge br">مرتجع للمكتب</span>}</td>
                      <td style={{ fontWeight: 700 }}>💊 {r.name}</td>
                      <td style={{ color: r._type === "received" ? C.green : C.red }}>{r._type === "received" ? "+" : "-"}{r.qty}</td>
                      <td>{r.unit}</td>
                      <td>{r.notes || "-"}</td>
                      {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={e => { e.stopPropagation(); setEditRec({ ...r }); }}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={e => { e.stopPropagation(); deleteEntry(r._type, r.id); }}>🗑️</button>}</div></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== PRINT REPORT ==========
// ========== SIMPLE A4 REPORT (generic, for medicine/feed/gas store pages) ==========
function SimpleReport({ title, badge, currentUser, sections, onClose }) {
  const now = new Date();
  const reportNo = `${now.toISOString().split("T")[0].replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <div className="print-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 600, overflowY: "auto", padding: "14px 8px" }}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          .printable-report, .printable-report * { visibility: visible !important; }
          .print-overlay { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; padding: 0 !important; background: #fff !important; }
          .printable-report { position: static !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 6mm 8mm !important; border: none !important; box-shadow: none !important; background: #fff !important; }
          .np { display: none !important; }
        }
        .a4page{background:#fff;color:#111;direction:rtl;font-family:Arial,Cairo,sans-serif;max-width:780px;margin:0 auto;padding:30px 34px;border:1px solid #000;box-shadow:0 0 0 1px #000}
        .a4head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:14px;margin-bottom:14px}
        .a4title{font-size:19px;font-weight:800;text-align:center;flex:1}
        .a4sub{font-size:14px;font-weight:700;text-align:center;margin-top:2px}
        .a4badge{background:#000;color:#fff;padding:6px 18px;border-radius:6px;font-size:12px;font-weight:700;display:inline-block;margin:8px auto 14px;text-align:center}
        .a4meta{display:flex;justify-content:space-between;border-top:1px solid #000;border-bottom:1px solid #000;padding:10px 0;margin-bottom:16px;font-size:11px}
        .a4meta .mlabel{color:#444;font-size:10px}
        .a4meta .mval{font-weight:700;font-size:12px}
        .a4sechead{text-align:center;font-size:13px;font-weight:800;margin:18px 0 10px;position:relative}
        .a4sechead::before,.a4sechead::after{content:"";display:inline-block;width:60px;height:1px;background:#999;vertical-align:middle;margin:0 8px}
        .a4stats{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:6px}
        .a4box{border:1px solid #000;border-radius:8px;padding:12px 16px;text-align:center;min-width:110px;flex:1}
        .a4box .v{font-size:20px;font-weight:800}
        .a4box .l{font-size:10px;color:#444;margin-top:3px}
        .a4tbl{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:11px}
        .a4tbl th{background:#f2f2f2;border:1px solid #000;padding:7px;font-weight:800}
        .a4tbl td{border:1px solid #000;padding:6px}
        .siggrid{display:flex;justify-content:space-between;margin-top:30px;padding-top:16px}
        .sigbox{text-align:center;width:45%}
        .sigline{border-bottom:1px solid #000;height:50px;margin-bottom:6px}
        .stampcircle{width:90px;height:90px;border:2px dashed #999;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;text-align:center}
        .a4footer{text-align:center;font-size:10px;color:#666;margin-top:20px;border-top:1px solid #000;padding-top:8px}
      `}</style>

      <div className="np" style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12 }}>
        <button onClick={() => window.print()} style={{ padding: "8px 20px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>🖨️ طباعة</button>
        <button onClick={onClose} style={{ padding: "8px 20px", background: "#eee", color: "#333", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>✕ إغلاق</button>
      </div>

      <div className="a4page printable-report">
        <div className="a4head">
          <img src="/logo.png" alt="logo" style={{ width: 70, height: 70, objectFit: "contain" }} onError={e => { e.target.style.display = "none"; }} />
          <div style={{ flex: 1 }}>
            <div className="a4title">{title}</div>
            <div className="a4sub">مزارع أبوشريف</div>
          </div>
          <div style={{ width: 70 }} />
        </div>

        {badge && <div style={{ textAlign: "center" }}><span className="a4badge">{badge}</span></div>}

        <div className="a4meta">
          <div><div className="mlabel">رقم التقرير</div><div className="mval">{reportNo}</div></div>
          <div><div className="mlabel">اسم المستخدم</div><div className="mval">👤 {currentUser?.username || "-"}</div></div>
          <div><div className="mlabel">تاريخ ووقت الطباعة</div><div className="mval">{now.toLocaleDateString("en-GB")} {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div></div>
        </div>

        {sections}

        <div className="siggrid">
          <div className="sigbox">
            <div className="sigline" />
            <div style={{ fontWeight: 700, fontSize: 12 }}>توقيع مدير المزرعة</div>
          </div>
          <div className="sigbox">
            <div className="stampcircle">ختم<br />المدير</div>
          </div>
        </div>

        <div className="a4footer">مزارع أبوشريف | ABO SHERIF FARMS — تم إنشاء التقرير بتاريخ {now.toLocaleDateString("en-GB")} الساعة {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}

// ========== PRINT REPORT (PER BARN) ==========
function PrintReport({ session, siteName, barnName, currentUser, onClose }) {
  const totalMort = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0);
  const totalFeed = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).feed, 0);
  const remaining = num(session.birdCount) - totalMort;
  const mortRate = session.birdCount ? ((totalMort / num(session.birdCount)) * 100).toFixed(2) : 0;
  const age = calcAge(session.startDate, session.endDate);
  const lastW = (session.weeklyWeights || []).slice(-1)[0];
  const fcr = lastW ? calcFCR(totalFeed, num(lastW.avgWeight), remaining) : "-";
  const allMeds = (session.dailyRecords || []).flatMap(r => (r.medicines || []).map(m => ({ ...m, date: r.date, age: session.startDate ? Math.floor((new Date(r.date) - new Date(session.startDate)) / 86400000) : "-" })));
  const ageOfW = (w) => w.age != null && w.age !== "" ? num(w.age) : (w.week != null ? num(w.week) * 7 : 0);
  const feedUpToAge = (ageDays) => {
    const start = new Date(session.startDate);
    return (session.dailyRecords || []).filter(r => (new Date(r.date) - start) / 86400000 < ageDays).reduce((s, r) => s + calcDayStats(r).feed, 0);
  };
  const now = new Date();
  const reportNo = `${now.toISOString().split("T")[0].replace(/-/g, "")}-${barnName ? barnName.replace(/\D/g, "") || "1" : "1"}`;

  return (
    <div className="print-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 600, overflowY: "auto", padding: "14px 8px" }}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          .printable-report, .printable-report * { visibility: visible !important; }
          .print-overlay { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; padding: 0 !important; background: #fff !important; }
          .printable-report { position: static !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 6mm 8mm !important; border: none !important; box-shadow: none !important; background: #fff !important; }
          .np { display: none !important; }
        }
        .a4page{background:#fff;color:#111;direction:rtl;font-family:Arial,Cairo,sans-serif;max-width:780px;margin:0 auto;padding:30px 34px;border:1px solid #000;box-shadow:0 0 0 1px #000}
        .a4head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:14px;margin-bottom:14px}
        .a4title{font-size:19px;font-weight:800;text-align:center;flex:1}
        .a4sub{font-size:14px;font-weight:700;text-align:center;margin-top:2px}
        .a4badge{background:#000;color:#fff;padding:6px 18px;border-radius:6px;font-size:12px;font-weight:700;display:inline-block;margin:8px auto 14px;text-align:center}
        .a4meta{display:flex;justify-content:space-between;border-top:1px solid #000;border-bottom:1px solid #000;padding:10px 0;margin-bottom:16px;font-size:11px}
        .a4meta .mlabel{color:#444;font-size:10px}
        .a4meta .mval{font-weight:700;font-size:12px}
        .a4sechead{text-align:center;font-size:13px;font-weight:800;margin:18px 0 10px;position:relative}
        .a4sechead::before,.a4sechead::after{content:"";display:inline-block;width:60px;height:1px;background:#999;vertical-align:middle;margin:0 8px}
        .a4stats{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:6px}
        .a4box{border:1px solid #000;border-radius:8px;padding:12px 16px;text-align:center;min-width:110px;flex:1}
        .a4box .v{font-size:20px;font-weight:800}
        .a4box .l{font-size:10px;color:#444;margin-top:3px}
        .a4tbl{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:11px}
        .a4tbl th{background:#f2f2f2;border:1px solid #000;padding:7px;font-weight:800}
        .a4tbl td{border:1px solid #000;padding:6px}
        .siggrid{display:flex;justify-content:space-between;margin-top:30px;padding-top:16px}
        .sigbox{text-align:center;width:45%}
        .sigline{border-bottom:1px solid #000;height:50px;margin-bottom:6px;display:flex;align-items:flex-end;justify-content:center}
        .stampcircle{width:90px;height:90px;border:2px dashed #999;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;text-align:center}
        .a4footer{text-align:center;font-size:10px;color:#666;margin-top:20px;border-top:1px solid #000;padding-top:8px}
      `}</style>
      <div className="np" style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12 }}>
        <button onClick={() => window.print()} style={{ padding: "8px 20px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>🖨️ طباعة</button>
        <button onClick={onClose} style={{ padding: "8px 20px", background: "#eee", color: "#333", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>✕ إغلاق</button>
      </div>

      <div className="a4page printable-report">
        <div className="a4head">
          <img src="/logo.png" alt="logo" style={{ width: 70, height: 70, objectFit: "contain" }} onError={e => { e.target.style.display = "none"; }} />
          <div style={{ flex: 1 }}>
            <div className="a4title">تقرير دورة تسمين</div>
            <div className="a4sub">مزارع أبوشريف</div>
          </div>
          <div style={{ width: 70 }} />
        </div>

        <div style={{ textAlign: "center" }}><span className="a4badge">العنبر: {barnName} — {siteName}</span></div>

        <div className="a4meta">
          <div><div className="mlabel">رقم التقرير</div><div className="mval">{reportNo}</div></div>
          <div><div className="mlabel">اسم المستخدم</div><div className="mval">👤 {currentUser?.username || "-"}</div></div>
          <div><div className="mlabel">تاريخ ووقت الطباعة</div><div className="mval">{now.toLocaleDateString("en-GB")} {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div></div>
        </div>

        <div className="a4sechead">ملخص الدورة</div>
        <div className="a4stats">
          <div className="a4box"><div className="v">{num(session.birdCount).toLocaleString()}</div><div className="l">الطيور الأولية</div></div>
          <div className="a4box"><div className="v">{remaining.toLocaleString()}</div><div className="l">الطيور الحالية</div></div>
          <div className="a4box"><div className="v">{totalMort.toLocaleString()}</div><div className="l">إجمالي النافق</div></div>
          <div className="a4box"><div className="v">{mortRate}%</div><div className="l">نسبة النفوق</div></div>
          <div className="a4box"><div className="v">{totalFeed.toFixed(0)} كجم</div><div className="l">إجمالي العلف</div></div>
          {lastW && <div className="a4box"><div className="v">{lastW.avgWeight} جم</div><div className="l">آخر متوسط وزن</div></div>}
          <div className="a4box"><div className="v">{fcr}</div><div className="l">FCR</div></div>
          <div className="a4box"><div className="v">{age} يوم</div><div className="l">عمر الدورة</div></div>
        </div>

        {(session.dailyRecords || []).length > 0 && (
          <>
            <div className="a4sechead">السجلات اليومية</div>
            <table className="a4tbl">
              <thead><tr><th>التاريخ</th><th>العمر</th><th>نافق ل</th><th>نافق ن</th><th>إج نافق</th><th>علف ل</th><th>علف ن</th><th>إج علف</th></tr></thead>
              <tbody>
                {(session.dailyRecords || []).map((r, i) => {
                  const s = calcDayStats(r);
                  const dayAge = session.startDate ? Math.floor((new Date(r.date) - new Date(session.startDate)) / 86400000) : "-";
                  return (<tr key={i}><td>{r.date}</td><td><strong>{dayAge}</strong></td><td>{r.night.mortality || 0}</td><td>{r.day.mortality || 0}</td><td><strong>{s.mortality}</strong></td><td>{r.night.feed || 0}</td><td>{r.day.feed || 0}</td><td><strong>{s.feed}</strong></td></tr>);
                })}
              </tbody>
            </table>
          </>
        )}

        {(session.weeklyWeights || []).length > 0 && (
          <>
            <div className="a4sechead">الوزن حسب العمر ومعامل التحويل</div>
            <table className="a4tbl">
              <thead><tr><th>العمر</th><th>متوسط الوزن</th><th>إجمالي العلف</th><th>FCR</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {(session.weeklyWeights || []).map((w, i) => {
                  const ad = ageOfW(w);
                  const tf = feedUpToAge(ad);
                  const f = calcFCR(tf, num(w.avgWeight), remaining);
                  return (<tr key={i}><td>{ad} يوم</td><td>{w.avgWeight} جم</td><td>{tf.toFixed(0)} كجم</td><td><strong>{f}</strong></td><td>{w.note || "-"}</td></tr>);
                })}
              </tbody>
            </table>
          </>
        )}

        {allMeds.length > 0 && (
          <>
            <div className="a4sechead">سجل الأدوية</div>
            <table className="a4tbl">
              <thead><tr><th>التاريخ</th><th>العمر</th><th>الدواء</th><th>عدد الساعات</th></tr></thead>
              <tbody>{allMeds.map((m, i) => (<tr key={i}><td>{m.date}</td><td>{m.age}</td><td>{m.name}</td><td>{m.hours ? `${m.hours} ساعة` : "-"}</td></tr>))}</tbody>
            </table>
          </>
        )}

        <div className="siggrid">
          <div className="sigbox">
            <div className="sigline" />
            <div style={{ fontWeight: 700, fontSize: 12 }}>توقيع مدير المزرعة</div>
          </div>
          <div className="sigbox">
            <div className="stampcircle">ختم<br />المدير</div>
          </div>
        </div>

        <div className="a4footer">مزارع أبوشريف | ABO SHERIF FARMS — تم إنشاء التقرير بتاريخ {now.toLocaleDateString("en-GB")} الساعة {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}


// ========== START SESSION ==========
function StartSession({ barnName, siteName, onStart, onBack }) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [birds, setBirds] = useState("");
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>🐔 {barnName}</div>
      </div>
      <div className="pg-sub">{siteName}</div>
      <div className="empty">
        <div className="ico">🐣</div>
        <p style={{ marginBottom: 16, fontSize: 14, fontWeight: 700 }}>لا توجد دورة نشطة</p>
        {onStart ? (
          <div className="card" style={{ maxWidth: 360, margin: "0 auto", textAlign: "right" }}>
            <div className="card-t">🚀 بدء دورة جديدة</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">تاريخ البداية</label><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div className="fg"><label className="lbl">عدد الطيور</label><input className="inp" type="number" placeholder="25000" value={birds} onChange={e => setBirds(e.target.value)} /></div>
            </div>
            <button className="btn btn-s" onClick={() => { if (date && birds) onStart(date, birds); }}>✅ بدء الدورة</button>
          </div>
        ) : (
          <p style={{ color: C.muted, fontSize: 13 }}>ليس لديك صلاحية بدء دورة جديدة</p>
        )}
      </div>
    </div>
  );
}

// ========== BARN PAGE ==========
function BarnPage({ siteId, barnName, data, onUpdate, canEdit, isAdmin, currentUser, onBack }) {
  const siteData = data?.sites?.[siteId] || { sessions: {}, archive: [], feedStore: { received: [], dispatched: [] } };
  const session = siteData?.sessions?.[barnName] || null;
  const [activeTab, setActiveTab] = useState("daySummary");
  const [confirmAct, setConfirmAct] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const siteName = SITES.find(s => s.id === siteId)?.name;

  const deepUpdateSession = (val) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    if (!d.sites) d.sites = {};
    if (!d.sites[siteId]) d.sites[siteId] = { sessions: {}, archive: [], feedStore: { received: [], dispatched: [] } };
    if (!d.sites[siteId].sessions) d.sites[siteId].sessions = {};
    d.sites[siteId].sessions[barnName] = val;
    onUpdate(d);
  };

  const startSession = (date, birds) => {
    const s = emptySession(barnName);
    s.startDate = date; s.birdCount = birds;
    deepUpdateSession(s);
  };

  // Saves a daily record AND atomically deducts feed/medicine stock in a single update
  const saveDailyRecord = (record) => {
    if (!onUpdate) return { ok: false, err: "لا تملك صلاحية" };
    const d = JSON.parse(JSON.stringify(data));
    if (!d.sites[siteId]) d.sites[siteId] = { sessions: {}, archive: [], feedStore: { received: [], dispatched: [] }, medStore: { received: [] } };
    const fs = d.sites[siteId].feedStore || { received: [], dispatched: [] };

    const totalFeedToday = num(record.night.feed) + num(record.day.feed);
    if (totalFeedToday > 0) {
      const totalIn = fs.received.reduce((s, r) => s + num(r.qty), 0);
      const totalOut = fs.dispatched.reduce((s, r) => s + num(r.qty), 0);
      const totalReturned = (fs.returned || []).reduce((s, r) => s + num(r.qty), 0);
      const balance = totalIn - totalOut - totalReturned;
      if (balance < totalFeedToday) return { ok: false, err: "الكمية المتاحة في مخزن العلف غير كافية!" };
      fs.dispatched.push({ id: genId(), date: record.date, barn: barnName, item: "علف (استهلاك يومي)", qty: totalFeedToday });
    }

    d.sites[siteId].feedStore = fs;
    if (!d.sites[siteId].sessions) d.sites[siteId].sessions = {};
    const currentSession = d.sites[siteId].sessions[barnName] || session;
    d.sites[siteId].sessions[barnName] = { ...currentSession, dailyRecords: [...(currentSession.dailyRecords || []), record] };

    onUpdate(d);
    return { ok: true };
  };

  // Edits a daily record (mortality/feed/medicines) AND keeps the feed store balance in sync
  const editDailyRecord = (recordId, updatedRecord) => {
    if (!onUpdate) return { ok: false, err: "لا تملك صلاحية" };
    const d = JSON.parse(JSON.stringify(data));
    const fs = d.sites[siteId].feedStore || { received: [], dispatched: [], returned: [] };
    const recs = d.sites[siteId].sessions[barnName].dailyRecords;
    const oldRec = recs.find(r => r.id === recordId);
    if (!oldRec) return { ok: false, err: "السجل غير موجود" };

    const oldFeed = num(oldRec.night.feed) + num(oldRec.day.feed);
    const newFeed = num(updatedRecord.night.feed) + num(updatedRecord.day.feed);
    const entry = fs.dispatched.find(x => x.barn === barnName && x.date === oldRec.date && x.item === "علف (استهلاك يومي)" && num(x.qty) === oldFeed);

    if (newFeed !== oldFeed) {
      const totalIn = (fs.received || []).reduce((s, r) => s + num(r.qty), 0);
      const totalOut = (fs.dispatched || []).reduce((s, r) => s + num(r.qty), 0);
      const totalReturned = (fs.returned || []).reduce((s, r) => s + num(r.qty), 0);
      const currentBalance = totalIn - totalOut - totalReturned;
      const extraNeeded = newFeed - oldFeed;
      if (extraNeeded > 0 && currentBalance < extraNeeded) return { ok: false, err: "الكمية المتاحة في مخزن العلف غير كافية للتعديل!" };
      if (entry) {
        if (newFeed > 0) { entry.qty = newFeed; entry.date = updatedRecord.date; }
        else fs.dispatched = fs.dispatched.filter(x => x !== entry);
      } else if (newFeed > 0) {
        fs.dispatched.push({ id: genId(), date: updatedRecord.date, barn: barnName, item: "علف (استهلاك يومي)", qty: newFeed });
      }
    } else if (entry && updatedRecord.date !== oldRec.date) {
      entry.date = updatedRecord.date;
    }

    d.sites[siteId].feedStore = fs;
    d.sites[siteId].sessions[barnName].dailyRecords = recs.map(r => r.id === recordId ? updatedRecord : r);
    onUpdate(d);
    return { ok: true };
  };

  // Reverts feed stock when a daily record is deleted, and removes the record
  const deleteDailyRecord = (recordId) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    const fs = d.sites[siteId].feedStore || { received: [], dispatched: [] };
    const rec = (session.dailyRecords || []).find(r => r.id === recordId);
    if (rec) {
      fs.dispatched = fs.dispatched.filter(x => !(x.barn === barnName && x.date === rec.date && x.item === "علف (استهلاك يومي)" && num(x.qty) === num(rec.night.feed) + num(rec.day.feed)));
    }
    d.sites[siteId].feedStore = fs;
    d.sites[siteId].sessions[barnName] = { ...session, dailyRecords: session.dailyRecords.filter(r => r.id !== recordId) };
    onUpdate(d);
  };

  // Edits a medicine entry's name/hours inside a specific daily record (no stock tracking anymore)
  const editMedInRecord = (recordId, medId, newName, newHours) => {
    if (!onUpdate) return { ok: false, err: "لا تملك صلاحية" };
    const d = JSON.parse(JSON.stringify(data));
    const recs = d.sites[siteId].sessions[barnName].dailyRecords;
    const rec = recs.find(r => r.id === recordId);
    if (!rec) return { ok: false, err: "السجل غير موجود" };
    rec.medicines = (rec.medicines || []).map(m => m.id === medId ? { ...m, name: newName, hours: newHours } : m);
    onUpdate(d);
    return { ok: true };
  };

  // Deletes a medicine entry from a daily record
  const deleteMedFromRecord = (recordId, medId) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    const recs = d.sites[siteId].sessions[barnName].dailyRecords;
    const rec = recs.find(r => r.id === recordId);
    if (!rec) return;
    rec.medicines = (rec.medicines || []).filter(m => m.id !== medId);
    onUpdate(d);
  };

  if (!session) return <StartSession barnName={barnName} siteName={siteName} onStart={isAdmin ? startSession : null} onBack={onBack} />;


  return (
    <div>
      {confirmAct && <Confirm msg={confirmAct.msg} onOk={() => { confirmAct.fn(); setConfirmAct(null); }} onCancel={() => setConfirmAct(null)} />}
      {showReport && <PrintReport session={session} siteName={siteName} barnName={barnName} currentUser={currentUser} onClose={() => setShowReport(false)} />}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>🐔 {barnName}</div>
        <div className="pg-sub" style={{ margin: "0 0 0 4px" }}>{siteName}</div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📅 <strong style={{ color: C.accent }}>{session.startDate}</strong></div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>🐔 <strong style={{ color: C.green }}>{num(session.birdCount).toLocaleString()}</strong></div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📆 <strong style={{ color: C.accent }}>{calcAge(session.startDate)} يوم</strong></div>
        <div style={{ marginRight: "auto", display: "flex", gap: 5 }}>
          <button className="btn btn-n btn-sm" onClick={() => setShowReport(true)}>🖨️ تقرير</button>
          {isAdmin && <button className="btn btn-w btn-sm" onClick={() => setConfirmAct({ msg: "هل تريد أرشفة الدورة؟ سيتم أرشفة ملخص وتفاصيل الدورة كاملة مع بيانات كل المخازن خلال فترتها.", fn: () => {
            const d = JSON.parse(JSON.stringify(data));
            d.sites[siteId].archive = d.sites[siteId].archive || [];
            const fs = d.sites[siteId].feedStore || { received: [], dispatched: [], returned: [] };
            const gs = d.sites[siteId].gasStore || { received: [] };
            const ms = d.sites[siteId].medStore || { received: [], returned: [] };
            const inj = d.sites[siteId].injections || [];
            const startD = session.startDate ? new Date(session.startDate) : null;
            const endD = new Date();
            const endDateStr = endD.toISOString().split("T")[0];
            const inPeriod = (dateStr) => !!dateStr && (!startD || (new Date(dateStr) >= startD && new Date(dateStr) <= endD));

            // صرف العلف الخاص بهذا العنبر تحديداً طوال الدورة
            const feedDispatchedForBarn = (fs.dispatched || []).filter(r => r.barn === barnName);
            // أرشفة كاملة لمخزن العلف (وارد/صادر/مرتجع) خلال فترة الدورة
            const feedStoreSnapshot = {
              received: (fs.received || []).filter(r => inPeriod(r.date)),
              dispatched: (fs.dispatched || []).filter(r => inPeriod(r.date)),
              returned: (fs.returned || []).filter(r => inPeriod(r.date)),
            };
            // أرشفة كاملة لمخزن الدواء (وارد/مرتجع) خلال فترة الدورة
            const medStoreSnapshot = {
              received: (ms.received || []).filter(r => inPeriod(r.date)),
              returned: (ms.returned || []).filter(r => inPeriod(r.date)),
            };
            // أرشفة خزان الجاز خلال فترة الدورة
            const gasSnapshot = (gs.received || []).filter(r => inPeriod(r.date));
            // أرشفة سجل الحقن خلال فترة الدورة
            const injectionsSnapshot = inj.filter(r => inPeriod(r.date));
            // الأدوية المستخدمة فعلياً في هذا العنبر (من السجل اليومي)
            const medSnapshot = (session.dailyRecords || []).flatMap(r => (r.medicines || []).map(m => ({ ...m, date: r.date })));

            d.sites[siteId].archive.push({
              ...session,
              endDate: endDateStr,
              archivedAt: new Date().toISOString(),
              feedSnapshot: feedDispatchedForBarn,
              feedStoreSnapshot,
              medStoreSnapshot,
              gasSnapshot,
              medSnapshot,
              injectionsSnapshot,
            });
            d.sites[siteId].sessions[barnName] = null;
            onUpdate(d);
          } })}>📦 أرشفة</button>}
          {isAdmin && <button className="btn btn-d btn-sm" onClick={() => setConfirmAct({ msg: "⚠️ هتمسح الدورة نهائي!", fn: () => deepUpdateSession(null) })}>🗑️ حذف</button>}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === "daySummary" ? "active" : ""}`} onClick={() => setActiveTab("daySummary")}>📋 ملخص اليوم</button>
        <button className={`tab ${activeTab === "daily" ? "active" : ""}`} onClick={() => setActiveTab("daily")}>📅 التسجيل</button>
        <button className={`tab ${activeTab === "weight" ? "active" : ""}`} onClick={() => setActiveTab("weight")}>⚖️ الوزن</button>
        <button className={`tab ${activeTab === "medicine" ? "active" : ""}`} onClick={() => setActiveTab("medicine")}>💊 الدواء</button>
        <button className={`tab ${activeTab === "summary" ? "active" : ""}`} onClick={() => setActiveTab("summary")}>📊 ملخص الدورة</button>
      </div>

      {activeTab === "daySummary" && <DaySummaryTab session={session} hideFeed={siteId === "qatour"} />}
      {activeTab === "daily" && <DailyTab session={session} siteId={siteId} onUpdate={canEdit ? deepUpdateSession : null} feedStore={siteData.feedStore} medStore={siteData.medStore} onSaveRecord={canEdit ? saveDailyRecord : null} onEditRecord={canEdit ? editDailyRecord : null} onDeleteRecord={isAdmin ? deleteDailyRecord : null} isAdmin={isAdmin} />}
      {activeTab === "weight" && <WeightTab session={session} onUpdate={canEdit ? deepUpdateSession : null} isAdmin={isAdmin} />}
      {activeTab === "medicine" && <MedicineTab session={session} onEditMed={canEdit ? editMedInRecord : null} onDeleteMed={isAdmin ? deleteMedFromRecord : null} barnName={barnName} siteName={siteName} currentUser={currentUser} />}
      {activeTab === "summary" && <SummaryTab session={session} />}
    </div>
  );
}

// ========== ARCHIVE PAGE ==========
function ArchivePage({ data, onUpdate, siteId, onBack, currentUser, isAdmin }) {
  const [selectedArchive, setSelectedArchive] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const site = SITES.find(s => s.id === siteId);

  const allArchived = (data?.sites?.[siteId]?.archive || []).map((s, idx) => ({ ...s, siteName: site.name, siteId, idx }));

  // تجميع عنابر نفس الدورة مع بعض (العنابر اللي بدأت في نفس التاريخ = دورة واحدة)
  const groups = {};
  allArchived.forEach(s => {
    const key = s.startDate || "بدون تاريخ";
    if (!groups[key]) groups[key] = { startDate: s.startDate, items: [] };
    groups[key].items.push(s);
  });
  const groupList = Object.entries(groups).map(([key, g]) => {
    const endDateDisp = g.items.reduce((max, it) => {
      const d = it.endDate || it.archivedAt?.split("T")[0] || "";
      return d > max ? d : max;
    }, "");
    return { ...g, key, endDate: endDateDisp };
  }).sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));

  const oldArchivesCount = (data?.sites?.[siteId]?.archive || []).filter(s => !s.feedStoreSnapshot).length;

  const migrateOldArchives = () => {
    setConfirm({ msg: `هيتم تحديث ${oldArchivesCount} دورة قديمة مؤرشفة، وإضافة تاريخ النهاية وأرشفة كاملة للمخازن (العلف/الدواء/الحقن) بناءً على البيانات الحالية الموجودة في المخازن خلال فترة كل دورة. ملاحظة: أي حركة مخزن اتمسحت أو اتعدلت بعد الأرشفة مش هترجع. متابعة؟`, fn: () => {
      const d = JSON.parse(JSON.stringify(data));
      const arch = d.sites[siteId].archive || [];
      const fs = d.sites[siteId].feedStore || { received: [], dispatched: [], returned: [] };
      const gs = d.sites[siteId].gasStore || { received: [] };
      const ms = d.sites[siteId].medStore || { received: [], returned: [] };
      const inj = d.sites[siteId].injections || [];

      d.sites[siteId].archive = arch.map(a => {
        if (a.feedStoreSnapshot) return a; // اتحدثت قبل كده
        const endDateStr = a.endDate || a.archivedAt?.split("T")[0] || new Date().toISOString().split("T")[0];
        const startD = a.startDate ? new Date(a.startDate) : null;
        const endD = new Date(endDateStr);
        const inPeriod = (dateStr) => !!dateStr && (!startD || (new Date(dateStr) >= startD && new Date(dateStr) <= endD));
        return {
          ...a,
          endDate: endDateStr,
          feedStoreSnapshot: {
            received: (fs.received || []).filter(r => inPeriod(r.date)),
            dispatched: (fs.dispatched || []).filter(r => inPeriod(r.date)),
            returned: (fs.returned || []).filter(r => inPeriod(r.date)),
          },
          medStoreSnapshot: {
            received: (ms.received || []).filter(r => inPeriod(r.date)),
            returned: (ms.returned || []).filter(r => inPeriod(r.date)),
          },
          injectionsSnapshot: inj.filter(r => inPeriod(r.date)),
          gasSnapshot: a.gasSnapshot && a.gasSnapshot.length > 0 ? a.gasSnapshot : (gs.received || []).filter(r => inPeriod(r.date)),
        };
      });
      onUpdate(d);
    }});
  };

  const deleteArchive = (sid, idx) => {
    setConfirm({ msg: "هتمسح الدورة من الأرشيف نهائي؟", fn: () => {
      const d = JSON.parse(JSON.stringify(data));
      d.sites[sid].archive.splice(idx, 1);
      onUpdate(d); setSelectedArchive(null);
    }});
  };

  if (selectedArchive) {
    const s = allArchived.find(x => x.idx === selectedArchive.idx);
    if (!s) { setSelectedArchive(null); return null; }
    const endDateDisplay = s.endDate || s.archivedAt?.split("T")[0];
    return (
      <div>
        {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
        {showReport && <PrintReport session={s} siteName={s.siteName} barnName={s.barnName} currentUser={currentUser} onClose={() => setShowReport(false)} />}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <button className="btn btn-n btn-sm" onClick={() => setSelectedArchive(null)}>← رجوع</button>
          <div className="pg-title" style={{ margin: 0 }}>📦 {s.barnName} — {s.siteName}</div>
          <div style={{ marginRight: "auto", display: "flex", gap: 6 }}>
            <button className="btn btn-n btn-sm" onClick={() => setShowReport(true)}>🖨️ تقرير الدورة الكامل</button>
            <button className="btn btn-d btn-sm" onClick={() => deleteArchive(s.siteId, s.idx)}>🗑️ حذف</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📅 تاريخ البداية: <strong>{s.startDate}</strong></div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📅 تاريخ النهاية: <strong>{endDateDisplay}</strong></div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>🐔 طيور: <strong>{num(s.birdCount).toLocaleString()}</strong></div>
        </div>
        <div className="card-t" style={{ margin: "6px 2px" }}>📊 ملخص الدورة</div>
        <SummaryTab session={s} />
        <div className="card-t" style={{ margin: "16px 2px 6px" }}>📋 تفاصيل الدورة</div>
        {(s.dailyRecords || []).length > 0 && (
          <div className="card">
            <div className="card-t">📅 السجلات اليومية</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>إج نافق</th><th>إج علف</th></tr></thead>
                <tbody>{(s.dailyRecords || []).map((r, i) => {
                  const st = calcDayStats(r);
                  const dayAge = s.startDate ? Math.floor((new Date(r.date) - new Date(s.startDate)) / 86400000) : "-";
                  return (<tr key={i}><td>{r.date}</td><td><span className="badge by">{dayAge} يوم</span></td><td><span className="badge br">{st.mortality}</span></td><td><span className="badge by">{st.feed} كجم</span></td></tr>);
                })}</tbody>
              </table>
            </div>
          </div>
        )}
        <MedicineTab session={s} onEditMed={null} onDeleteMed={null} medStore={[]} />

        {(s.weeklyWeights || []).length > 0 && (
          <div className="card">
            <div className="card-t">⚖️ الوزن حسب العمر</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ التقريبي</th><th>العمر</th><th>متوسط الوزن</th><th>عدد العينة</th><th>ملاحظة</th></tr></thead>
                <tbody>
                  {(s.weeklyWeights || []).map((w, i) => {
                    const ad = w.age != null && w.age !== "" ? num(w.age) : (w.week != null ? num(w.week) * 7 : 0);
                    const approxDate = s.startDate ? new Date(new Date(s.startDate).getTime() + ad * 86400000).toISOString().split("T")[0] : "-";
                    return (<tr key={i}><td>{approxDate}</td><td><span className="badge by">{ad} يوم</span></td><td style={{ color: C.accent, fontWeight: 700 }}>{w.avgWeight} جم</td><td>{w.sampleCount}</td><td style={{ fontSize: 11, color: C.muted }}>{w.note || "-"}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(s.feedSnapshot || []).length > 0 && (
          <div className="card">
            <div className="card-t">🌾 علف مصروف على هذا العنبر خلال الدورة</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>الصنف</th><th>الكمية المصروفة</th></tr></thead>
                <tbody>
                  {(s.feedSnapshot || []).map((r, i) => {
                    const dayAge = s.startDate ? Math.floor((new Date(r.date) - new Date(s.startDate)) / 86400000) : "-";
                    return (<tr key={i}><td>{r.date}</td><td><span className="badge by">{dayAge} يوم</span></td><td>{r.item || "-"}</td><td style={{ color: C.red }}>-{r.qty} كجم</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card-t" style={{ margin: "16px 2px 6px" }}>📦 أرشيف المخازن خلال فترة الدورة</div>

        {s.feedStoreSnapshot && (s.feedStoreSnapshot.received.length + s.feedStoreSnapshot.dispatched.length + s.feedStoreSnapshot.returned.length > 0) && (
          <div className="card">
            <div className="card-t">🌾 مخزن العلف (كل الموقع) — {s.startDate} إلى {endDateDisplay}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, fontSize: 11 }}>
              <span className="badge bg">إجمالي وارد: +{s.feedStoreSnapshot.received.reduce((x, r) => x + num(r.qty), 0).toFixed(0)} كجم</span>
              <span className="badge br">إجمالي صادر: -{s.feedStoreSnapshot.dispatched.reduce((x, r) => x + num(r.qty), 0).toFixed(0)} كجم</span>
              <span className="badge br">مرتجع للمكتب: -{s.feedStoreSnapshot.returned.reduce((x, r) => x + num(r.qty), 0).toFixed(0)} كجم</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>العنبر</th><th>الصنف</th><th>الكمية</th></tr></thead>
                <tbody>
                  {[
                    ...s.feedStoreSnapshot.received.map(r => ({ ...r, _type: "received" })),
                    ...s.feedStoreSnapshot.dispatched.map(r => ({ ...r, _type: "dispatched" })),
                    ...s.feedStoreSnapshot.returned.map(r => ({ ...r, _type: "returned" })),
                  ].sort((a, b) => a.date > b.date ? 1 : -1).map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td>{r._type === "received" ? <span className="badge bg">وارد</span> : r._type === "dispatched" ? <span className="badge br">صرف</span> : <span className="badge br">مرتجع</span>}</td>
                      <td>{r.barn || "-"}</td>
                      <td>{r.item || "-"}</td>
                      <td style={{ color: r._type === "received" ? C.green : C.red }}>{r._type === "received" ? "+" : "-"}{r.qty} كجم</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {s.medStoreSnapshot && (s.medStoreSnapshot.received.length + s.medStoreSnapshot.returned.length > 0) && (
          <div className="card">
            <div className="card-t">💊 مخزن الدواء (كل الموقع) — {s.startDate} إلى {endDateDisplay}</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>الدواء</th><th>الكمية</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  {[
                    ...s.medStoreSnapshot.received.map(r => ({ ...r, _type: "received" })),
                    ...s.medStoreSnapshot.returned.map(r => ({ ...r, _type: "returned" })),
                  ].sort((a, b) => a.date > b.date ? 1 : -1).map((r, i) => (
                    <tr key={i}>
                      <td>{r.date}</td>
                      <td>{r._type === "received" ? <span className="badge bg">وارد</span> : <span className="badge br">مرتجع</span>}</td>
                      <td>💊 {r.name}</td>
                      <td style={{ color: r._type === "received" ? C.green : C.red }}>{r._type === "received" ? "+" : "-"}{r.qty} {r.unit || ""}</td>
                      <td>{r.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(s.medSnapshot || []).length > 0 && (
          <div className="card">
            <div className="card-t">💊 الأدوية المستخدمة فعلياً في هذا العنبر</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>الدواء</th><th>عدد الساعات</th></tr></thead>
                <tbody>
                  {(s.medSnapshot || []).map((m, i) => {
                    const dayAge = s.startDate ? Math.floor((new Date(m.date) - new Date(s.startDate)) / 86400000) : "-";
                    return (<tr key={i}><td>{m.date}</td><td><span className="badge by">{dayAge} يوم</span></td><td>💊 {m.name}</td><td>{m.hours ? `${m.hours} ساعة` : "-"}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(s.injectionsSnapshot || []).length > 0 && (
          <div className="card">
            <div className="card-t">💉 سجل الحقن (كل الموقع) خلال فترة الدورة</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>الأدوية</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  {(s.injectionsSnapshot || []).map((r, i) => (
                    <tr key={i}><td>{r.date}</td><td>{r.type || "-"}</td><td>{(r.meds || []).map(m => m.name).filter(Boolean).join("، ") || "-"}</td><td>{r.notes || "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(s.gasSnapshot || []).length > 0 && (
          <div className="card">
            <div className="card-t">🔥 خزان الجاز (كل الموقع) خلال فترة الدورة</div>
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead><tr><th>التاريخ</th><th>العمر</th><th>الكمية</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  {(s.gasSnapshot || []).map((r, i) => {
                    const dayAge = s.startDate ? Math.floor((new Date(r.date) - new Date(s.startDate)) / 86400000) : "-";
                    return (<tr key={i}><td>{r.date}</td><td><span className="badge by">{dayAge} يوم</span></td><td style={{ color: C.green }}>+{r.qty} لتر</td><td>{r.notes || "-"}</td></tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== صفحة الدورة: العنابر جوا، والتاريخ برا =====
  if (selectedGroup) {
    const g = groups[selectedGroup];
    if (!g) { setSelectedGroup(null); return null; }
    return (
      <div>
        {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <button className="btn btn-n btn-sm" onClick={() => setSelectedGroup(null)}>← رجوع</button>
          <div className="pg-title" style={{ margin: 0 }}>📦 دورة {site.name}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📅 تاريخ البداية: <strong>{g.startDate}</strong></div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontSize: 11 }}>📅 تاريخ النهاية: <strong>{g.endDate || "-"}</strong></div>
        </div>
        <div className="pg-sub">اختار العنبر لعرض تفاصيله</div>
        {g.items.map(s => {
          const tm = (s.dailyRecords || []).reduce((x, r) => x + calcDayStats(r).mortality, 0);
          const tf = (s.dailyRecords || []).reduce((x, r) => x + calcDayStats(r).feed, 0);
          return (
            <div key={s.idx} onClick={() => setSelectedArchive({ idx: s.idx })}
              style={{ background: C.card, borderRadius: 10, padding: 14, marginBottom: 10, border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .2s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 3, fontSize: 13 }}>🐔 {s.barnName}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>طيور: {num(s.birdCount).toLocaleString()} | نافق: {tm} | علف: {tf} كجم</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <span className="badge by">منتهية</span>
                  <button className="btn btn-d btn-xs" onClick={e => { e.stopPropagation(); deleteArchive(s.siteId, s.idx); }}>🗑️</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>📦 أرشيف {site.name}</div>
        {isAdmin && oldArchivesCount > 0 && (
          <button className="btn btn-w btn-sm" style={{ marginRight: "auto" }} onClick={migrateOldArchives}>🔄 تحديث {oldArchivesCount} دورة قديمة (إضافة أرشفة المخازن)</button>
        )}
      </div>
      <div className="pg-sub">اضغط على دورة لعرض العنابر</div>
      {groupList.length === 0 ? (
        <div className="empty"><div className="ico">📭</div><p>لا توجد دورات مؤرشفة في هذا الموقع</p></div>
      ) : groupList.map((g, gi) => {
        const tm = g.items.reduce((x, s) => x + (s.dailyRecords || []).reduce((y, r) => y + calcDayStats(r).mortality, 0), 0);
        const tf = g.items.reduce((x, s) => x + (s.dailyRecords || []).reduce((y, r) => y + calcDayStats(r).feed, 0), 0);
        const tb = g.items.reduce((x, s) => x + num(s.birdCount), 0);
        return (
          <div key={gi} onClick={() => setSelectedGroup(g.key)}
            style={{ background: C.card, borderRadius: 10, padding: 14, marginBottom: 10, border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .2s" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 3, fontSize: 13 }}>📦 دورة {g.items.length > 1 ? `(${g.items.length} عنابر)` : `— ${g.items[0].barnName}`}</div>
                <div style={{ fontSize: 11, color: C.muted }}>بداية: {g.startDate} | نهاية: {g.endDate || "-"} | طيور: {tb.toLocaleString()} | نافق: {tm} | علف: {tf} كجم</div>
              </div>
              <span className="badge by">منتهية</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ========== SETTINGS PAGE ==========
function SettingsPage({ currentUser, data, onUpdate, onDataRestore, notifStatus, onEnableNotif, onDisableNotif }) {
  const isAdmin = currentUser?.role === "admin";
  const [activeTab, setActiveTab] = useState("backup");
  const [notifMsg, setNotifMsg] = useState("");
  const [notifBusy, setNotifBusy] = useState(false);
  const [backups, setBackups] = useState([]);
  const [loadingBk, setLoadingBk] = useState(false);
  const [bkLabel, setBkLabel] = useState("");
  const [savingBk, setSavingBk] = useState(false);
  const [bkMsg, setBkMsg] = useState("");
  const [users, setUsers] = useState([]);
  const [loadingU, setLoadingU] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "viewer", can_edit: false, allowed_sites: [] });
  const [showNew, setShowNew] = useState(false);
  const [uMsg, setUMsg] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [newSiteForm, setNewSiteForm] = useState({ name: "", barnCount: "" });
  const [siteMsg, setSiteMsg] = useState("");
  const [addBarnForm, setAddBarnForm] = useState({});

  useEffect(() => {
    if (activeTab === "backup") { setLoadingBk(true); fetchBackups().then(b => { setBackups(Array.isArray(b) ? b : []); setLoadingBk(false); }); }
    if (activeTab === "users" && isAdmin) { setLoadingU(true); fetchUsers().then(u => { setUsers(Array.isArray(u) ? u : []); setLoadingU(false); }); }
  }, [activeTab]);

  const doSaveBk = async () => {
    setSavingBk(true);
    await saveBackup(data, bkLabel || `نسخة ${new Date().toLocaleString("ar-EG")}`);
    setBkLabel(""); setBkMsg("✅ تم حفظ النسخة"); setTimeout(() => setBkMsg(""), 3000);
    const b = await fetchBackups(); setBackups(Array.isArray(b) ? b : []);
    setSavingBk(false);
  };

  const doRestoreBk = (id) => {
    setConfirm({ msg: "هتستبدل كل البيانات الحالية؟", fn: async () => {
      const d = await restoreBackupById(id);
      if (d) { await saveData(d); onDataRestore(d); setBkMsg("✅ تم الاستعادة"); setTimeout(() => setBkMsg(""), 3000); }
    }});
  };

  const doSaveUser = async () => {
    if (!editUser?.username || !editUser?.password) return;
    await updateUser(editUser.id, { username: editUser.username, password: editUser.password, role: editUser.role, can_edit: editUser.can_edit, allowed_sites: editUser.allowed_sites || [] });
    setEditUser(null); setUMsg("✅ تم الحفظ"); setTimeout(() => setUMsg(""), 2000);
    fetchUsers().then(u => setUsers(Array.isArray(u) ? u : []));
  };

  const doCreateUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await createUser(newUser);
    setNewUser({ username: "", password: "", role: "viewer", can_edit: false, allowed_sites: [] });
    setShowNew(false); setUMsg("✅ تم إضافة المستخدم"); setTimeout(() => setUMsg(""), 2000);
    fetchUsers().then(u => setUsers(Array.isArray(u) ? u : []));
  };

  const toggleSite = (u, setU, siteId) => {
    const sites = u.allowed_sites || [];
    setU(p => ({ ...p, allowed_sites: sites.includes(siteId) ? sites.filter(s => s !== siteId) : [...sites, siteId] }));
  };

  const addSite = () => {
    const name = newSiteForm.name.trim();
    const barnCount = Math.floor(num(newSiteForm.barnCount));
    if (!name || barnCount < 1) return;
    if (SITES.some(s => s.name === name)) { setSiteMsg("⚠️ فيه موقع بنفس الاسم ده"); setTimeout(() => setSiteMsg(""), 3000); return; }
    const id = "custom_" + genId();
    const barns = Array.from({ length: barnCount }, (_, i) => `عنبر ${i + 1}`);
    const newSite = { id, name, barns, custom: true };
    SITES.push(newSite);
    const d = JSON.parse(JSON.stringify(data));
    d.customSites = [...(d.customSites || []), newSite];
    d.sites[id] = { sessions: {}, archive: [], feedStore: { received: [], dispatched: [], returned: [] }, medStore: { received: [], returned: [] }, gasStore: { received: [] }, injections: [] };
    barns.forEach(b => { d.sites[id].sessions[b] = null; });
    onUpdate(d);
    setNewSiteForm({ name: "", barnCount: "" });
    setSiteMsg("✅ تم إضافة الموقع"); setTimeout(() => setSiteMsg(""), 3000);
  };

  const addBarnsToSite = (siteId) => {
    const site = SITES.find(s => s.id === siteId);
    if (!site) return;
    const count = Math.floor(num(addBarnForm[siteId]));
    if (!count || count < 1) return;
    const startIdx = site.barns.length + 1;
    const newBarns = Array.from({ length: count }, (_, i) => `عنبر ${startIdx + i}`);
    site.barns.push(...newBarns);
    const d = JSON.parse(JSON.stringify(data));
    d.extraBarns = { ...(d.extraBarns || {}) };
    d.extraBarns[siteId] = [...(d.extraBarns[siteId] || []), ...newBarns];
    if (d.customSites) {
      d.customSites = d.customSites.map(cs => cs.id === siteId ? { ...cs, barns: [...cs.barns, ...newBarns] } : cs);
    }
    d.sites[siteId] = d.sites[siteId] || { sessions: {}, archive: [], feedStore: { received: [], dispatched: [], returned: [] }, medStore: { received: [], returned: [] }, gasStore: { received: [] }, injections: [] };
    newBarns.forEach(b => { d.sites[siteId].sessions[b] = null; });
    onUpdate(d);
    setAddBarnForm(p => ({ ...p, [siteId]: "" }));
    setSiteMsg("✅ تم إضافة العنابر"); setTimeout(() => setSiteMsg(""), 3000);
  };

  const UserForm = ({ u, setU, onSave, onCancel }) => (
    <div className="card" style={{ border: `1.5px solid ${C.accent}` }}>
      <div className="g2" style={{ marginBottom: 10 }}>
        <div className="fg"><label className="lbl">اسم المستخدم</label><input className="inp" value={u.username} onChange={e => setU(p => ({ ...p, username: e.target.value }))} /></div>
        <div className="fg"><label className="lbl">كلمة المرور</label><input className="inp" value={u.password} onChange={e => setU(p => ({ ...p, password: e.target.value }))} /></div>
        <div className="fg"><label className="lbl">الدور</label><select className="inp" value={u.role} onChange={e => setU(p => ({ ...p, role: e.target.value }))}>
          <option value="admin">مدير</option><option value="editor">محرر</option><option value="viewer">مشاهد</option>
        </select></div>
        <div className="fg"><label className="lbl">يقدر يعدل البيانات؟</label>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button className={`btn btn-sm ${u.can_edit ? "btn-s" : "btn-n"}`} onClick={() => setU(p => ({ ...p, can_edit: true }))}>✅ نعم</button>
            <button className={`btn btn-sm ${!u.can_edit ? "btn-d" : "btn-n"}`} onClick={() => setU(p => ({ ...p, can_edit: false }))}>❌ لا</button>
          </div>
        </div>
      </div>
      {u.role !== "admin" && (
        <div style={{ marginBottom: 10 }}>
          <div className="lbl" style={{ marginBottom: 6 }}>المواقع المسموحة (فاضية = كل المواقع)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SITES.map(s => (
              <button key={s.id} className={`btn btn-sm ${(u.allowed_sites || []).includes(s.id) ? "btn-p" : "btn-n"}`} onClick={() => toggleSite(u, setU, s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-n btn-sm" onClick={onCancel}>إلغاء</button>
        <button className="btn btn-p btn-sm" onClick={onSave}>💾 حفظ</button>
      </div>
    </div>
  );

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={async () => { await confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      <div className="pg-title">⚙️ الإعدادات</div>
      <div className="tabs">
        <button className={`tab ${activeTab === "backup" ? "active" : ""}`} onClick={() => setActiveTab("backup")}>💾 النسخ الاحتياطي</button>
        <button className={`tab ${activeTab === "notif" ? "active" : ""}`} onClick={() => setActiveTab("notif")}>🔔 الإشعارات</button>
        {isAdmin && <button className={`tab ${activeTab === "users" ? "active" : ""}`} onClick={() => setActiveTab("users")}>👥 المستخدمين</button>}
        {isAdmin && <button className={`tab ${activeTab === "sites" ? "active" : ""}`} onClick={() => setActiveTab("sites")}>🏭 المواقع</button>}
      </div>

      {activeTab === "notif" && (
        <div>
          {notifMsg && <div className={`alert ${notifStatus === "granted" ? "alert-ok" : "alert-err"}`}>{notifMsg}</div>}
          <div className="card">
            <div className="card-t">🔔 إشعارات هذا الجهاز</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9, marginBottom: 12 }}>
              لما تفعّل الإشعارات، هيجيلك تنبيه على الجهاز ده أول ما حد يسجل أي حاجة في البرنامج (يومية، وزن، علف، دواء، جاز، حقن، دورة جديدة...) — حتى لو البرنامج مقفول، طول ما الجهاز شغال ومتصل بالنت.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>الحالة الحالية:</span>
              {notifStatus === "granted" && <span className="badge bg">✅ مفعّلة</span>}
              {notifStatus === "denied" && <span className="badge br">🚫 ممنوعة من المتصفح</span>}
              {notifStatus === "default" && <span className="badge by">⚪ غير مفعّلة بعد</span>}
              {notifStatus === "unsupported" && <span className="badge br">❌ غير مدعومة على الجهاز ده</span>}
            </div>
            {notifStatus === "denied" && (
              <div style={{ fontSize: 11.5, color: C.red, marginBottom: 10, lineHeight: 1.8 }}>
                لازم تسمح بالإشعارات يدوي من إعدادات المتصفح لموقع البرنامج (🔒 بجانب شريط العنوان) عشان تقدر تفعّلها.
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              {notifStatus !== "granted" && notifStatus !== "unsupported" && (
                <button className="btn btn-p btn-sm" disabled={notifBusy} onClick={async () => {
                  setNotifBusy(true); setNotifMsg("");
                  const r = await onEnableNotif();
                  setNotifMsg(r.ok ? "✅ تم تفعيل الإشعارات على الجهاز ده" : `⚠️ ${r.err || "تعذر التفعيل"}`);
                  setNotifBusy(false); setTimeout(() => setNotifMsg(""), 4000);
                }}>{notifBusy ? "..." : "🔔 تفعيل الإشعارات"}</button>
              )}
              {notifStatus === "granted" && (
                <button className="btn btn-n btn-sm" disabled={notifBusy} onClick={async () => {
                  setNotifBusy(true); await onDisableNotif(); setNotifBusy(false);
                  setNotifMsg("🔕 تم إيقاف الإشعارات على الجهاز ده"); setTimeout(() => setNotifMsg(""), 4000);
                }}>{notifBusy ? "..." : "🔕 إيقاف على هذا الجهاز"}</button>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-t">ℹ️ ملاحظات مهمة</div>
            <ul style={{ fontSize: 11.5, color: C.muted, lineHeight: 2, paddingRight: 18 }}>
              <li>لازم تفعّل الإشعارات من كل جهاز بيستخدم فيه أي حد البرنامج (موبايل، تابلت، لابتوب) على حدة.</li>
              <li>على الآيفون: لازم تضيف البرنامج للشاشة الرئيسية (زر المشاركة ← Add to Home Screen) الأول، وبعدين تفتحه من الأيقونة وتفعّل الإشعارات من جواه.</li>
              <li>لو مسحت البرنامج من على الجهاز أو غيرت المتصفح، هتحتاج تفعّل الإشعارات تاني.</li>
            </ul>
          </div>
        </div>
      )}

      {activeTab === "sites" && isAdmin && (
        <div>
          {siteMsg && <div className="alert alert-ok">{siteMsg}</div>}
          <div className="card">
            <div className="card-t">➕ إضافة موقع جديد</div>
            <div className="g2" style={{ marginBottom: 10 }}>
              <div className="fg"><label className="lbl">اسم الموقع</label><input className="inp" value={newSiteForm.name} onChange={e => setNewSiteForm(p => ({ ...p, name: e.target.value }))} placeholder="مثال: مزرعة الأمل" /></div>
              <div className="fg"><label className="lbl">عدد العنابر</label><input className="inp" type="number" min="1" value={newSiteForm.barnCount} onChange={e => setNewSiteForm(p => ({ ...p, barnCount: e.target.value }))} placeholder="مثال: 3" /></div>
            </div>
            <button className="btn btn-p btn-sm" onClick={addSite}>💾 إضافة الموقع</button>
          </div>
          <div className="card">
            <div className="card-t">📋 المواقع الحالية</div>
            {SITES.map(s => (
              <div key={s.id} style={{ padding: "8px 4px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>🏭 {s.name}</span>
                  <span style={{ color: C.muted }}>{s.barns.length} عنابر{s.custom && <span className="badge by" style={{ marginRight: 6 }}>مُضاف</span>}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input className="inp" type="number" min="1" style={{ maxWidth: 90 }} placeholder="عدد" value={addBarnForm[s.id] || ""} onChange={e => setAddBarnForm(p => ({ ...p, [s.id]: e.target.value }))} />
                  <button className="btn btn-p btn-xs" onClick={() => addBarnsToSite(s.id)}>➕ إضافة عنابر</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "backup" && (
        <div>
          {bkMsg && <div className="alert alert-ok">{bkMsg}</div>}
          <div className="card">
            <div className="card-t">☁️ حفظ نسخة على Supabase</div>
            <div className="g2" style={{ marginBottom: 10 }}>
              <div className="fg"><label className="lbl">اسم النسخة (اختياري)</label><input className="inp" placeholder="مثال: قبل التسليم" value={bkLabel} onChange={e => setBkLabel(e.target.value)} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-s btn-sm" onClick={doSaveBk} disabled={savingBk}>{savingBk ? "..." : "☁️ حفظ الآن"}</button>
              <button className="btn btn-n btn-sm" onClick={() => downloadBackup(data)}>⬇️ تنزيل JSON</button>
            </div>
          </div>
          <div className="card">
            <div className="card-t">📋 آخر النسخ</div>
            {loadingBk ? <div style={{ color: C.muted, fontSize: 12 }}>جاري التحميل...</div> :
              backups.length === 0 ? <div style={{ color: C.muted, fontSize: 12 }}>لا توجد نسخ بعد</div> :
              backups.map(b => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}`, gap: 8, flexWrap: "wrap" }}>
                  <div><div style={{ fontSize: 12, fontWeight: 700 }}>💾 {b.label}</div><div style={{ fontSize: 10, color: C.muted }}>{new Date(b.created_at).toLocaleString("ar-EG")}</div></div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button className="btn btn-w btn-xs" onClick={() => doRestoreBk(b.id)}>↩️ استعادة</button>
                    <button className="btn btn-d btn-xs" onClick={() => setConfirm({ msg: "هتمسح النسخة دي؟", fn: async () => { await deleteBackupById(b.id); const bks = await fetchBackups(); setBackups(Array.isArray(bks) ? bks : []); } })}>🗑️</button>
                  </div>
                </div>
              ))
            }
          </div>
          <div className="card">
            <div className="card-t">⬆️ استعادة من ملف</div>
            <label style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-block", color: C.text }}>
              📂 اختر ملف JSON
              <input type="file" accept=".json" style={{ display: "none" }} onChange={e => {
                const file = e.target.files[0]; if (!file) return;
                setConfirm({ msg: "هتستبدل كل البيانات الحالية؟", fn: () => restoreBackup(file, d => { onDataRestore(d); setBkMsg("✅ تم الاستعادة"); setTimeout(() => setBkMsg(""), 3000); }) });
              }} />
            </label>
          </div>
        </div>
      )}

      {activeTab === "users" && isAdmin && (
        <div>
          {uMsg && <div className="alert alert-ok">{uMsg}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>إجمالي: {users.length} مستخدمين</div>
            <button className="btn btn-s btn-sm" onClick={() => { setShowNew(true); setEditUser(null); }}>+ إضافة مستخدم</button>
          </div>
          {showNew && <UserForm u={newUser} setU={setNewUser} onSave={doCreateUser} onCancel={() => setShowNew(false)} />}
          {loadingU ? <div style={{ color: C.muted }}>جاري التحميل...</div> :
            users.map(u => (
              <div key={u.id}>
                {editUser?.id === u.id ? (
                  <UserForm u={editUser} setU={setEditUser} onSave={doSaveUser} onCancel={() => setEditUser(null)} />
                ) : (
                  <div style={{ background: C.cardAlt, borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>👤 {u.username}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          <span className={`badge ${u.role === "admin" ? "by" : u.role === "editor" ? "bb" : "bg"}`}>{u.role === "admin" ? "مدير" : u.role === "editor" ? "محرر" : "مشاهد"}</span>
                          {" "}{u.can_edit ? <span className="badge bg">يعدل</span> : <span className="badge br">مشاهدة فقط</span>}
                          {(u.allowed_sites || []).length > 0 && <span style={{ marginRight: 6 }}>| {(u.allowed_sites || []).map(id => SITES.find(s => s.id === id)?.name).join("، ")}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button className="btn btn-n btn-xs" onClick={() => { setEditUser({ ...u }); setShowNew(false); }}>✏️</button>
                        {u.username !== currentUser.username && <button className="btn btn-d btn-xs" onClick={() => setConfirm({ msg: "هتمسح المستخدم ده؟", fn: async () => { await deleteUser(u.id); fetchUsers().then(us => setUsers(Array.isArray(us) ? us : [])); } })}>🗑️</button>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ========== SITE REPORT ==========
function SiteReport({ siteId, data, currentUser, onClose }) {
  const site = SITES.find(s => s.id === siteId);
  const siteData = data?.sites?.[siteId] || { sessions: {}, feedStore: { received: [], dispatched: [] } };

  const barnStats = site.barns.map(barn => {
    const session = siteData?.sessions?.[barn];
    if (!session) return { barn, hasSession: false, birds: 0, feed: 0, mortality: 0, birdsStart: 0 };
    const totalMort = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0);
    const totalFeed = (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).feed, 0);
    const remaining = num(session.birdCount) - totalMort;
    return { barn, hasSession: true, birds: remaining, birdsStart: num(session.birdCount), feed: totalFeed, mortality: totalMort, startDate: session.startDate, age: calcAge(session.startDate) };
  });

  const totalBirdsStart = barnStats.reduce((s, b) => s + b.birdsStart, 0);
  const totalBirds = barnStats.reduce((s, b) => s + b.birds, 0);
  const totalMortAll = barnStats.reduce((s, b) => s + b.mortality, 0);
  const mortRateAll = totalBirdsStart ? ((totalMortAll / totalBirdsStart) * 100).toFixed(2) : "0.00";
  const totalFeedConsumed = barnStats.reduce((s, b) => s + b.feed, 0);
  const totalFeedIn = (siteData.feedStore?.received || []).reduce((s, r) => s + num(r.qty), 0);
  const gasBalance = (siteData.gasStore?.received || []).reduce((s, r) => s + num(r.qty), 0);
  const totalInjections = (siteData.injections || []).length;
  const activeBarns = barnStats.filter(b => b.hasSession).length;
  const now = new Date();
  const reportNo = `${now.toISOString().split("T")[0].replace(/-/g, "")}-${siteId}`;

  return (
    <div className="print-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 600, overflowY: "auto", padding: "14px 8px" }}>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          html, body { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          .printable-report, .printable-report * { visibility: visible !important; }
          .print-overlay { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; padding: 0 !important; background: #fff !important; }
          .printable-report { position: static !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 6mm 8mm !important; border: none !important; box-shadow: none !important; background: #fff !important; }
          .np { display: none !important; }
        }
        .a4page{background:#fff;color:#111;direction:rtl;font-family:Arial,Cairo,sans-serif;max-width:780px;margin:0 auto;padding:30px 34px;border:1px solid #000;box-shadow:0 0 0 1px #000}
        .a4head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:14px;margin-bottom:14px}
        .a4title{font-size:19px;font-weight:800;text-align:center;flex:1}
        .a4sub{font-size:14px;font-weight:700;text-align:center;margin-top:2px}
        .a4badge{background:#000;color:#fff;padding:6px 18px;border-radius:6px;font-size:12px;font-weight:700;display:inline-block;margin:8px auto 14px;text-align:center}
        .a4meta{display:flex;justify-content:space-between;border-top:1px solid #000;border-bottom:1px solid #000;padding:10px 0;margin-bottom:16px;font-size:11px}
        .a4meta .mlabel{color:#444;font-size:10px}
        .a4meta .mval{font-weight:700;font-size:12px}
        .a4sechead{text-align:center;font-size:13px;font-weight:800;margin:18px 0 10px;position:relative}
        .a4sechead::before,.a4sechead::after{content:"";display:inline-block;width:60px;height:1px;background:#999;vertical-align:middle;margin:0 8px}
        .a4stats{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-bottom:6px}
        .a4box{border:1px solid #000;border-radius:8px;padding:12px 16px;text-align:center;min-width:110px;flex:1}
        .a4box .v{font-size:20px;font-weight:800}
        .a4box .l{font-size:10px;color:#444;margin-top:3px}
        .a4tbl{width:100%;border-collapse:collapse;margin-bottom:6px;font-size:11px}
        .a4tbl th{background:#f2f2f2;border:1px solid #000;padding:7px;font-weight:800}
        .a4tbl td{border:1px solid #000;padding:6px}
        .siggrid{display:flex;justify-content:space-between;margin-top:30px;padding-top:16px}
        .sigbox{text-align:center;width:45%}
        .sigline{border-bottom:1px solid #000;height:50px;margin-bottom:6px}
        .stampcircle{width:90px;height:90px;border:2px dashed #999;border-radius:50%;margin:0 auto 6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:11px;text-align:center}
        .a4footer{text-align:center;font-size:10px;color:#666;margin-top:20px;border-top:1px solid #000;padding-top:8px}
      `}</style>

      <div className="np" style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12 }}>
        <button onClick={() => window.print()} style={{ padding: "8px 20px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>🖨️ طباعة</button>
        <button onClick={onClose} style={{ padding: "8px 20px", background: "#eee", color: "#333", border: "none", borderRadius: 8, fontFamily: "Cairo", fontWeight: 700, cursor: "pointer" }}>✕ إغلاق</button>
      </div>

      <div className="a4page printable-report">
        <div className="a4head">
          <img src="/logo.png" alt="logo" style={{ width: 70, height: 70, objectFit: "contain" }} onError={e => { e.target.style.display = "none"; }} />
          <div style={{ flex: 1 }}>
            <div className="a4title">تقرير متابعة المزرعة</div>
            <div className="a4sub">مزارع أبوشريف</div>
          </div>
          <div style={{ width: 70 }} />
        </div>

        <div style={{ textAlign: "center" }}><span className="a4badge">موقع التقرير: {site.name}</span></div>

        <div className="a4meta">
          <div><div className="mlabel">رقم التقرير</div><div className="mval">{reportNo}</div></div>
          <div><div className="mlabel">اسم المستخدم</div><div className="mval">👤 {currentUser?.username || "-"}</div></div>
          <div><div className="mlabel">تاريخ ووقت الطباعة</div><div className="mval">{now.toLocaleDateString("en-GB")} {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div></div>
        </div>

        <div className="a4sechead">ملخص الموقع</div>
        <div className="a4stats">
          <div className="a4box"><div className="v">{totalBirds.toLocaleString()}</div><div className="l">إجمالي الطيور الحالية</div></div>
          <div className="a4box"><div className="v">{totalMortAll.toLocaleString()}</div><div className="l">إجمالي النافق</div></div>
          <div className="a4box"><div className="v">{mortRateAll}%</div><div className="l">نسبة النفوق</div></div>
          <div className="a4box"><div className="v">{totalFeedConsumed.toFixed(0)} كجم</div><div className="l">إجمالي العلف المستهلك</div></div>
          <div className="a4box"><div className="v">{gasBalance.toFixed(0)} لتر</div><div className="l">رصيد خزان الجاز</div></div>
          <div className="a4box"><div className="v">{totalInjections}</div><div className="l">عدد عمليات الحقن والتقطير</div></div>
        </div>

        <div className="a4sechead">تفاصيل العنابر</div>
        <table className="a4tbl">
          <thead><tr><th>العنبر</th><th>تاريخ البداية</th><th>العمر</th><th>طيور البداية</th><th>الطيور الحالية</th><th>النافق</th><th>نسبة النفوق</th><th>العلف المستهلك</th><th>الحالة</th></tr></thead>
          <tbody>
            {barnStats.map((b, i) => (
              <tr key={i}>
                <td><strong>{b.barn}</strong></td>
                <td>{b.hasSession ? b.startDate : "-"}</td>
                <td>{b.hasSession ? `${b.age} يوم` : "-"}</td>
                <td>{b.hasSession ? b.birdsStart.toLocaleString() : "-"}</td>
                <td><strong>{b.hasSession ? b.birds.toLocaleString() : "-"}</strong></td>
                <td>{b.hasSession ? b.mortality : "-"}</td>
                <td>{b.hasSession ? `${((b.mortality / b.birdsStart) * 100 || 0).toFixed(2)}%` : "-"}</td>
                <td>{b.hasSession ? `${b.feed.toFixed(0)} كجم` : "-"}</td>
                <td>{b.hasSession ? "نشطة ✅" : "فارغ"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="a4sechead">إحصائيات الدورة</div>
        <div className="a4stats">
          <div className="a4box"><div className="v">{activeBarns}</div><div className="l">عدد العنابر النشطة</div></div>
          <div className="a4box"><div className="v">{totalBirdsStart.toLocaleString()}</div><div className="l">إجمالي طيور البداية</div></div>
          <div className="a4box"><div className="v">{totalBirds.toLocaleString()}</div><div className="l">إجمالي الطيور الحالية</div></div>
          <div className="a4box"><div className="v">{totalMortAll.toLocaleString()}</div><div className="l">إجمالي النافق</div></div>
          <div className="a4box"><div className="v">{mortRateAll}%</div><div className="l">نسبة النفوق الكلية</div></div>
          <div className="a4box"><div className="v">{totalFeedConsumed.toFixed(0)} كجم</div><div className="l">إجمالي العلف المستهلك</div></div>
        </div>

        <div className="siggrid">
          <div className="sigbox">
            <div className="sigline" />
            <div style={{ fontWeight: 700, fontSize: 12 }}>توقيع مدير المزرعة</div>
          </div>
          <div className="sigbox">
            <div className="stampcircle">ختم<br />المدير</div>
          </div>
        </div>

        <div className="a4footer">مزارع أبوشريف | ABO SHERIF FARMS — تم إنشاء التقرير بتاريخ {now.toLocaleDateString("en-GB")} الساعة {now.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</div>
      </div>
    </div>
  );
}

// ========== GAS TANK (SITE-LEVEL, RECEIVED ONLY) ==========
function GasStorePage({ siteId, data, onUpdate, isAdmin, currentUser, onBack }) {
  const canEdit = !!onUpdate;
  const site = SITES.find(s => s.id === siteId);
  const gasStore = data?.sites?.[siteId]?.gasStore || { received: [] };
  const [recForm, setRecForm] = useState({ date: new Date().toISOString().split("T")[0], qty: "", notes: "" });
  const [editRec, setEditRec] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const totalIn = (gasStore.received || []).reduce((s, r) => s + num(r.qty), 0);

  const deepUpdate = (newReceived) => {
    if (!onUpdate) return;
    const d = JSON.parse(JSON.stringify(data));
    if (!d.sites[siteId]) return;
    d.sites[siteId].gasStore = { received: newReceived };
    onUpdate(d);
  };

  const addRec = () => {
    if (!recForm.qty || !canEdit) return;
    deepUpdate([...(gasStore.received || []), { id: genId(), ...recForm }]);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setRecForm(p => ({ ...p, qty: "", notes: "" }));
  };

  const deleteEntry = (id) => {
    setConfirm({ msg: "هتمسح السجل ده؟", fn: () => deepUpdate((gasStore.received || []).filter(r => r.id !== id)) });
  };

  const saveEdit = () => {
    if (!editRec) return;
    deepUpdate((gasStore.received || []).map(r => r.id === editRec.id ? editRec : r));
    setEditRec(null);
  };

  const rows = [...(gasStore.received || [])].sort((a, b) => a.date > b.date ? 1 : -1);

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editRec && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل السجل</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={editRec.date} onChange={e => setEditRec(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">الكمية (لتر)</label><input className="inp" type="number" value={editRec.qty} onChange={e => setEditRec(p => ({ ...p, qty: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={editRec.notes || ""} onChange={e => setEditRec(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditRec(null)}>إلغاء</button><button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button></div>
          </div>
        </div>
      )}

      {showReport && (
        <SimpleReport
          title="تقرير خزان الجاز"
          badge={`الموقع: ${site.name}`}
          currentUser={currentUser}
          onClose={() => setShowReport(false)}
          sections={
            <>
              <div className="a4sechead">ملخص الخزان</div>
              <div className="a4stats">
                <div className="a4box"><div className="v">{totalIn.toFixed(0)} لتر</div><div className="l">إجمالي الرصيد الحالي</div></div>
              </div>
              <div className="a4sechead">سجل وارد الجاز</div>
              <table className="a4tbl">
                <thead><tr><th>التاريخ</th><th>الكمية (لتر)</th><th>ملاحظات</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}><td>{r.date}</td><td>+{r.qty}</td><td>{r.notes || "-"}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          }
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>🔥 خزان جاز {site.name}</div>
        <button className="btn btn-n btn-sm" style={{ marginRight: "auto" }} onClick={() => setShowReport(true)}>🖨️ طباعة تقرير</button>
      </div>
      <div className="pg-sub">خزان جاز على مستوى الموقع — بالـ لتر — رصيد تراكمي (وارد فقط)</div>

      {saved && <div className="alert alert-ok">✅ تم</div>}

      <div className="stats">
        <div className="stat"><div className="sv cg">{totalIn.toFixed(0)} لتر</div><div className="sl">إجمالي الرصيد الحالي</div></div>
      </div>

      {canEdit && (
        <div className="card">
          <div className="card-t">📥 إضافة وارد جاز</div>
          <div className="g3">
            <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={recForm.date} onChange={e => setRecForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="fg"><label className="lbl">الكمية (لتر)</label><input className="inp" type="number" value={recForm.qty} onChange={e => setRecForm(p => ({ ...p, qty: e.target.value }))} /></div>
            <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={recForm.notes} onChange={e => setRecForm(p => ({ ...p, notes: e.target.value }))} /></div>
          </div>
          <button className="btn btn-s btn-sm" style={{ marginTop: 10 }} onClick={addRec}>+ إضافة</button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="card-t">📋 سجل وارد الجاز</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>الكمية (لتر)</th><th>ملاحظات</th>{canEdit && <th>إجراء</th>}</tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td style={{ color: C.green, fontWeight: 700 }}>+{r.qty}</td>
                    <td>{r.notes || "-"}</td>
                    {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={() => setEditRec({ ...r })}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={() => deleteEntry(r.id)}>🗑️</button>}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== INJECTIONS / حقن وتقطير (SITE-LEVEL, PULLS FROM MED STORE) ==========
// ملاحظة: السجل يدعم أكثر من دواء في نفس عملية الحقن/التقطير عن طريق مصفوفة meds: [{name, qty}]
// وبيفضل يقرأ السجلات القديمة (name/qty مباشرة) عشان التوافق مع البيانات السابقة
const getMeds = (r) => {
  if (r.meds && r.meds.length) return r.meds;
  if (r.name) return [{ name: r.name, qty: r.qty }];
  return [];
};
const emptyMed = () => ({ name: "", qty: "" });

function InjectionsPage({ siteId, data, onUpdate, isAdmin, currentUser, onBack }) {
  const canEdit = !!onUpdate;
  const site = SITES.find(s => s.id === siteId);
  const injections = data?.sites?.[siteId]?.injections || [];
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], type: "حقن", meds: [emptyMed()], notes: "" });
  const [editRec, setEditRec] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState("");
  const [showReport, setShowReport] = useState(false);

  const setFormMed = (i, key, val) => setForm(p => ({ ...p, meds: p.meds.map((m, idx) => idx === i ? { ...m, [key]: val } : m) }));
  const addFormMedRow = () => setForm(p => ({ ...p, meds: [...p.meds, emptyMed()] }));
  const removeFormMedRow = (i) => setForm(p => ({ ...p, meds: p.meds.filter((_, idx) => idx !== i) }));

  const setEditMed = (i, key, val) => setEditRec(p => ({ ...p, meds: getMeds(p).map((m, idx) => idx === i ? { ...m, [key]: val } : m) }));
  const addEditMedRow = () => setEditRec(p => ({ ...p, meds: [...getMeds(p), emptyMed()] }));
  const removeEditMedRow = (i) => setEditRec(p => ({ ...p, meds: getMeds(p).filter((_, idx) => idx !== i) }));

  const addRec = () => {
    const meds = form.meds.filter(m => m.name && m.name.trim());
    if (!meds.length || !canEdit) return;
    const d = JSON.parse(JSON.stringify(data));
    const inj = d.sites[siteId].injections || [];
    inj.push({ id: genId(), date: form.date, type: form.type, meds, notes: form.notes });
    d.sites[siteId].injections = inj;
    onUpdate(d);
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    setForm({ date: form.date, type: form.type, meds: [emptyMed()], notes: "" });
  };

  const deleteRec = (id) => {
    setConfirm({ msg: "هتمسح السجل ده؟", fn: () => {
      const d = JSON.parse(JSON.stringify(data));
      d.sites[siteId].injections = (d.sites[siteId].injections || []).filter(r => r.id !== id);
      onUpdate(d);
    }});
  };

  const saveEdit = () => {
    if (!editRec || !canEdit) return;
    const cleanMeds = getMeds(editRec).filter(m => m.name && m.name.trim());
    const rec = { id: editRec.id, date: editRec.date, type: editRec.type, meds: cleanMeds, notes: editRec.notes || "" };
    const d = JSON.parse(JSON.stringify(data));
    d.sites[siteId].injections = (d.sites[siteId].injections || []).map(r => r.id === rec.id ? rec : r);
    onUpdate(d);
    setEditRec(null);
  };

  const rows = [...injections]
    .filter(r => !search || getMeds(r).some(m => (m.name || "").toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => a.date > b.date ? 1 : -1);
  const totalByName = {};
  injections.forEach(r => { getMeds(r).forEach(m => { if (!m.name) return; totalByName[m.name] = (totalByName[m.name] || 0) + num(m.qty); }); });

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {editRec && (
        <div className="modal-bg">
          <div className="modal">
            <div className="modal-t">✏️ تعديل سجل {editRec.type}</div>
            <div className="g2" style={{ marginBottom: 12 }}>
              <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={editRec.date} onChange={e => setEditRec(p => ({ ...p, date: e.target.value }))} /></div>
              <div className="fg"><label className="lbl">النوع</label><select className="inp" value={editRec.type} onChange={e => setEditRec(p => ({ ...p, type: e.target.value }))}><option value="حقن">حقن</option><option value="تقطير">تقطير</option></select></div>
            </div>
            <div className="fg" style={{ marginBottom: 8 }}>
              <label className="lbl">الأدوية</label>
              {getMeds(editRec).map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <input className="inp" style={{ flex: 2 }} placeholder="اسم الدواء" value={m.name} onChange={e => setEditMed(i, "name", e.target.value)} />
                  <input className="inp" style={{ flex: 1 }} type="number" placeholder="الكمية" value={m.qty} onChange={e => setEditMed(i, "qty", e.target.value)} />
                  {getMeds(editRec).length > 1 && <button className="btn btn-d btn-xs" onClick={() => removeEditMedRow(i)}>🗑️</button>}
                </div>
              ))}
              <button className="btn btn-n btn-sm" onClick={addEditMedRow}>+ إضافة دواء</button>
            </div>
            <div className="fg" style={{ marginBottom: 12 }}><label className="lbl">ملاحظات</label><input className="inp" value={editRec.notes || ""} onChange={e => setEditRec(p => ({ ...p, notes: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8 }}><button className="btn btn-n" style={{ flex: 1 }} onClick={() => setEditRec(null)}>إلغاء</button><button className="btn btn-p" style={{ flex: 1 }} onClick={saveEdit}>💾 حفظ</button></div>
          </div>
        </div>
      )}

      {showReport && (
        <SimpleReport
          title="تقرير حقن وتقطير"
          badge={`الموقع: ${site.name}`}
          currentUser={currentUser}
          onClose={() => setShowReport(false)}
          sections={
            <>
              <div className="a4sechead">إجمالي الاستخدام لكل دواء</div>
              <table className="a4tbl">
                <thead><tr><th>الدواء</th><th>إجمالي الكمية المستخدمة</th></tr></thead>
                <tbody>{Object.entries(totalByName).map(([name, qty], i) => (<tr key={i}><td><strong>{name}</strong></td><td>{qty}</td></tr>))}</tbody>
              </table>
              <div className="a4sechead">سجل الحقن والتقطير</div>
              <table className="a4tbl">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>الأدوية والكميات</th><th>ملاحظات</th></tr></thead>
                <tbody>{rows.map((r, i) => (<tr key={i}><td>{r.date}</td><td>{r.type}</td><td>{getMeds(r).map(m => `${m.name}${m.qty ? " (" + m.qty + ")" : ""}`).join("، ")}</td><td>{r.notes || "-"}</td></tr>))}</tbody>
              </table>
            </>
          }
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2, flexWrap: "wrap" }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>💉 حقن وتقطير {site.name}</div>
        {rows.length > 0 && <button className="btn btn-n btn-sm" style={{ marginRight: "auto" }} onClick={() => setShowReport(true)}>🖨️ طباعة تقرير</button>}
      </div>
      <div className="pg-sub">سجل مستقل — غير مرتبط بمخزن الدواء</div>

      {saved && <div className="alert alert-ok">✅ تم الحفظ</div>}

      {canEdit && (
        <div className="card">
          <div className="card-t">➕ تسجيل جديد</div>
          <div className="g2" style={{ marginBottom: 10 }}>
            <div className="fg"><label className="lbl">التاريخ</label><input className="inp" type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div className="fg"><label className="lbl">النوع</label><select className="inp" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}><option value="حقن">حقن</option><option value="تقطير">تقطير</option></select></div>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="lbl">الأدوية (تقدر تضيف أكتر من دواء في نفس العملية)</label>
            {form.meds.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input className="inp" style={{ flex: 2 }} placeholder="اسم الدواء" value={m.name} onChange={e => setFormMed(i, "name", e.target.value)} />
                <input className="inp" style={{ flex: 1 }} type="number" placeholder="الكمية" value={m.qty} onChange={e => setFormMed(i, "qty", e.target.value)} />
                {form.meds.length > 1 && <button className="btn btn-d btn-xs" onClick={() => removeFormMedRow(i)}>🗑️</button>}
              </div>
            ))}
            <button className="btn btn-n btn-sm" onClick={addFormMedRow}>+ إضافة دواء</button>
          </div>
          <div className="fg"><label className="lbl">ملاحظات</label><input className="inp" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
          <button className="btn btn-s btn-sm" style={{ marginTop: 10 }} onClick={addRec}>+ تسجيل</button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="card-t">📋 سجل الحقن والتقطير</div>
          <div className="fg" style={{ maxWidth: 280, marginBottom: 12 }}>
            <label className="lbl">🔍 بحث عن دواء</label>
            <input className="inp" placeholder="اكتب اسم الدواء..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>التاريخ</th><th>النوع</th><th>الأدوية</th><th>ملاحظات</th>{canEdit && <th>إجراء</th>}</tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td><span className="badge" style={{ background: r.type === "حقن" ? `rgba(${hexToRgb(C.red)},.12)` : `rgba(${hexToRgb(C.blue)},.12)`, color: r.type === "حقن" ? C.red : C.blue }}>{r.type}</span></td>
                    <td style={{ fontWeight: 700 }}>
                      {getMeds(r).map((m, i) => (
                        <div key={i}>💊 {m.name}{m.qty ? ` — ${m.qty}` : ""}</div>
                      ))}
                    </td>
                    <td>{r.notes || "-"}</td>
                    {canEdit && <td><div style={{ display: "flex", gap: 3 }}><button className="btn btn-n btn-xs" onClick={() => setEditRec({ ...r })}>✏️</button>{isAdmin && <button className="btn btn-d btn-xs" onClick={() => deleteRec(r.id)}>🗑️</button>}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== SITE PAGE ==========
function SitePage({ siteId, data, onSelectBarn, onDeleteSite, onBack, onOpenStore, onOpenMedStore, onOpenGasStore, onOpenInjections, onOpenArchive, currentUser }) {
  const site = SITES.find(s => s.id === siteId);
  const siteData = data?.sites?.[siteId] || { sessions: {} };
  const [confirm, setConfirm] = useState(null);
  const [showReport, setShowReport] = useState(false);

  const activeBarns = site.barns.filter(b => siteData?.sessions?.[b]);
  const totalBirdsNow = activeBarns.reduce((sum, b) => {
    const ses = siteData.sessions[b];
    const tm = (ses.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0);
    return sum + (num(ses.birdCount) - tm);
  }, 0);
  const totalBirdsStart = activeBarns.reduce((sum, b) => sum + num(siteData.sessions[b].birdCount), 0);

  return (
    <div>
      {confirm && <Confirm msg={confirm.msg} onOk={() => { confirm.fn(); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
      {showReport && <SiteReport siteId={siteId} data={data} currentUser={currentUser} onClose={() => setShowReport(false)} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
          <div className="pg-title" style={{ margin: 0 }}>🏭 {site.name}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-n btn-sm" onClick={() => setShowReport(true)}>🖨️ تقرير الموقع</button>
          {onDeleteSite && <button className="btn btn-d btn-sm" onClick={() => setConfirm({ msg: `هتمسح كل دورات "${site.name}" ومخزن العلف ومخزن الدواء وخزان الجاز وسجل الحقن والتقطير نهائي!`, fn: () => onDeleteSite(siteId) })}>🗑️ حذف الكل</button>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => onOpenStore(siteId)} style={{ flex: "1 1 140px", background: C.card, border: `1.5px solid ${C.accent}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Cairo", fontWeight: 700, fontSize: 12, color: C.accent }}>🌾 مخزن العلف</button>
        <button onClick={() => onOpenMedStore(siteId)} style={{ flex: "1 1 140px", background: C.card, border: `1.5px solid ${C.purple}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Cairo", fontWeight: 700, fontSize: 12, color: C.purple }}>💊 مخزن الدواء</button>
        <button onClick={() => onOpenGasStore(siteId)} style={{ flex: "1 1 140px", background: C.card, border: `1.5px solid ${C.orange}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Cairo", fontWeight: 700, fontSize: 12, color: C.orange }}>🔥 خزان الجاز</button>
        <button onClick={() => onOpenInjections(siteId)} style={{ flex: "1 1 140px", background: C.card, border: `1.5px solid ${C.red}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Cairo", fontWeight: 700, fontSize: 12, color: C.red }}>💉 حقن وتقطير</button>
        <button onClick={() => onOpenArchive(siteId)} style={{ flex: "1 1 140px", background: C.card, border: `1.5px solid ${C.muted}`, borderRadius: 10, padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "Cairo", fontWeight: 700, fontSize: 12, color: C.text }}>📦 الأرشيف</button>
      </div>

      <div className="stats" style={{ marginBottom: 14, gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))" }}>
        <div className="stat" style={{ padding: 8 }}><div className="sv cg" style={{ fontSize: 15 }}>{totalBirdsNow.toLocaleString()}</div><div className="sl" style={{ fontSize: 10 }}>🐔 إجمالي طيور الموقع الحالي</div></div>
        <div className="stat" style={{ padding: 8 }}><div className="sv cy" style={{ fontSize: 15 }}>{totalBirdsStart.toLocaleString()}</div><div className="sl" style={{ fontSize: 10 }}>إجمالي الطيور عند بدء الدورات</div></div>
      </div>

      <div className="pg-sub">اختر العنبر</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        {site.barns.map(barn => {
          const session = siteData?.sessions?.[barn];
          const hasSession = !!session;
          const totalMort = hasSession ? (session.dailyRecords || []).reduce((s, r) => s + calcDayStats(r).mortality, 0) : 0;
          const age = hasSession ? calcAge(session.startDate) : 0;
          const remaining = hasSession ? num(session.birdCount) - totalMort : 0;
          return (
            <div key={barn} onClick={() => onSelectBarn(siteId, barn)}
              style={{ background: C.card, border: `2px solid ${hasSession ? C.green : C.border}`, borderRadius: 14, padding: 16, cursor: "pointer", transition: "all .2s", boxShadow: "0 1px 5px rgba(0,0,0,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>🐔 {barn}</div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 16, background: hasSession ? `rgba(${hexToRgb(C.green)},.12)` : C.cardAlt, color: hasSession ? C.green : C.muted }}>{hasSession ? "نشطة ✅" : "فارغ"}</span>
              </div>
              {hasSession ? (
                <div style={{ fontSize: 11, color: C.muted }}>
                  <div>📅 بداية: <strong style={{ color: C.text }}>{session.startDate}</strong></div>
                  <div>📆 العمر: <strong style={{ color: C.accent }}>{age} يوم</strong></div>
                  <div>🐔 الطيور: <strong style={{ color: C.text }}>{remaining.toLocaleString()}</strong></div>
                </div>
              ) : <div style={{ fontSize: 11, color: C.muted }}>لا توجد دورة نشطة</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ========== HOME PAGE ==========
// ألوان ثابتة لكل موقع حسب ترتيبه — مشتقة من نفس هوية "مخزن الحبوب" عشان أي موقع جديد ينسجم لونياً مع الباقي
const SITE_PALETTE = [
  { accent: C.accent, g1: "#F3E2B4", g2: "#D9AC5C", icon: "🌾" },
  { accent: C.green, g1: "#D9EAD9", g2: "#9CC79E", icon: "🌿" },
  { accent: C.red, g1: "#F1DAD3", g2: "#D69C8D", icon: "🐔" },
  { accent: C.blue, g1: "#D6E6E6", g2: "#94C0C1", icon: "💧" },
  { accent: C.purple, g1: "#E6DAE7", g2: "#B98CBC", icon: "🏠" },
  { accent: C.orange, g1: "#F1DFC4", g2: "#DFA968", icon: "🔥" },
];
const siteTheme = (siteId) => {
  const idx = SITES.findIndex(s => s.id === siteId);
  return SITE_PALETTE[(idx >= 0 ? idx : 0) % SITE_PALETTE.length];
};

function HomePage({ data, onSelectSite, onSelectBarn, allowedSites }) {
  return (
    <div>
      <div className="pg-title">🏠 لوحة التحكم</div>
      <div className="pg-sub">اختر موقعاً للبدء</div>
      <div className="home-grid">
        {allowedSites.map(site => {
          const sd = data?.sites?.[site.id];
          const active = site.barns.filter(b => sd?.sessions?.[b]).length;
          const theme = siteTheme(site.id);
          return (
            <div className="site-card" key={site.id} style={{ borderLeft: `5px solid ${theme.accent}` }} onClick={() => onSelectSite(site.id)}>
              <div className="site-card-body">
                <div className="site-card-title">{site.name} 🏠</div>
                <div className="site-card-sub">
                  <span className="site-card-sub-text">{site.barns.length} عنابر | {active} دورات نشطة</span>
                  <span className="site-card-chevron">›</span>
                </div>
                <div className="barn-tags">
                  {site.barns.map(b => (
                    <span key={b} className={`btag ${sd?.sessions?.[b] ? "on" : ""}`} onClick={e => { e.stopPropagation(); onSelectBarn(site.id, b); }}><span className="dot" />{b}</span>
                  ))}
                </div>
              </div>
              <div className="site-card-img" style={{ background: `repeating-linear-gradient(45deg, rgba(${hexToRgb(theme.accent)},.14) 0px, rgba(${hexToRgb(theme.accent)},.14) 5px, transparent 5px, transparent 11px), linear-gradient(135deg, ${theme.g1}, ${theme.g2})` }}>
                {theme.icon}
                <div className="emblem" style={{ color: theme.accent }}>🏭</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ========== AI ASSISTANT ==========
// بيلخص بيانات المزرعة كلها في نص مختصر يتبعت للمساعد الذكي كسياق
const buildFarmSummary = (data) => {
  const lines = [];
  SITES.forEach(site => {
    const siteData = data?.sites?.[site.id];
    if (!siteData) return;
    site.barns.forEach(barn => {
      const session = siteData.sessions?.[barn];
      if (!session || !session.active) return;
      const age = calcAge(session.startDate);
      let mort = 0, feed = 0;
      (session.dailyRecords || []).forEach(r => {
        mort += num(r.night?.mortality) + num(r.day?.mortality);
        feed += num(r.night?.feed) + num(r.day?.feed);
      });
      const birds = num(session.birdCount);
      const survivors = Math.max(birds - mort, 0);
      const mortRate = birds ? ((mort / birds) * 100).toFixed(1) : "0";
      const lastWeight = (session.weeklyWeights || []).slice(-1)[0];
      const fcr = lastWeight?.avgWeight ? calcFCR(feed, lastWeight.avgWeight, survivors) : "-";
      lines.push(`${site.name} / ${barn}: عمر ${age} يوم، عدد الطيور ${birds || "-"}، النافق ${mort} (${mortRate}%)، إجمالي العلف ${feed.toFixed(0)} كجم، آخر متوسط وزن ${lastWeight?.avgWeight || "-"} جم، FCR تقريبي ${fcr}`);
    });
    const fs = siteData.feedStore || { received: [], dispatched: [], returned: [] };
    const balance = (fs.received || []).reduce((s, r) => s + num(r.qty), 0) - (fs.dispatched || []).reduce((s, r) => s + num(r.qty), 0) - (fs.returned || []).reduce((s, r) => s + num(r.qty), 0);
    if (fs.received?.length || fs.dispatched?.length) lines.push(`رصيد مخزن العلف في ${site.name}: ${balance.toFixed(0)} كجم`);
  });
  return lines.length ? lines.join("\n") : "مفيش دفعات نشطة دلوقتي في أي موقع.";
};

function AiChatPage({ data, onBack }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "أهلاً 👋 أنا المساعد الذكي بتاع مزارع أبوشريف. اسألني عن أي رقم في المزرعة، أو اطلب مني تحليل الأداء." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const newMessages = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setSending(true);
    try {
      const r = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: newMessages.slice(0, -1).slice(-8),
          context: buildFarmSummary(data),
        }),
      });
      const j = await r.json();
      setMessages(m => [...m, { role: "assistant", content: j.reply || "معرفتش أجاوب دلوقتي، جرب تاني." }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "⚠️ في مشكلة في الاتصال، جرب تاني." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 140px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <button className="btn btn-n btn-sm" onClick={onBack}>← رجوع</button>
        <div className="pg-title" style={{ margin: 0 }}>🤖 المساعد الذكي</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-start" : "flex-end",
            maxWidth: "85%",
            background: m.role === "user" ? C.cardAlt : C.accent + "22",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 13,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}>{m.content}</div>
        ))}
        {sending && <div style={{ alignSelf: "flex-end", fontSize: 12, color: C.muted }}>بيكتب...</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          className="inp"
          style={{ flex: 1 }}
          placeholder="اسأل عن أي حاجة في المزرعة..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") send(); }}
          disabled={sending}
        />
        <button className="btn btn-p" onClick={send} disabled={sending || !input.trim()}>إرسال</button>
      </div>
    </div>
  );
}

// ========== MAIN APP ==========
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [data, setData] = useState(makeEmpty);
  const [loading, setLoading] = useState(true);
  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedBarn, setSelectedBarn] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [showMedStore, setShowMedStore] = useState(false);
  const [showGasStore, setShowGasStore] = useState(false);
  const [showInjections, setShowInjections] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [notifStatus, setNotifStatus] = useState("default");

  useEffect(() => {
    loadSaved().then(d => { if (d) setData(d); setLoading(false); }).catch(() => setLoading(false));
    registerSW();
    setNotifStatus(getNotifStatus());
    try {
      const saved = sessionStorage.getItem("current_user");
      if (saved) {
        const u = JSON.parse(saved);
        setCurrentUser(u);
        fetch(`${SUPA_URL}/rest/v1/users?id=eq.${u.id}&select=*`, { headers: SUPA_HDR })
          .then(r => r.json()).then(rows => { if (rows?.[0]) { setCurrentUser(rows[0]); try { sessionStorage.setItem("current_user", JSON.stringify(rows[0])); } catch {} } }).catch(() => {});
        if (getNotifStatus() === "granted") enablePush(u.id).then(r => setNotifStatus(r.ok ? "granted" : getNotifStatus()));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!currentUser || loading) return;
    setSyncStatus("saving");
    saveData(data).then(() => { setSyncStatus("saved"); setTimeout(() => setSyncStatus(""), 3000); }).catch(() => setSyncStatus("error"));
  }, [data]);

  const handleLogin = async (user) => {
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/users?id=eq.${user.id}&select=*`, { headers: SUPA_HDR });
      const rows = await res.json();
      const u = rows?.[0] || user;
      setCurrentUser(u);
      try { sessionStorage.setItem("current_user", JSON.stringify(u)); } catch {}
      enablePush(u.id).then(r => setNotifStatus(r.ok ? "granted" : getNotifStatus()));
    } catch { setCurrentUser(user); try { sessionStorage.setItem("current_user", JSON.stringify(user)); } catch {} }
  };

  const handleLogout = () => { setCurrentUser(null); try { sessionStorage.removeItem("current_user"); } catch {} };
  const updateData = (d) => {
    const merged = mergeData(d);
    const change = describeChange(data, merged);
    if (change) {
      const who = currentUser?.username ? `${currentUser.username} — ` : "";
      notifyAll(change.title, `${who}${change.body}`, currentUser?.id);
    }
    setData(merged);
  };

  const allowedSites = currentUser?.role === "admin" || !(currentUser?.allowed_sites?.length) ? SITES : SITES.filter(s => currentUser.allowed_sites.includes(s.id));
  const canEdit = currentUser?.role === "admin" || currentUser?.can_edit;
  const isAdmin = currentUser?.role === "admin";

  const goHome = () => { setSelectedSite(null); setSelectedBarn(null); setShowArchive(false); setShowStore(false); setShowMedStore(false); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); setSidebarOpen(false); };
  const selectSite = (id) => { setSelectedSite(id); setSelectedBarn(null); setShowArchive(false); setShowStore(false); setShowMedStore(false); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); setExpanded(e => ({ ...e, [id]: true })); setSidebarOpen(false); };
  const selectBarn = (siteId, barn) => { setSelectedSite(siteId); setSelectedBarn(barn); setShowArchive(false); setShowStore(false); setShowMedStore(false); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); setExpanded(e => ({ ...e, [siteId]: true })); setSidebarOpen(false); };
  const openStore = (siteId) => { setSelectedSite(siteId); setSelectedBarn(null); setShowArchive(false); setShowStore(true); setShowMedStore(false); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); };
  const openMedStore = (siteId) => { setSelectedSite(siteId); setSelectedBarn(null); setShowArchive(false); setShowStore(false); setShowMedStore(true); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); };
  const openGasStore = (siteId) => { setSelectedSite(siteId); setSelectedBarn(null); setShowArchive(false); setShowStore(false); setShowMedStore(false); setShowGasStore(true); setShowInjections(false); setShowSettings(false); setShowAiChat(false); };
  const openInjections = (siteId) => { setSelectedSite(siteId); setSelectedBarn(null); setShowArchive(false); setShowStore(false); setShowMedStore(false); setShowGasStore(false); setShowInjections(true); setShowSettings(false); setShowAiChat(false); };
  const openArchive = (siteId) => { setSelectedSite(siteId); setSelectedBarn(null); setShowArchive(true); setShowStore(false); setShowMedStore(false); setShowGasStore(false); setShowInjections(false); setShowSettings(false); setShowAiChat(false); };

  const deleteSite = (siteId) => {
    const d = JSON.parse(JSON.stringify(data));
    SITES.find(s => s.id === siteId)?.barns.forEach(b => { if (d.sites[siteId]) d.sites[siteId].sessions[b] = null; });
    if (d.sites[siteId]) {
      d.sites[siteId].feedStore = { received: [], dispatched: [], returned: [] };
      d.sites[siteId].medStore = { received: [], returned: [] };
      d.sites[siteId].gasStore = { received: [] };
      d.sites[siteId].injections = [];
    }
    setData(d);
  };

  const renderContent = () => {
    try {
      if (showAiChat) return <AiChatPage data={data} onBack={() => setShowAiChat(false)} />;
      if (showSettings) return <SettingsPage currentUser={currentUser} data={data} onUpdate={updateData} onDataRestore={d => setData(mergeData(d))} notifStatus={notifStatus} onEnableNotif={async () => { const r = await enablePush(currentUser.id); setNotifStatus(r.ok ? "granted" : getNotifStatus()); return r; }} onDisableNotif={async () => { await disablePush(); setNotifStatus(getNotifStatus()); }} />;
      if (showArchive && selectedSite) return <ArchivePage data={data} onUpdate={updateData} siteId={selectedSite} onBack={() => { setShowArchive(false); }} currentUser={currentUser} isAdmin={isAdmin} />;
      if (showStore && selectedSite) return <SiteStorePage siteId={selectedSite} data={data} onUpdate={canEdit ? updateData : null} isAdmin={isAdmin} currentUser={currentUser} onBack={() => setShowStore(false)} />;
      if (showMedStore && selectedSite) return <MedStorePage siteId={selectedSite} data={data} onUpdate={canEdit ? updateData : null} isAdmin={isAdmin} currentUser={currentUser} onBack={() => setShowMedStore(false)} />;
      if (showGasStore && selectedSite) return <GasStorePage siteId={selectedSite} data={data} onUpdate={canEdit ? updateData : null} isAdmin={isAdmin} currentUser={currentUser} onBack={() => setShowGasStore(false)} />;
      if (showInjections && selectedSite) return <InjectionsPage siteId={selectedSite} data={data} onUpdate={canEdit ? updateData : null} isAdmin={isAdmin} currentUser={currentUser} onBack={() => setShowInjections(false)} />;
      if (selectedSite && selectedBarn) return <BarnPage siteId={selectedSite} barnName={selectedBarn} data={data} onUpdate={updateData} canEdit={canEdit} isAdmin={isAdmin} currentUser={currentUser} onBack={() => setSelectedBarn(null)} />;
      if (selectedSite && !selectedBarn) return <SitePage siteId={selectedSite} data={data} onSelectBarn={selectBarn} onDeleteSite={isAdmin ? deleteSite : null} onBack={goHome} onOpenStore={openStore} onOpenMedStore={openMedStore} onOpenGasStore={openGasStore} onOpenInjections={openInjections} onOpenArchive={openArchive} currentUser={currentUser} />;
      return <HomePage data={data} onSelectSite={selectSite} onSelectBarn={selectBarn} allowedSites={allowedSites} />;
    } catch (e) {
      return <div className="empty"><div className="ico">⚠️</div><p>حدث خطأ</p><button className="btn btn-p" style={{ marginTop: 12 }} onClick={goHome}>🏠 الرئيسية</button></div>;
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <style>{css}</style>
      <img src="/logo.png" alt="logo" style={{ width: 150, height: 150, objectFit: "contain" }} onError={e => { e.target.style.display='none'; }} />
      <div style={{ fontSize: 23, fontWeight: 800, color: C.accent, letterSpacing: 2 }}>مزارع أبوشريف</div>
      <div style={{ fontSize: 12, color: C.muted }}>جاري التحميل...</div>
    </div>
  );

  if (!currentUser) return <Login onLogin={handleLogin} />;

  return (
    <div className="app">
      <style>{css}</style>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 200 }} />}

      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="menu-btn" onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <div className="logo">
            <img src="/logo.png" alt="logo" style={{ width: 42, height: 42, objectFit: "contain", borderRadius: 6 }} onError={e => { e.target.style.display='none'; }} />
            <div><div>مزارع أبوشريف</div><div className="logo-sub">MAZARIE ABO SHERIF</div></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {syncStatus === "saving" && <span style={{ fontSize: 11, color: C.accent }}>⏳</span>}
          {syncStatus === "saved" && <span style={{ fontSize: 11, color: C.green }}>✅</span>}
          {syncStatus === "error" && <span style={{ fontSize: 11, color: C.red }}>❌</span>}
          <button className="btn btn-n btn-sm" onClick={goHome}>🏠</button>
        </div>
      </div>

      <div className="main">
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sec-lbl">المواقع والعنابر</div>
          {allowedSites.map(site => (
            <div key={site.id}>
              <button className={`site-btn ${selectedSite === site.id && !selectedBarn && !showStore ? "active" : ""}`} onClick={() => { setExpanded(e => ({ ...e, [site.id]: !e[site.id] })); selectSite(site.id); }}>
                <span>🏭</span><span style={{ flex: 1 }}>{site.name}</span><span style={{ fontSize: 10 }}>{expanded[site.id] ? "▲" : "▼"}</span>
              </button>
              {expanded[site.id] && (
                <>
                  {site.barns.map(barn => (
                    <button key={barn} className={`barn-btn ${selectedSite === site.id && selectedBarn === barn ? "active" : ""}`} onClick={() => selectBarn(site.id, barn)}>
                      <span className={`dot ${data?.sites?.[site.id]?.sessions?.[barn] ? "on" : ""}`} />{barn}
                    </button>
                  ))}
                </>
              )}
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 10, paddingTop: 6 }}>
            <div className="sec-lbl">👤 {currentUser?.username} — {currentUser?.role === "admin" ? "مدير" : currentUser?.can_edit ? "محرر" : "مشاهد"}</div>
            <button className={`barn-btn ${showAiChat ? "active" : ""}`} onClick={() => { setShowAiChat(true); setShowSettings(false); setShowArchive(false); setSelectedBarn(null); setShowStore(false); setSidebarOpen(false); }}>
              <span className="dot" style={{ background: C.accent }} />🤖 المساعد الذكي
            </button>
            <button className={`barn-btn ${showSettings ? "active" : ""}`} onClick={() => { setShowSettings(true); setShowAiChat(false); setShowArchive(false); setSelectedBarn(null); setShowStore(false); setSidebarOpen(false); }}>
              <span className="dot" style={{ background: C.purple }} />⚙️ الإعدادات
            </button>
            <button className="barn-btn" onClick={handleLogout}>
              <span className="dot" style={{ background: C.red }} />🔒 تسجيل الخروج
            </button>
          </div>
        </div>
        <div className="content">{renderContent()}</div>
      </div>
    </div>
  );
}
