const webpush = require("web-push");

const SUPA_URL = "https://devxozrfoxvypllmhijj.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRldnhvenJmb3h2eXBsbG1oaWpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTA1NzgsImV4cCI6MjA5Njc4NjU3OH0.JnYQyOnYf501SjkNtMBp1GGyLhtQQ8gAY6ElXnjrVRk";

// مفاتيح VAPID الخاصة بمشروع "مزارع أبوشريف" — نفس المفتاح العام الموجود في src/App.jsx
const VAPID_PUBLIC = "BK_kuuSTp45LjleDMwIHkmTemFEZ9J5HeTPppAVHwQSKOklGMyyJGea0St4gelaPdxnFy5QwcRm6wIwtN2h9Jzg";
const VAPID_PRIVATE = "j3yJvxMpNm3-s6raq0J7aBb2nK0UVwqYz_-HWnsV2d0";

webpush.setVapidDetails("mailto:admin@abosherif-farms.com", VAPID_PUBLIC, VAPID_PRIVATE);

const supaHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" };

// نسخة Vercel من فانكشن الإشعارات (بديل لـ netlify/functions/send-push.js)
// Vercel بيشغّل أي ملف داخل /api تلقائي كـ Serverless Function بصيغة (req, res)
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  payload = payload || {};

  const title = (payload.title || "🔔 مزارع أبوشريف").slice(0, 120);
  const body = (payload.body || "").slice(0, 200);
  const excludeUserId = payload.excludeUserId || null;

  let subs = [];
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/push_subscriptions?select=*`, { headers: supaHeaders });
    subs = await r.json();
    if (!Array.isArray(subs)) subs = [];
  } catch {
    subs = [];
  }

  if (excludeUserId) subs = subs.filter((s) => s.user_id !== excludeUserId);

  const notifPayload = JSON.stringify({ title, body });

  const results = await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notifPayload);
      } catch (err) {
        // الاشتراك بقى ميت (المستخدم شال الصلاحية أو مسح البرنامج) — نمسحه من القاعدة
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          try {
            await fetch(`${SUPA_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: supaHeaders });
          } catch {}
        }
        throw err;
      }
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - sent;

  res.status(200).json({ total: subs.length, sent, failed });
};
