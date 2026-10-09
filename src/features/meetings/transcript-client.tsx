'use client';
// Meeting transcript box (docs/spec/05 §5.4 "Transcript", chapter 4 S-10): import (paste or .txt / .vtt / .srt), analysis
// (Claude only when the server has ANTHROPIC_API_KEY — the viewer is told the transcript leaves Keystone and may choose the
// local analysis instead; otherwise the local rules), and the human review of the proposals: discard / restore / edit,
// "Add to minutes" (kept decisions and actions), a risk into the risk register ("New risk" form), a question into the client
// questions. Nothing reaches the minutes, the risk register or the client questions without one of these clicks.
import {
  ArrowBendDownRight, ArrowCounterClockwise, ArrowClockwise, ArrowsLeftRight, FileArrowUp, Gavel, ListPlus, PencilSimple, Question, ShieldWarning, Sparkle,
  UploadSimple, Warning, X,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Textarea } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { useToast } from '@/components/ds/Toast';
import { acceptOf } from '@/domain/ch4-defaults';
import { TRANSCRIPT_IMPORT, type ProposalKind } from '@/domain/meetings';
import { useI18n } from '@/i18n/client';
import {
  addProposalQuestionAction, addProposalRiskAction, analyseTranscriptAction, applyTranscriptAction, editProposalAction, importTranscriptAction,
  reviewProposalAction,
} from './actions';
import { LINE_COLOR, type TranscriptItemView, type TranscriptView } from './model';
import s from './meetings.module.css';

/** What the server says about the analyser (src/server/ai/config.ts `transcriptAiInfo`). */
export interface TranscriptAi {
  claude: boolean;
  model: string | null;
}

const KIND_ICON: Record<ProposalKind, Icon> = { decision: Gavel, action: ArrowBendDownRight, risk: ShieldWarning, question: Question };
const KIND_COLOR: Record<ProposalKind, string> = {
  decision: LINE_COLOR.decision,
  action: 'var(--color-neutral-300)',
  risk: 'var(--color-accent-300)',
  question: 'var(--color-neutral-300)',
};

/** Keeps the meeting selected after a write when it came from the default selection. */
function usePin(selfHref: string, pinned: boolean) {
  const router = useRouter();
  return () => {
    if (!pinned) router.replace(selfHref, { scroll: false });
  };
}

// ── Import ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type ImportMode = 'paste' | 'file';

