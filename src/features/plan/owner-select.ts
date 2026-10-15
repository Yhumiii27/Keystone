// R-172: options of the Plan's Owner select (Structure view). The OWN directory lists the persons who hold an owner key
// (persons.owner_code); an activity owned by someone else — the wizard's default PM "S. Perrin", keyed by initials that are
// not unique — or by nobody (MS Project / P6 imports, production "Add activity") must not silently show the first OWN entry:
// its current owner (or '—') comes first under a value that is never saved. Pure, shared by the client table and its tests.

/** Value of the first option when the row's owner is outside the OWN list or missing; choosing it changes nothing. */
export const CURRENT_OWNER = '~current';

export interface OwnerOption {
  value: string;
  label: string;
}

/** The select's value and options for an activity row (`ownerIsCode`: `owner` is an OWN key; `ownerName`: its display name). */
export function ownerSelectOptions(
  r: { owner: string | null; ownerName: string; ownerIsCode: boolean },
  owners: readonly OwnerOption[],
): { value: string; options: OwnerOption[] } {
  if (r.ownerIsCode && r.owner) return { value: r.owner, options: [...owners] };
  return { value: CURRENT_OWNER, options: [{ value: CURRENT_OWNER, label: r.owner ? r.ownerName : '—' }, ...owners] };
}
