// Chapter 4 defaults that are not read by a single module: they must stay consistent with the module that applies them.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG } from '@/i18n/translate';
import { BUILTIN_CALENDARS } from './calendar';
import { CONNECTOR_SETTINGS_BY_IT, DEFAULT_HOLIDAY_SET, IMPORTS_ENABLED, PDF_DEFAULT_LANG } from './ch4-defaults';

describe('chapter 4 defaults', () => {
  it('PDFs default to the session default language (French)', () => {
    expect(PDF_DEFAULT_LANG).toBe(DEFAULT_LANG);
    expect(PDF_DEFAULT_LANG).toBe('fr');
  });

  it('the built-in calendars use the default holiday set, except Continu 24h / 7d (S-2)', () => {
    expect(DEFAULT_HOLIDAY_SET).toBe('FR');
    expect(BUILTIN_CALENDARS.map((c) => c.holidaySet)).toEqual([DEFAULT_HOLIDAY_SET, DEFAULT_HOLIDAY_SET, DEFAULT_HOLIDAY_SET, null]);
  });

  it('D-7b: imports are off; D-7a: connectors are configured by IT outside Keystone', () => {
    expect(IMPORTS_ENABLED).toBe(false);
    expect(CONNECTOR_SETTINGS_BY_IT).toBe(true);
  });
});