function ImportDialog({ code, meeting, replace, onClose, onDone }: { code: string; meeting: string; replace: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const accept = acceptOf('transcript');
  const ready = mode === 'paste' ? !!text.trim() : !!file;

  const choose = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    const ext = /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? '';
    if (!accept.split(',').includes('.' + ext)) return setError(t('File type not accepted'));
    if (f.size > TRANSCRIPT_IMPORT.maxUploadBytes) return setError(t('The transcript is too long'));
    setFile(f);
  };

  const submit = () => {
    if (!ready || pending) return;
    if (mode === 'paste' && text.length > TRANSCRIPT_IMPORT.maxUploadBytes) return setError(t('The transcript is too long'));
    setError(null);
    const form = new FormData();
    form.set('code', code);
    form.set('meeting', meeting);
    if (mode === 'file' && file) form.set('file', file);
    else form.set('text', text);
    startTransition(async () => {
      try {
        const r = await importTranscriptAction(form);
        if (!r.ok) return setError(r.error);
        onClose();
        if (r.toast) toast.show(r.toast);
        onDone();
      } catch {
        setError(t('The change could not be saved'));
      }
    });
  };

  return (
    <Dialog open onClose={onClose} title={t(replace ? 'Replace transcript' : 'Import transcript')} subtitle={`${meeting} · ${t('Paste the text or upload a .txt, .vtt or .srt file')}`} subtitleSize={12} width={640}>
      <form
        className={s.importForm}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label={t('Source')}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setError(null);
          }}
          options={[
            { value: 'paste', label: t('Paste text') },
            { value: 'file', label: t('Upload a file') },
          ]}
        />
        {mode === 'paste' ? (
          <Field label={t('Transcript')} htmlFor={`${id}-text`} required hint={t('One "Name: text" line per speaker keeps the speakers')}>
            <Textarea id={`${id}-text`} className={s.importText} value={text} onChange={(e) => setText(e.target.value)} placeholder={'R. Aubert: …\nL. Fabre: …'} />
          </Field>
        ) : (
          <Field label={t('File')} htmlFor={`${id}-file`} required hint={t('Teams, Zoom or Meet export (.vtt), subtitles (.srt) or plain text (.txt)')}>
            <div className={s.fileRow}>
              <input
                ref={fileRef}
                id={`${id}-file`}
                type="file"
                accept={accept}
                className={s.hiddenInput}
                onChange={(e) => {
                  choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" icon={FileArrowUp} onClick={() => fileRef.current?.click()}>
                {t('Choose a file')}
              </Button>
              <span className={cx(s.fileName, !file && s.fileNone)}>{file ? file.name : t('No file chosen')}</span>
            </div>
          </Field>
        )}
        <span className={s.importNote}>{t('The transcript is stored by Keystone. It is analysed only when you click "Analyse transcript".')}</span>
        {replace && (
          <Callout variant="info" icon={Warning}>
            {t('The current transcript and its analysis are replaced · lines already added to the minutes stay')}
          </Callout>
        )}
        {error && (
          <Callout variant="emphasis" icon={Warning} role="alert">
            {error}
          </Callout>
        )}
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={UploadSimple} disabled={!ready || pending} aria-busy={pending || undefined}>
            {t('Import the transcript')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** "Import transcript" (secondary) / "Replace transcript" (ghost). */
export function ImportTranscriptButton({ code, meeting, replace = false, selfHref, pinned }: { code: string; meeting: string; replace?: boolean; selfHref: string; pinned: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pin = usePin(selfHref, pinned);
  return (
    <>
      <Button size={replace ? 'xs' : 'sm'} variant={replace ? 'ghost' : undefined} icon={UploadSimple} onClick={() => setOpen(true)}>
        {t(replace ? 'Replace transcript' : 'Import transcript')}
      </Button>
      {open && <ImportDialog code={code} meeting={meeting} replace={replace} onClose={() => setOpen(false)} onDone={pin} />}
    </>
  );
}

/** Box shown instead of the transcript when a meeting has none (editors only). */
export function TranscriptImportPanel({ code, meeting, ai, selfHref, pinned }: { code: string; meeting: string; ai: TranscriptAi; selfHref: string; pinned: boolean }) {
  const { t } = useI18n();
  return (
    <div className={s.transcript}>
      <div className={s.panelHead}>
        <span className={cx(s.kicker, s.push)}>{t('Transcript')}</span>
        <ImportTranscriptButton code={code} meeting={meeting} selfHref={selfHref} pinned={pinned} />
      </div>
      <span className={s.trHint}>{t('No transcript yet · paste it or upload a .txt, .vtt or .srt file')}</span>
      <AiHint ai={ai} />
    </div>
  );
}

// ── Analysis ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the analysis runs, said before anything is sent. */
function AiHint({ ai }: { ai: TranscriptAi }) {
  const { t } = useI18n();
  return (
    <span className={s.trHint}>
      <Sparkle aria-hidden />
      {ai.claude
        ? `${t('Analysis by Claude (Anthropic)')} · ${t('the transcript is sent to Anthropic')}`
        : `${t('Local analysis (rules)')} · ${t('the transcript stays in Keystone')}`}
    </span>
  );
}

/** "Analyse transcript" / "Analyse again": local runs at once; Claude asks first (the transcript leaves Keystone). */
function AnalyseButton({ code, meeting, ai, again, selfHref, pinned }: { code: string; meeting: string; ai: TranscriptAi; again: boolean; selfHref: string; pinned: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const pin = usePin(selfHref, pinned);
  const [confirm, setConfirm] = useState(false);
  const [busy, startTransition] = useTransition();
  const run = (engine: 'local' | 'claude') =>
    startTransition(async () => {
      const r = await analyseTranscriptAction({ code, meeting, engine });
      setConfirm(false);
      if (!r.ok) return toast.show(r.error);
      if (r.toast) toast.show(r.toast);
      pin();
    });
  return (
    <>
      <Button
        size={again ? 'xs' : 'sm'}
        variant={again ? 'ghost' : undefined}
        icon={again ? ArrowClockwise : Sparkle}
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => (ai.claude ? setConfirm(true) : run('local'))}
      >
        {t(again ? 'Analyse again' : 'Analyse transcript')}
      </Button>
      {confirm && (
        <Dialog open onClose={() => !busy && setConfirm(false)} title={t('Analysis by Claude (Anthropic)')} subtitle={ai.model ?? undefined} width={560}>
          <div className={s.confirmBody}>
            <p className={s.confirmText}>
              {t('The transcript, the meeting title, its date and the invitees are sent to Anthropic’s API (Claude) to propose decisions, actions, risks and client questions.')}
            </p>
            <p className={s.confirmText}>{t('The proposals come back for your review: nothing is added to the minutes, the risk register or the client questions without you.')}</p>
            <p className={s.confirmText}>{t('For a confidential meeting, choose the local analysis: the transcript stays in Keystone.')}</p>
          </div>
          <DialogActions wrap>
            <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button variant="secondary" onClick={() => run('local')} disabled={busy}>
              {t('Analyse locally')}
            </Button>
            <Button variant="primary" icon={Sparkle} onClick={() => run('claude')} disabled={busy} aria-busy={busy || undefined}>
              {t('Analyse with Claude')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

// ── Review ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const editForm = (type: ProposalKind): FormDef => ({
  title: 'Edit proposal',
  submit: 'Save',
  kind: 'create',
  fields: [
    { id: 'text', label: 'Proposal', type: 'textarea', required: true },
    ...(type === 'action' || type === 'risk' ? [{ id: 'owner', label: 'Owner', type: 'text' as const }] : []),
    ...(type === 'action' ? [{ id: 'due', label: 'Due', type: 'text' as const, placeholder: '6 Oct' }] : []),
  ],
});

const QUESTION_FORM: FormDef = {
  title: 'Add to client questions',
  submit: 'Add question',
  kind: 'create',
  fields: [
    { id: 'text', label: 'Question', type: 'textarea', required: true },
    { id: 'askedBy', label: 'Asked by', type: 'text', required: true },
    { id: 'department', label: 'Department', type: 'text' },
    { id: 'owner', label: 'Owner', type: 'text', required: true },
  ],
};

type Open = { kind: 'edit' | 'risk' | 'question'; item: TranscriptItemView } | null;

interface ReviewProps {
  code: string;
  meeting: string;
  organizer: string;
  v: TranscriptView;
  canEdit: boolean;
  /** "New risk" form of the project (null: the viewer may not edit the risk register). */
  riskForm: FormDef | null;
  /** Risk owner options (the form's select) — the proposal owner is pre-selected when it is one of them. */
  riskTeam: string[];
  selfHref: string;
  pinned: boolean;
}

function ProposalRow({ item, canEdit, canAddRisk, busy, onReview, onOpen }: {
  item: TranscriptItemView;
  canEdit: boolean;
  canAddRisk: boolean;
  busy: boolean;
  onReview: (status: 'rejected' | 'proposed') => void;
  onOpen: (kind: 'edit' | 'risk' | 'question') => void;
}) {
  const { t } = useI18n();
  const I = KIND_ICON[item.type];
  const off = item.status === 'rejected';
  const open = item.status === 'proposed';
  return (
    <div className={cx(s.row3, s.draftLine)} title={item.source || undefined}>
      <I className={s.draftIcon} style={{ color: KIND_COLOR[item.type] }} aria-hidden />
      <span className={s.textCol}>
        <span className={cx(s.pretty, off && s.itemOff)}>
          <span className={s.itemKind}>{item.typeLabel}</span> {item.text}
        </span>
        {item.meta && <span className={s.small}>{item.meta}</span>}
      </span>
      <span className={s.itemSide}>
        {item.statusText && <span className={cx('tag', off ? 'tag-outline' : 'tag-neutral', s.tag10, s.nowrap)}>{item.statusText}</span>}
        {canEdit && open && item.type === 'risk' && canAddRisk && (
          <Button size="xs" variant="ghost" icon={ShieldWarning} disabled={busy} onClick={() => onOpen('risk')}>
            {t('Add to risk register')}
          </Button>
        )}
        {canEdit && open && item.type === 'question' && (
          <Button size="xs" variant="ghost" icon={ArrowsLeftRight} disabled={busy} onClick={() => onOpen('question')}>
            {t('Add to client questions')}
          </Button>
        )}
        {canEdit && open && <IconButton icon={PencilSimple} label={t('Edit proposal')} size={24} disabled={busy} onClick={() => onOpen('edit')} />}
        {canEdit && open && <IconButton icon={X} label={t('Discard proposal')} size={24} disabled={busy} onClick={() => onReview('rejected')} />}
        {canEdit && off && <IconButton icon={ArrowCounterClockwise} label={t('Restore proposal')} size={24} disabled={busy} onClick={() => onReview('proposed')} />}
      </span>
    </div>
  );
}

/** Summary, analyser, proposals under review and "Add to minutes". */
function TranscriptReview({ code, meeting, organizer, v, canEdit, riskForm, riskTeam, selfHref, pinned }: ReviewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const pin = usePin(selfHref, pinned);
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState<Open>(null);

  const review = (item: TranscriptItemView, status: 'rejected' | 'proposed') =>
    startTransition(async () => {
      const r = await reviewProposalAction({ code, meeting, position: item.position, status });
      if (!r.ok) return toast.show(r.error);
      pin();
    });
  const apply = () =>
    startTransition(async () => {
      const r = await applyTranscriptAction({ code, meeting });
      if (!r.ok) return toast.show(r.error);
      pin();
    });
  const after = (r: unknown) => {
    if (r && typeof r === 'object' && !('error' in r && (r as { error?: string }).error)) pin();
    return r as Awaited<ReturnType<typeof editProposalAction>>;
  };

  const item = open?.item;
  const riskOwner = item && (item.init.owner || item.init.askedBy);
  return (
    <div className={s.analysis}>
      <span className={s.kickerMuted}>{t('Summary')}</span>
      <p className={s.summary}>{v.summary}</p>
      {v.analyzerText && (
        <span className={s.trHint}>
          <Sparkle aria-hidden />
          {v.analyzerText}
        </span>
      )}
      {v.notice && (
        <Callout variant="info" icon={Warning}>
          {v.notice}
        </Callout>
      )}
      {v.items.map((x) => (
        <ProposalRow
          key={x.key}
          item={x}
          canEdit={canEdit}
          canAddRisk={!!riskForm}
          busy={busy}
          onReview={(st) => review(x, st)}
          onOpen={(kind) => setOpen({ kind, item: x })}
        />
      ))}
      {!v.items.length && <span className={s.trHint}>{t('No decision, action, risk or question found in the transcript')}</span>}
      <div className={s.footer}>
        <span className={s.footerText}>{t('Review the proposed decisions and actions, then add them to the minutes to edit before sending.')}</span>
        {canEdit && !v.applied && (
          <Button variant="primary" size="sm" icon={ListPlus} disabled={busy || !v.pendingMinutes} onClick={apply}>
            {t('Add to minutes')}
          </Button>
        )}
        {v.applied && <span className="tag tag-neutral">{t('Added to the minutes')}</span>}
      </div>
      {open?.kind === 'edit' && item && (
        <FormDialog
          {...editForm(item.type)}
          translate
          open
          context={`${meeting} · ${item.typeLabel}`}
          initialValues={{ text: item.init.text, owner: item.init.owner, due: item.init.due }}
          onClose={() => setOpen(null)}
          onSubmit={async (values) => after(await editProposalAction(code, meeting, item.position, values))}
        />
      )}
      {open?.kind === 'risk' && item && riskForm && (
        <FormDialog
          {...riskForm}
          translate
          open
          context={meeting}
          initialValues={{ title: item.init.text, ...(riskOwner && riskTeam.includes(riskOwner) ? { owner: riskOwner } : {}) }}
          onClose={() => setOpen(null)}
          onSubmit={async (values) => after(await addProposalRiskAction(code, meeting, item.position, values))}
        />
      )}
      {open?.kind === 'question' && item && (
        <FormDialog
          {...QUESTION_FORM}
          translate
          open
          context={meeting}
          initialValues={{ text: item.init.text, askedBy: item.init.askedBy, owner: organizer }}
          onClose={() => setOpen(null)}
          onSubmit={async (values) => after(await addProposalQuestionAction(code, meeting, item.position, values))}
        />
      )}
    </div>
  );
}

export interface TranscriptBoxProps extends Omit<ReviewProps, 'v'> {
  v: TranscriptView;
  ai: TranscriptAi;
}

/** The transcript box: source, text, analyser notice, Analyse / Analyse again / Replace, then the review. */
export function TranscriptBox(props: TranscriptBoxProps) {
  const { t } = useI18n();
  const { code, meeting, v, canEdit, ai, selfHref, pinned } = props;
  return (
    <div className={s.transcript}>
      <div className={s.panelHead}>
        <span className={cx(s.kicker, s.push)}>{t('Transcript')}</span>
        {canEdit && !v.locked && <ImportTranscriptButton code={code} meeting={meeting} replace selfHref={selfHref} pinned={pinned} />}
        {canEdit && v.analysed && !v.locked && <AnalyseButton code={code} meeting={meeting} ai={ai} again selfHref={selfHref} pinned={pinned} />}
        {canEdit && !v.analysed && <AnalyseButton code={code} meeting={meeting} ai={ai} again={false} selfHref={selfHref} pinned={pinned} />}
      </div>
      {v.sourceText && <span className={s.trSource}>{v.sourceText}</span>}
      <p className={s.transcriptText} tabIndex={0}>
        {v.text}
      </p>
      {canEdit && !v.analysed && <AiHint ai={ai} />}
      {v.analysed && <TranscriptReview {...props} />}
    </div>
  );
}
