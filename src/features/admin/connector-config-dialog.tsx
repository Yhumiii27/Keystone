'use client';
// Connector "Configure" (chapter 4, D-7): the Keystone-side settings of a connector — frequency, data scope, direction and
// enabled (a disabled connector is not synchronised: "Sync now" is refused). Remote credentials, URLs and tokens are not set
// here: they belong to the server configuration or to the remote system (out of scope, as the note says). Saved through
// saveConnectorConfigAction (audited: one "field: old → new" entry per change).
import { Info, Warning } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { intlLocale } from '@/i18n/translate';
import { translateMessage } from '@/server/interchange/messages';
import { connectorConfigAction, saveConnectorConfigAction, type ConnectorConfigView } from './interchange-actions';
import s from './interchange.module.css';

/** Frequencies proposed (free text is allowed: "Daily 06:30", "Every 2 h"). */
const FREQUENCIES = ['Real time', 'Real time (webhooks)', 'Every 15 min', 'Hourly', 'Every 2 h', 'Daily', 'Daily 06:30', 'On demand', 'Manual'];

export function ConnectorConfigDialog({ name, label, onClose }: { name: string; label: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const id = useId();
  const router = useRouter();
  const [config, setConfig] = useState<ConnectorConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    connectorConfigAction(name)
      .then((r) => {
        if (!alive) return;
        if (r.ok) setConfig(r.config);
        else setError(translateMessage(r.error, t));
      })
      .catch(() => alive && setError(t('The change could not be saved')));
    return () => {
      alive = false;
    };
  }, [name, t]);

  const save = () =>
    start(async () => {
      if (!config) return;
      setError(null);
      const r = await saveConnectorConfigAction(name, { frequency: config.frequency, dataScope: config.dataScope, direction: config.direction ?? '', enabled: config.enabled });
      if (!r.ok) {
        setError(translateMessage(r.error, t));
        return;
      }
      onClose();
      showToast(`${label} · ${t('Settings saved')}`);
      router.refresh();
    });

  const frequencies = config && !FREQUENCIES.includes(config.frequency) ? [config.frequency, ...FREQUENCIES] : FREQUENCIES;
  return (
    <Dialog open onClose={onClose} title={`${t('Configure')} · ${label}`} subtitle={t('Keystone-side settings of the connector')} subtitleSize={12} width={560}>
      <form
        className={s.body}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {!config && !error && <span className={s.hint}>{t('Loading…')}</span>}
        {config && (
          <div className={s.grid}>
            <Field label={t('Frequency')} htmlFor={`${id}-freq`} required>
              <Input id={`${id}-freq`} list={`${id}-freqs`} value={config.frequency} maxLength={60} onChange={(e) => setConfig({ ...config, frequency: e.target.value })} />
              <datalist id={`${id}-freqs`}>
                {frequencies.map((f) => (
                  <option key={f} value={f}>
                    {t(f)}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label={t('Direction')} htmlFor={`${id}-dir`}>
              <Select
                id={`${id}-dir`}
                value={config.direction ?? ''}
                onChange={(e) => setConfig({ ...config, direction: (e.target.value || null) as ConnectorConfigView['direction'] })}
                options={[{ value: '', label: '—' }, { value: 'import', label: t('Import') }, { value: 'export', label: t('Export') }, { value: 'both', label: t('Both') }]}
              />
            </Field>
            <Field label={t('Data')} htmlFor={`${id}-scope`} span="full" required>
              <Textarea id={`${id}-scope`} short value={config.dataScope} maxLength={300} onChange={(e) => setConfig({ ...config, dataScope: e.target.value })} />
            </Field>
            <label className={`${s.checkLine} ${s.full}`}>
              <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
              {t('Enabled — a disabled connector is not synchronised')}
            </label>
            <Callout variant="info" icon={Info} className={s.full}>
              {t('Credentials, addresses and tokens of the remote system are not set here: they stay in the server configuration and in the remote system.')}
            </Callout>
            {config.configuredAt && (
              <span className={`${s.meta} ${s.full}`}>
                {t('Last configured by')} {config.configuredByName ?? '—'} · {new Date(config.configuredAt).toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
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
          <Button type="submit" variant="primary" disabled={!config || pending || !config.frequency.trim() || !config.dataScope.trim()} aria-busy={pending || undefined}>
            {t('Save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
