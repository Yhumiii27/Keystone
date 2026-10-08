// AttachmentRow, CommentRow, TimeEntryRow (docs/spec/02 C-29). Server-compatible.
import { File } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Avatar, IconTile } from './Badges';
import s from './Rows.module.css';

/** File row: 30px file tile (neutral-900 / accent-300) + ellipsed name + 11.5px meta. */
export function AttachmentRow({ icon = File, name, meta, right }: { icon?: Icon; name: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <div className={s.file}>
      <IconTile variant="file" icon={icon} />
      <div className={s.stack}>
        <span className={s.ellipsis}>{name}</span>
        {meta != null && <span className={s.meta}>{meta}</span>}
      </div>
      {right}
    </div>
  );
}

/** Comment: `grid 28px 1fr; gap 10; padding 8px 0` — 28px neutral avatar (10.5px), author + when (neutral-500), 13px text. */
export function CommentRow({ author, initials, when, children }: { author: string; initials?: string; when?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.comment}>
      <Avatar name={author} initials={initials} size={28} fontSize={10.5} />
      <div className={s.commentBody}>
        <div className={s.commentHead}>
          <span>{author}</span>
          {when != null && <span className={s.when}>{when}</span>}
        </div>
        <span className={s.commentText}>{children}</span>
      </div>
    </div>
  );
}

/** Time entry: `grid 96px 1fr auto; 12.5px; padding 5px 0` — date (neutral-400), note (neutral-300, ellipsis), hours. */
export function TimeEntryRow({ date, note, hours }: { date: ReactNode; note?: ReactNode; hours: ReactNode }) {
  return (
    <div className={s.entry}>
      <span className={s.entryDate}>{date}</span>
      <span className={s.entryNote}>{note}</span>
      <span className={s.num}>{hours}</span>
    </div>
  );
}
