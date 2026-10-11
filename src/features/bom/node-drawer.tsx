'use client';
// Assembly-tree node drawer (template 1233–1243; `nodeVals` 4242–4247), opened with `?node=<ref>`: identification,
// costed roll-up (E-2a: ordered, else last purchase, else catalogue price) against the list price, the paths that use the node, and three actions —
// "Part record" (part drawer over the flat list), "Drawings" (PDM vault searched on the reference) and "Raise ECO",
// which opens Vigie's new-ECO form prefilled with the part and the project (Vigie owns the ECOs; it opens outside
// Keystone, so it ends with the "opens outside" arrow like every Vigie link).
import { ArrowSquareOut, Blueprint, Cube, GitBranch } from '@phosphor-icons/react/dist/ssr';
import { KeyValueList } from '@/components/app/KeyValueList';
import { Eyebrow } from '@/components/app/Eyebrow';
import { ButtonLink } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import type { NodeDrawerView } from './model';
import s from './bom.module.css';

export function NodeDrawer({ view }: { view: NodeDrawerView }) {
  return (
    <Drawer open closeHref={view.closeHref} id={view.ref} title={view.name} meta={<span className={view.status.cls}>{view.status.label}</span>}>
      <KeyValueList title={view.identTitle} items={view.ident.map((x) => ({ k: x.k, v: x.v, color: x.color, id: x.k }))} />
      <KeyValueList title={view.costTitle} items={view.cost.map((x) => ({ k: x.k, v: x.v, color: x.color, id: x.k }))} />
      <div className={s.section}>
        <Eyebrow>{view.usedInTitle}</Eyebrow>
        {view.parents.map((p, i) => (
          <span key={`${i}-${p}`} className={s.parent}>
            {p}
          </span>
        ))}
      </div>
      <div className={s.buttons}>
        <ButtonLink variant="secondary" size="sm" icon={Cube} href={view.partHref} scroll={false}>
          {view.partLabel}
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" icon={Blueprint} href={view.drawingsHref}>
          {view.drawingsLabel}
        </ButtonLink>
        {view.raiseEco && (
          <ButtonLink
            variant="primary"
            size="sm"
            icon={GitBranch}
            iconRight={ArrowSquareOut}
            href={view.raiseEco.href}
            target={view.raiseEco.target}
            rel={view.raiseEco.rel}
            title={view.raiseEco.title}
            prefetch={false}
          >
            {view.raiseEco.label}
          </ButtonLink>
        )}
      </div>
    </Drawer>
  );
}
