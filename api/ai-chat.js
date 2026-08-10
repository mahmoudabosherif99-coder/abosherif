// المساعد الذكي — بيرد على أسئلة عن بيانات المزرعة وبيدي تحذيرات وتوصيات
// محتاج مفتاح ANTHROPIC_API_KEY متضاف في Vercel → Settings → Environment Variables

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      reply: "⚠️ المساعد الذكي لسه مش شغال. لازم تضيف مفتاح ANTHROPIC_API_KEY من إعدادات المشروع على Vercel (Settings → Environment Variables) بعدين تعمل Redeploy.",
    });
    return;
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  payload = payload || {};

  const message = (payload.message || "").toString().slice(0, 2000);
  const context = (payload.context || "").toString().slice(0, 6000);
  const history = Array.isArray(payload.history) ? payload.history.slice(-10) : [];

  if (!message.trim()) { res.status(400).json({ error: "message required" }); return; }

  const systemPrompt = `انت "المساعد الذكي" جوا برنامج إدارة مزارع الدواجن بتاع "مزارع أبوشريف". بترد بالعربي المصري العامي، بأسلوب مختصر وعملي ومباشر زي ما بيتكلم مدير مزرعة خبير.
مهمتك:
- تجاوب على أسئلة المستخدم عن بيانات المزرعة (النافق، العلف، الـ FCR، المخازن، أعمار الدفعات) بالاعتماد على البيانات اللي هتوصلك تحت.
- لو لاحظت رقم غريب أو خطر (معدل نافق مرتفع، FCR سيء، مخزون علف قرّب يخلص) نبّه عليه حتى لو مالوش علاقة مباشرة بالسؤال.
- لو البيانات ناقصة أو مش موجودة قول كده بصراحة، متخترعش أرقام.
- خلي الردود قصيرة (مايتعديش كام سطر) إلا لو المستخدم طلب تفصيل أكتر.

بيانات المزرعة الحالية:
${context || "(مفيش بيانات متاحة دلوقتي)"}`;

  const messages = [
    ...history.filter(h => h && (h.role === "user" || h.role === "assistant") && h.content).map(h => ({ role: h.role, content: String(h.content).slice(0, 2000) })),
    { role: "user", content: message },
  ];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
    });

    const json = await r.json();

    if (!r.ok) {
      const errMsg = json?.error?.message || "خطأ غير معروف";
      res.status(200).json({ reply: `⚠️ حصل خطأ من خدمة الذكاء الاصطناعي: ${errMsg}` });
      return;
    }

    const reply = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim() || "معرفتش أجاوب على السؤال ده.";
    res.status(200).json({ reply });
  } catch (err) {
    res.status(200).json({ reply: "⚠️ مقدرتش أوصل لخدمة الذكاء الاصطناعي دلوقتي، جرب تاني بعد شوية." });
  }
}
