import { htmlToText } from "./chat.ts";
import { type CaptureDeps, type CaptureResult, createCapture } from "./capture.ts";

// STACK:inbound_email — provider-agnostic. The provider's webhook posts one JSON document per mail; we accept
// Postmark, CloudMailin, Resend/SendGrid-style and a plain generic shape, normalise to InboundEmail, and file it
// as a `newsletter` document in the namespace named by the recipient's plus-tag (news+robotics@…) or the default.

export type InboundEmail = { from: string; to: string[]; subject: string; text: string; html: string; message_id: string; date: string | null };

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const addr = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return s(o.Email ?? o.email ?? o.address ?? o.value ?? o.Address);
  }
  return "";
};
const addrs = (v: unknown): string[] => (Array.isArray(v) ? v.map(addr) : s(v) ? s(v).split(",").map((x) => x.trim()) : v ? [addr(v)] : []).filter(Boolean);

/** Normalise whichever webhook shape arrived. Returns null if it doesn't look like an email at all. */
export function normalizeInboundEmail(body: unknown): InboundEmail | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  // Postmark inbound
  if ("TextBody" in b || "HtmlBody" in b || "FromFull" in b) {
    const toFull = Array.isArray(b.ToFull) ? (b.ToFull as Array<Record<string, unknown>>) : [];
    return {
      from: addr(b.FromFull) || s(b.From),
      to: [...toFull.map((t) => s(t.Email)), ...addrs(b.To)].filter(Boolean),
      subject: s(b.Subject),
      text: s(b.TextBody),
      html: s(b.HtmlBody),
      message_id: s(b.MessageID),
      date: s(b.Date) || null,
    };
  }
  // CloudMailin (json format)
  if (b.envelope && typeof b.envelope === "object" && ("plain" in b || "html" in b)) {
    const env = b.envelope as Record<string, unknown>;
    const headers = (b.headers ?? {}) as Record<string, unknown>;
    return { from: s(env.from), to: addrs(env.to ?? env.recipients), subject: s(headers.subject ?? headers.Subject), text: s(b.plain), html: s(b.html), message_id: s(headers.message_id ?? headers["Message-ID"]), date: s(headers.date ?? headers.Date) || null };
  }
  // Generic / Resend-like: { from, to, subject, text?, html? }
  if ("subject" in b || "text" in b || "html" in b) {
    return { from: addr(b.from), to: addrs(b.to), subject: s(b.subject), text: s(b.text ?? b.plain ?? b.body), html: s(b.html), message_id: s(b.message_id ?? b.messageId ?? b.id), date: s(b.date) || null };
  }
  return null;
}

/** `anything+<namespace>@host` → namespace; the first recipient with a plus-tag wins. */
export function namespaceFromRecipients(to: string[]): string | null {
  for (const t of to) {
    const m = t.toLowerCase().match(/^[^<\s]*?\+([a-z0-9][a-z0-9-_]*)@/) ?? t.toLowerCase().match(/<[^+>]*\+([a-z0-9][a-z0-9-_]*)@/);
    if (m) return m[1]!;
  }
  return null;
}

export async function captureEmail(deps: CaptureDeps, mail: InboundEmail, opts: { defaultNamespace?: string }): Promise<CaptureResult> {
  const namespace = namespaceFromRecipients(mail.to) ?? opts.defaultNamespace;
  if (!namespace) throw new Error("no namespace: address the mail to <anything>+<namespace>@… or set INBOUND_EMAIL_NAMESPACE");
  const text = (mail.text.trim() || htmlToText(mail.html)).trim();
  if (text.length < 40) throw new Error("the email has no readable text");
  const id = mail.message_id.replace(/^<|>$/g, "");
  return createCapture(deps, {
    namespace,
    text,
    title: mail.subject || undefined,
    author: mail.from || undefined,
    source_type: "newsletter",
    published_at: mail.date && !Number.isNaN(new Date(mail.date).getTime()) ? new Date(mail.date).toISOString() : null,
    // A stable id per message keeps redeliveries idempotent; fall back to the content hash.
    ...(id ? { url: `marrow:email:${id}` } : {}),
  });
}
