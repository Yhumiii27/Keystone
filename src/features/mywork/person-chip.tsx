'use client';
// Person chip of My work (docs/spec/10 §6.4 a, template 2816–2820): avatar, name, "{role} · {projects}". For the
// roles that may look at someone else's work (permissions.ts) it opens a person switcher (`?person=`) — the
// prototype's caret had no handler (10 OQ17); for the others it is a plain chip without the caret.
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
import { Avatar } from '@/components/app/Badges';
import { MenuHeader, MenuItem } from '@/components/ds/Menu';
import { Popover } from '@/components/ds/Popover';
import { cx } from '@/components/ds/cx';
import s from './mywork.module.css';

export interface PersonChipProps {
  name: string;
  initials: string;
  /** Translated "{role} · {projects}". */
  sub: string;
  /** Switcher entries (translated job titles); omitted = static chip. */
  options?: { name: string; jobTitle: string; href: string }[];
  /** Translated menu header. */
  menuTitle?: string;
}

export function PersonChip({ name, initials, sub, options, menuTitle }: PersonChipProps) {
  const body = (
    <>
      <Avatar initials={initials} name={name} size={30} tone="accent" />
      <span className={s.chipText}>
        <span className={s.chipName}>{name}</span>
        <span className={s.chipSub}>{sub}</span>
      </span>
    </>
  );
  if (!options?.length) return <div className={s.chip}>{body}</div>;
  return (
    <Popover
      trigger={
        <>
          {body}
          <CaretDown className={s.caret} aria-hidden />
        </>
      }
      triggerClassName={cx(s.chip, s.chipButton)}
      minWidth="260px"
      maxHeight="min(420px, 70vh)"
      zIndex={30}
    >
      {menuTitle && <MenuHeader>{menuTitle}</MenuHeader>}
      {options.map((o) => (
        <MenuItem key={o.name} href={o.href} selected={o.name === name} size={12.5}>
          {o.name}
          <span className={s.pickerMeta}>{o.jobTitle}</span>
        </MenuItem>
      ))}
    </Popover>
  );
}
