// R-199 / R-036 — the MIME message (headers encoded, base64 bodies, attachments) and the file transport (.eml files, the none
// transport sends nothing).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addressHeader, buildMime, encodeHeader, fromHeader, mailDate } from './mime';
import { emlFileName, fileTransport, mailTransport } from './transport';

/** The decoded parts of a message: headers of the whole message, and each part's headers and decoded body. */
function parse(raw: string) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const headers = head.split(/\r\n(?! )/);
  const body = rest.join('\r\n\r\n');
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1];
  const parts = boundary
    ? body.split(`--${boundary}`).slice(1, -1).map((p) => {
      const [h, ...b] = p.replace(/^\r\n/, '').split('\r\n\r\n');
      return { headers: h, body: Buffer.from(b.join('').replace(/\r\n/g, ''), 'base64') };
    })
    : [{ headers: head, body: Buffer.from(body.replace(/\r\n/g, ''), 'base64') }];
  return { headers, parts };
}

const decodeWords = (v: string) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

describe('MIME message', () => {
  it('ASCII headers as is; UTF-8 headers as encoded words that never split a character', () => {
    expect(encodeHeader('Keystone — rappel')).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeader('Plain subject')).toBe('Plain subject');
    const long = 'Échéances à venir — HLT-026 · T-2314 · Réception de la grue portuaire n°2 et essais de charge';
    expect(decodeWords(encodeHeader(long).replace(/\r\n /g, ''))).toBe(long);
    expect(encodeHeader(long).split('\r\n ').every((w) => w.length <= 75)).toBe(true);
    expect(addressHeader('a@b.fr', 'Amélie Ollivier')).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.fr>$/);
    expect([addressHeader('a@b.fr', 'R. "Bob" Aubert'), addressHeader('a@b.fr', null)]).toEqual(['"R. Bob Aubert" <a@b.fr>', '<a@b.fr>']);
    expect([fromHeader('Keystone <ks@epc2i.fr>'), fromHeader('ks@epc2i.fr')]).toEqual(['"Keystone" <ks@epc2i.fr>', '<ks@epc2i.fr>']);
    expect(mailDate(new Date('2026-09-28T05:00:00Z'))).toBe('Mon, 28 Sep 2026 05:00:00 +0000');
  });

  it('a text message: one UTF-8 part, CRLF line ends, auto-generated', () => {
    const raw = buildMime({ from: 'Keystone <ks@epc2i.fr>', to: 'a@b.fr', toName: 'A. B', subject: 'Rappel', text: 'Bonjour,\nÉchéance 2 oct.' }, {
      date: new Date('2026-09-28T05:00:00Z'), messageId: 'm1@epc2i.fr', boundary: 'B',
    });
    const m = parse(raw);
    expect(m.headers).toEqual([
      'From: "Keystone" <ks@epc2i.fr>', 'To: "A. B" <a@b.fr>', 'Subject: Rappel', 'Date: Mon, 28 Sep 2026 05:00:00 +0000', 'Message-ID: <m1@epc2i.fr>', 'MIME-Version: 1.0',
      'Auto-Submitted: auto-generated', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64',
    ]);
    expect(m.parts[0].body.toString('utf8')).toBe('Bonjour,\r\nÉchéance 2 oct.');
  });

  it('attachments: multipart/mixed, the text first, each file in base64 with its name', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    const raw = buildMime({ from: 'ks@epc2i.fr', to: 'a@b.fr', subject: 'R', text: 'Ci-joint', attachments: [{ fileName: 'status-report-HLT-026.pdf', mime: 'application/pdf', body: pdf }] }, {
      date: new Date(0), messageId: 'm2@x', boundary: 'ks-b',
    });
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="ks-b"');
    const m = parse(raw);
    expect(m.parts.map((p) => p.body.toString('utf8'))).toEqual(['Ci-joint', '%PDF-1.7 test']);
    expect(m.parts[1].headers).toContain('Content-Disposition: attachment; filename="status-report-HLT-026.pdf"');
    expect(raw.endsWith('--ks-b--\r\n')).toBe(true);
  });
});

describe('transports', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('none (default): nothing is sent', async () => {
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', '');
    const t = mailTransport();
    expect(t.mode).toBe('none');
    expect(await t.send({ to: 'a@b.fr', subject: 's', text: 't' })).toEqual({ status: 'no_transport' });
  });

  it('file: one .eml per message in the folder, named by time and recipient', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-mail-'));
    vi.stubEnv('KEYSTONE_MAIL_TRANSPORT', 'file');
    vi.stubEnv('KEYSTONE_MAIL_DIR', dir);
    vi.stubEnv('KEYSTONE_MAIL_FROM', 'Keystone <keystone@epc2i.fr>');
    const t = mailTransport();
    expect(t.mode).toBe('file');
    const r = await t.send({ to: 'Amelie.Ollivier@epc2i.fr', toName: 'Amélie Ollivier', subject: 'Échéances', text: 'Bonjour' });
    expect(r.status).toBe('sent');
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}-amelie-ollivier-epc2i-fr\.eml$/);
    const raw = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    expect(raw).toContain('From: "Keystone" <keystone@epc2i.fr>');
    expect(decodeWords(/Subject: (.+)/.exec(raw)![1])).toBe('Échéances');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('file: a folder that cannot be written is a failure, never a throw', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-mail-')), 'not-a-dir');
    fs.writeFileSync(file, 'x');
    expect((await fileTransport(file, 'ks@x.fr').send({ to: 'a@b.fr', subject: 's', text: 't' })).status).toBe('failed');
    expect(emlFileName(new Date('2026-09-28T05:00:00.123Z'), '', 'abcd1234')).toBe('20260928T050000Z-abcd1234-recipient.eml');
  });
});
