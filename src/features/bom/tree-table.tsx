'use client';
// Assembly tree table (template 1210–1232; `treeRows` 4231–4237): depth-first rows of the costed structure, indented
// 18px per level, with a caret that folds / unfolds an assembly (`bomClosed`, transient UI kept here) and a row click
// that opens the node drawer (`?node=`). Folding hides the whole subtree of the folded assembly.
import { CaretDown, CaretRight, DotOutline } from '@phosphor-icons/react/dist/ssr';
import { useState, type CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { SectionCard } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import { visibleAssemblyRows } from '@/domain/bom';
import type { TreeView } from './model';
import s from './bom.module.css';

export function TreeTable({ view }: { view: TreeView }) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (ref: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  const rows = visibleAssemblyRows(view.rows, folded);
  const L = view.labels;
  return (
    <div className={s.treeWrap}>
      <SectionCard title={view.title} hint={view.hint} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{L.refArticle}</Th>
              <Th align="right">{L.qty}</Th>
              <Th align="right">{L.ext}</Th>
              <Th>{L.makeBuy}</Th>
              <Th>{L.pu}</Th>
              <Th>{L.rev}</Th>
              <Th>{L.status}</Th>
              <Th align="right">{L.unit}</Th>
              <Th align="right">{L.total}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isFolded = folded.has(r.ref);
              const Caret = !r.hasChildren ? DotOutline : isFolded ? CaretRight : CaretDown;
              return (
                <ClickableRow key={`${r.path.join('/')}/${r.ref}`} href={r.href} selected={r.selected}>
                  <td>
                    <div className={s.treeCell} style={{ '--tree-pad': `${r.depth * 18 + 6}px` } as CSSProperties}>
                      <button
                        type="button"
                        className={s.caretBtn}
                        onClick={r.hasChildren ? () => toggle(r.ref) : undefined}
                        aria-expanded={r.hasChildren ? !isFolded : undefined}
                        aria-label={r.hasChildren ? `${isFolded ? L.unfold : L.fold} ${r.ref}` : undefined}
                        aria-hidden={r.hasChildren ? undefined : true}
                        tabIndex={r.hasChildren ? undefined : -1}
                      >
                        <Caret aria-hidden />
                      </button>
                      <span className={s.treeRef}>{r.ref}</span>
                      <span className={r.hasChildren ? s.treeNameAsm : s.treeName}>{r.name}</span>
                    </div>
                  </td>
                  <Td align="right" numeric>
                    {r.qty}
                  </Td>
                  <Td align="right" numeric className={s.ext}>
                    {r.ext}
                  </Td>
                  <Td tone="secondary">{r.makeBuy}</Td>
                  <td>
                    <span className={`${r.pu.cls} ${s.nowrap}`}>
                      {r.pu.label}
                    </span>
                  </td>
                  <Td numeric>{r.rev}</Td>
                  <td>
                    <span className={`${r.status.cls} ${s.nowrap}`}>
                      {r.status.label}
                    </span>
                  </td>
                  <Td align="right" numeric nowrap>
                    {r.unit}
                  </Td>
                  <Td align="right" numeric nowrap>
                    {r.total}
                  </Td>
                </ClickableRow>
              );
            })}
          </tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
