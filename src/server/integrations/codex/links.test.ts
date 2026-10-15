// Links from Keystone to Codex (Delivery 8, R-033; D-1 open): Codex's home with parameters Codex ignores today
// (TODO(codex)), Codex's own link of a record once the index read brought it, and only http(s) links ever rendered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODEX_LINK_ATTRS, codexDocumentUrl, codexHomeUrl, codexSelectionUrl, codexTypeRegisterUrl, safeCodexUrl } from './links';

afterEach(() => vi.unstubAllEnvs());

describe('Codex links', () => {
  it('Codex home, record, register and selection on the default local address', () => {
    expect(codexHomeUrl()).toBe('http://localhost:3100/');
    expect(codexHomeUrl('HLT-026')).toBe('http://localhost:3100/?project=HLT-026');
    // A company quality document has no project parameter.
    expect(codexHomeUrl('QMS')).toBe('http://localhost:3100/');
    expect(codexDocumentUrl('PID-HLT-026', 'D')).toBe('http://localhost:3100/?document=PID-HLT-026&revision=D');
    expect(codexDocumentUrl('PID-HLT-026')).toBe('http://localhost:3100/?document=PID-HLT-026');
    expect(codexTypeRegisterUrl()).toBe('http://localhost:3100/?view=document-types');
    expect(codexSelectionUrl(['PID-HLT-026', 'GA-HLT-026', 'PID-HLT-026'])).toBe('http://localhost:3100/?documents=PID-HLT-026%2CGA-HLT-026');
    expect(codexSelectionUrl([])).toBe('http://localhost:3100/');
    expect(CODEX_LINK_ATTRS).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });

  it('follows NEXT_PUBLIC_CODEX_URL (trailing slashes trimmed) and encodes the parameters', () => {
    vi.stubEnv('NEXT_PUBLIC_CODEX_URL', 'https://codex.epc2i.fr//');
    expect(codexHomeUrl('HLT 026')).toBe('https://codex.epc2i.fr/?project=HLT+026');
    expect(codexDocumentUrl('A&B', 'C')).toBe('https://codex.epc2i.fr/?document=A%26B&revision=C');
  });

  it('Codex’s own link of a record wins over the guess — http(s) only, never a script or a relative path', () => {
    expect(codexDocumentUrl('PID-HLT-026', 'D', 'https://codex.epc2i.fr/doc/123')).toBe('https://codex.epc2i.fr/doc/123');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/doc/123', 'ftp://codex/x', 'not a url', '', null, undefined])
      expect(codexDocumentUrl('PID-HLT-026', 'D', bad), String(bad)).toBe('http://localhost:3100/?document=PID-HLT-026&revision=D');
    expect([safeCodexUrl(' http://codex/x '), safeCodexUrl('JAVASCRIPT:x')]).toEqual(['http://codex/x', null]);
  });
});
