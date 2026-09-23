// إرسال رسالة واتساب تلقائي عن طريق WhatsApp Business Cloud API (Meta)
// محتاج تضيف المتغيرات دي في Vercel → Settings → Environment Variables:
// WHATSAPP_TOKEN            = التوكن الدائم (Permanent Access Token) من Meta
// WHATSAPP_PHONE_NUMBER_ID  = رقم الهاتف بتاع الإرسال (Phone Number ID) من Meta
// WHATSAPP_TO               = رقم الشخص أو الصفحة اللي هتستقبل الرسائل (بصيغة دولية بدون + مثلا 201234567890)
// WHATSAPP_TEMPLATE_NAME    = اسم القالب (Template) المعتمد من Meta لإرسال الرسائل خارج نافذة الـ 24 ساعة

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = process.env.WHATSAPP_TO;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  if (!token || !phoneId || !to) {
    res.status(200).json({ ok: false, error: "متغيرات واتساب لسه مش متضافة (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TO)" });
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  payload = payload || {};
  const bodyText = (payload.message || "").toString().slice(0, 1000);
  if (!bodyText.trim()) { res.status(400).json({ error: "message required" }); return; }

  try {
    // لو فيه اسم قالب معتمد، نبعت من خلاله (يشتغل في أي وقت حتى لو مفيش تفاعل من المستلم خلال آخر 24 ساعة)
    // القالب المفروض يكون فيه متغير واحد {{1}} بياخد النص الكامل
    const body = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: { name: templateName, language: { code: "ar" }, components: [{ type: "body", parameters: [{ type: "text", text: bodyText }] }] },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: bodyText },
        };

    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    if (!r.ok) {
      res.status(200).json({ ok: false, error: json?.error?.message || "فشل الإرسال" });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: false, error: "تعذر الوصول لخدمة واتساب" });
  }
}
