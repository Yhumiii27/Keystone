'use client';
// Connector "Configure" (chapter 4, D-7a): shows the Keystone-side settings of a connector — frequency, data scope, direction
// and enabled — read-only. The product owner answered D-7a "Par l'informatique, en dehors de l'application": IT configures
// connectors outside Keystone, so nothing is edited here (saveConnectorConfigAction refuses changes while
// CONNECTOR_SETTINGS_BY_IT is on). A connector disabled by IT is listed as "Disabled" and "Sync now" is refused.
import { Info, Warning } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Callout } from '@/components/app/Callout';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { useI18n } from '@/i18n/client';
import { intlLocale } from '@/i18n/translate';
import { translateMessage } from '@/server/interchange/messages';
import { connectorConfigAction, type ConnectorConfigView } from './interchange-actions';
import s from './interchange.module.css';

const DIRECTION_LABEL: Record<string, string> = { import: 'Import', export: 'Export', both: 'Both' };

export function ConnectorConfigDialog({ name, label, onClose }: { name: string; label: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [config, setConfig] = useState<ConnectorConfigView | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const rows: [string, string][] = config
    ? [
        [t('Frequency'), t(config.frequency) || '—'],
        [t('Direction'), config.direction ? t(DIRECTION_LABEL[config.direction] ?? config.direction) : '—'],
        [t('Data'), config.dataScope ? t(config.dataScope) : '—'],
        [t('Status'), config.enabled ? t('Enabled') : t('Disabled')],
      ]
    : [];
  return (
    <Dialog open onClose={onClose} title={`${t('Configure')} · ${label}`} subtitle={t('Keystone-side settings of the connector')} subtitleSize={12} width={560}>
      <div className={s.body}>
        {!config && !error && <span className={s.hint}>{t('Loading…')}</span>}
        {config && (
          <>
            <dl className={s.readGrid}>
              {rows.map(([k, v]) => (
                <div key={k} className={s.readRow}>
                  <dt className={s.readLabel}>{k}</dt>
                  <dd className={s.readValue}>{v}</dd>
                </div>
              ))}
            </dl>
            <Callout variant="info" icon={Info}>
              {t('Connectors are configured by IT outside Keystone: ask IT to change the frequency, the data, the direction or to enable or disable a connector. Credentials, addresses and tokens stay in the server configuration and in the remote system.')}
            </Callout>
            {config.configuredAt && (
              <span className={s.meta}>
                {t('Last configured by')} {config.configuredByName ?? '—'} · {new Date(config.configuredAt).toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </>
        )}
        {error && (
          <Callout variant="emphasis" icon={Warning} role="alert">
            {error}
          </Callout>
        )}
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
