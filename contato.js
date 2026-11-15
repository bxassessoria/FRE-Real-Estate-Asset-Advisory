// Função da Vercel que recebe o formulário do site e envia o contato por e-mail (Resend).
// A Vercel executa automaticamente qualquer arquivo dentro da pasta /api.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY   obrigatória: chave da conta no Resend (resend.com)
//   LEAD_TO_EMAIL    opcional: quem recebe (padrão: contato@freadvisory.com.br)
//   LEAD_FROM_EMAIL  opcional: remetente. Até verificar o domínio no Resend, deixe vazio
//                    (usa onboarding@resend.dev, que só entrega para o e-mail dono da conta).

const RESEND_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";
const DESTINO = "contato@freadvisory.com.br";

const ORIGENS = {
  "painel-lateral": "Painel lateral “Fale com a FRE”",
  "secao-contato": "Seção de contato no fim da página",
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatPhone(d) {
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function montarEmail(lead) {
  const quando = lead.recebidoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const tel = formatPhone(lead.whatsapp);
  const wa = `https://wa.me/55${lead.whatsapp}`;
  const origem = ORIGENS[lead.origem] || lead.origem || "Site";
  const linhas = [
    ["Nome", escapeHtml(lead.nome)],
    ["E-mail", `<a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>`],
    ["WhatsApp", `<a href="${wa}">${tel}</a>`],
    ["Origem", escapeHtml(origem)],
    ["Recebido em", `${quando} (horário de Brasília)`],
  ];
  const html = `<div style="font-family:Arial,sans-serif;color:#13283d;max-width:560px">
  <p style="font-size:18px;margin:0 0 16px">Novo contato pelo site da FRE</p>
  <table cellpadding="8" style="border-collapse:collapse;width:100%;font-size:15px">
    ${linhas.map(([k, v]) => `<tr><td style="border-bottom:1px solid #e6e8e3;color:#56646e;width:130px">${k}</td><td style="border-bottom:1px solid #e6e8e3">${v}</td></tr>`).join("")}
  </table>
  <p style="font-size:13px;color:#56646e;margin-top:16px">Responda este e-mail para escrever direto para o cliente, ou toque no número para abrir o WhatsApp.</p>
</div>`;
  const text = [
    "Novo contato pelo site da FRE", "",
    `Nome: ${lead.nome}`, `E-mail: ${lead.email}`, `WhatsApp: ${tel} (${wa})`,
    `Origem: ${origem}`, `Recebido em: ${quando} (horário de Brasília)`,
  ].join("\n");
  return { subject: `Novo contato pelo site: ${lead.nome}`, html, text };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: "invalid_json" }); }
  }
  body = body || {};

  // Campo-armadilha: pessoas não veem este campo; robôs costumam preenchê-lo.
  if (typeof body.empresa === "string" && body.empresa.trim() !== "") return res.status(200).json({ ok: true });

  const nome = String(body.nome || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 160);
  const whatsapp = String(body.whatsapp || "").replace(/\D/g, "").slice(0, 11);
  const origem = String(body.origem || "").slice(0, 40);
  if (nome.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || whatsapp.length < 10) {
    return res.status(422).json({ ok: false, error: "invalid_fields" });
  }

  const lead = { nome, email, whatsapp, origem, recebidoEm: new Date() };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[contato] RESEND_API_KEY não configurada. Contato:", lead);
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  try {
    const { subject, html, text } = montarEmail(lead);
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.LEAD_FROM_EMAIL || "FRE Site <onboarding@resend.dev>",
        to: [process.env.LEAD_TO_EMAIL || DESTINO],
        reply_to: lead.email,
        subject, html, text,
      }),
    });
    if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[contato] falha ao enviar:", err, lead);
    return res.status(502).json({ ok: false, error: "send_failed" });
  }
};
