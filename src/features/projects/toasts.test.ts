// R-152 (X-9 = yes, L-1): confirmation toasts of the register and the resource-request dialog — EN / FR, typed names as typed.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { requestSentText } from '@/features/requests/i18n';
import { forcedMoveToastText, projectCreatedToastText } from './toasts';

const EN = makeT('en');
const FR = makeT('fr');

describe('R-152 — confirmation toasts', () => {
  it('forced stage change: validation requested from the portfolio director (L-1)', () => {
    expect(forcedMoveToastText('WSA-044', EN)).toBe('WSA-044 · Validation requested from the portfolio director');
    expect(forcedMoveToastText('WSA-044', FR)).toBe('WSA-044 · Validation demandée au directeur de portefeuille');
  });

  it('project created: the typed name stays as typed in both languages (R-148)', () => {
    expect(projectCreatedToastText('#052', 'Sun Valley Farm', EN, 'en')).toBe('#052 · Sun Valley Farm · Project created');
    expect(projectCreatedToastText('#052', 'Sun Valley Farm', FR, 'fr')).toBe('#052 · Sun Valley Farm · Projet créé');
    expect(projectCreatedToastText('#053', 'Mon équipe — Oct', FR, 'fr')).toBe('#053 · Mon équipe — Oct · Projet créé');
  });

  it('request sent: "Request RQ-045 sent" / "Demande RQ-045 envoyée" (the owner\'s example)', () => {
    expect(requestSentText('RQ-045', 'en')).toBe('Request RQ-045 sent');
    expect(requestSentText('RQ-045', 'fr')).toBe('Demande RQ-045 envoyée');
  });
});
