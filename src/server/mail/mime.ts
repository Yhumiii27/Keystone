// R-199 / R-036 — one e-mail as an RFC 5322 / MIME message (what the file transport writes as an .eml file, and what an SMTP
// relay or Microsoft Graph's sendMail with MIME content will take when IT provides them). Pure: no I/O, no clock (the date and
// the message id are given). UTF-8 throughout: encoded-word headers (RFC 2047), base64 bodies wrapped at 76 characters.

export interface MailAttachment {
  /** "status-report-HLT-026-2026-09-28.pdf" (ASCII, as the export file names are). */
  fileName: string;
  mime: string;
  body: Uint8Array;
}

export interface MailMessage {
  /** "Keystone <keystone@epc2i.fr>". */
  from: string;
  /** Recipient address (one per message: reminders and reports are personal). */
  to: string;
  /** The recipient's name, shown in the To header. */
  toName?: string | null;
  subject: string;
  /** Plain-text body (\n line ends). */
  text: string;
  attachments?: MailAttachment[];
}

const CRLF = '\r\n';

/** Base64 of bytes, wrapped at 76 characters. */
export function base64Lines(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return (b64.match(/.{1,76}/g) ?? ['']).join(CRLF);
}

/** A header value: as is when printable ASCII, else RFC 2047 encoded words (UTF-8, base64), each under 75 characters. */
export function encodeHeader(v: string): string {
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const words: string[] = [];
  let chunk = '';
  // Encode by whole characters so a multi-byte character is never split across two words.
  for (const ch of v) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

/** "Name <address>" with the name encoded when needed (quotes and specials are removed from a display name). */
export function addressHeader(address: string, name?: string | null): string {
  const clean = (name ?? '').replace(/["<>\\\r\n]/g, '').trim();
  if (!clean) return `<${address}>`;
  return /^[\x20-\x7e]*$/.test(clean) ? `"${clean}" <${address}>` : `${encodeHeader(clean)} <${address}>`;
}

/** "Keystone <keystone@epc2i.fr>" / "keystone@epc2i.fr" → the From header. */
export function fromHeader(from: string): string {
  const m = /^(.*)<([^<>]+)>\s*$/.exec(from.trim());
  return m ? addressHeader(m[2].trim(), m[1]) : `<${from.trim()}>`;
}

/** RFC 5322 date ("Mon, 28 Sep 2026 05:00:00 +0000"). */
export const mailDate = (d: Date) => d.toUTCString().replace(/GMT$/, '+0000');

/**
 * The full message. `boundary` and `messageId` are given (the transport draws them), so a test gets the same bytes every time.
 * Without attachments: a single text/plain part; with attachments: multipart/mixed.
 */
export function buildMime(m: MailMessage, opts: { date: Date; messageId: string; boundary: string }): string {
  const head = [
    `From: ${fromHeader(m.from)}`,
    `To: ${addressHeader(m.to, m.toName)}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${mailDate(opts.date)}`,
    `Message-ID: <${opts.messageId}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ];
  const text = base64Lines(new TextEncoder().encode(m.text.replace(/\r?\n/g, CRLF)));
  const textHeaders = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64'];
  if (!m.attachments?.length) return [...head, ...textHeaders, '', text, ''].join(CRLF);
  const b = opts.boundary;
  const parts = [
    [`--${b}`, ...textHeaders, '', text].join(CRLF),
    ...m.attachments.map((a) => {
      const name = a.fileName.replace(/["\\\r\n]/g, '');
      return [`--${b}`, `Content-Type: ${a.mime}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', base64Lines(a.body)].join(CRLF);
    }),
  ];
  return [...head, `Content-Type: multipart/mixed; boundary="${b}"`, '', ...parts, `--${b}--`, ''].join(CRLF);
}
