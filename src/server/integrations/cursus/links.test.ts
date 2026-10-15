// Links from Keystone to Cursus (R-032, NEW-CURSUS-3 'a'): the `chantier` and `matricule` parameters are proposals Cursus
// ignores today (C-1) — the URLs are built in one place so a renamed parameter changes one line.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURSUS_LINK_ATTRS, cursusChantierUrl, cursusClearancesUrl, cursusEmployeeUrl, cursusTravelUrl } from './links';

afterEach(() => vi.unstubAllEnvs());

describe('Cursus links', () => {
  it('an employee by matricule (NEW-CURSUS-3 a): /collaborateurs?matricule=…, encoded; none without a matricule', () => {
    expect(cursusEmployeeUrl('EMP-0018')).toBe('http://localhost:5173/collaborateurs?matricule=EMP-0018');
    expect(cursusEmployeeUrl(' EMP 18/b ')).toBe('http://localhost:5173/collaborateurs?matricule=EMP+18%2Fb');
    expect([cursusEmployeeUrl(null), cursusEmployeeUrl(undefined), cursusEmployeeUrl(''), cursusEmployeeUrl('  ')]).toEqual([null, null, null, null]);
  });

  it('follows NEXT_PUBLIC_CURSUS_URL (trailing slash dropped), like the site and list links', () => {
    vi.stubEnv('NEXT_PUBLIC_CURSUS_URL', 'https://cursus.epc2i.fr/');
    expect(cursusEmployeeUrl('EMP-0006')).toBe('https://cursus.epc2i.fr/collaborateurs?matricule=EMP-0006');
    expect(cursusChantierUrl('K-2614')).toBe('https://cursus.epc2i.fr/chantiers?chantier=K-2614');
    expect(cursusChantierUrl(null)).toBe('https://cursus.epc2i.fr/chantiers');
    expect([cursusClearancesUrl(), cursusTravelUrl()]).toEqual(['https://cursus.epc2i.fr/habilitations', 'https://cursus.epc2i.fr/voyages']);
  });

  it('opens outside Keystone', () => {
    expect(CURSUS_LINK_ATTRS).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
