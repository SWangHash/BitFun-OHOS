import { useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Card, CardHeader, Icon, IconButton, OverflowText, StatusPill } from '@bitfun/ui';
import { CircleUserRound } from 'lucide-react';
import { devecoAccountAPI, type DevecoAccountSnapshot } from '@/infrastructure/api/service-api/DevecoAccountAPI';
import { useI18n } from '@/infrastructure/i18n';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';

interface Props {
  supported: boolean;
  refreshVersion: number;
  expanded: boolean;
  onToggle: () => void;
}

function accountErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return ['deveco_auth_timeout', 'deveco_auth_unsupported', 'deveco_auth_unavailable',
    'deveco_login_cancel_failed', 'deveco_login_in_progress', 'deveco_login_session_mismatch',
    'deveco_auth_read_only', 'deveco_auth_invalid_response', 'deveco_auth_html_response'].includes(code) ? code : 'deveco_login_failed';
}

export default function DevecoAccount({ supported, refreshVersion, expanded, onToggle }: Props) {
  const { t } = useI18n('scenes/ecosystem-compatibility');
  const id = useId();
  const [snapshot, setSnapshot] = useState<DevecoAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const failed = failure !== null;
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const mutationActive = useRef(false);

  useEffect(() => {
    // An ordinary refresh does not change the owner of an accepted operation.
    return () => { sequence.current += 1; mutationActive.current = false; };
  }, [supported]);

  useEffect(() => {
    if (supported && mutationActive.current) return;
    const current = sequence.current;
    const scope = getActiveSurfaceScope();
    let cancelled = false;
    setSnapshot(null);
    if (!supported) setBusy(false);
    setFailure(null);
    setLoading(supported);
    if (supported) {
      void devecoAccountAPI.getStatus().then((value) => {
        if (!cancelled && current === sequence.current && scope.isCurrent()) setSnapshot(value);
      }).catch((error: unknown) => {
        if (!cancelled && current === sequence.current && scope.isCurrent()) setFailure(accountErrorCode(error));
      }).finally(() => {
        if (!cancelled && current === sequence.current && scope.isCurrent()) setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [supported, refreshVersion, revision]);

  useEffect(() => {
    if (!supported || busy || failed || snapshot?.login?.state !== 'pending') return;
    const current = sequence.current;
    const scope = getActiveSurfaceScope();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void devecoAccountAPI.getStatus().then((value) => {
        if (!cancelled && current === sequence.current && scope.isCurrent()) setSnapshot(value);
      }).catch((error: unknown) => {
        if (!cancelled && current === sequence.current && scope.isCurrent()) setFailure(accountErrorCode(error));
      });
    }, 1000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [snapshot, supported, busy, failed]);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('bitfun:acp-clients-changed', refresh);
    window.addEventListener('bitfun:acp-requirements-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('bitfun:acp-clients-changed', refresh);
      window.removeEventListener('bitfun:acp-requirements-changed', refresh);
    };
  }, []);

  async function mutate(operation: () => Promise<DevecoAccountSnapshot>) {
    if (!supported || mutationActive.current) return;
    const current = ++sequence.current;
    const scope = getActiveSurfaceScope();
    mutationActive.current = true;
    setBusy(true);
    setFailure(null);
    try {
      let value = await operation();
      if (value.login?.state === 'succeeded' && current === sequence.current && scope.isCurrent()) {
        value = await devecoAccountAPI.getStatus();
      }
      if (current === sequence.current && scope.isCurrent()) setSnapshot(value);
    } catch (error) {
      if (current === sequence.current && scope.isCurrent()) setFailure(accountErrorCode(error));
    } finally {
      if (current === sequence.current && scope.isCurrent()) {
        mutationActive.current = false;
        setBusy(false);
      }
    }
  }

  const pending = supported && snapshot?.login?.state === 'pending';
  const label = !supported ? t('content.devecoAccount.states.unsupportedHost')
    : loading ? t('content.devecoAccount.states.loading')
      : failed ? t('content.devecoAccount.states.failed')
        : !snapshot?.available ? t('content.devecoAccount.states.unavailable')
          : pending ? t('content.devecoAccount.states.pending')
            : snapshot.credentialPresent === true ? t('content.devecoAccount.states.credentialPresent')
              : snapshot.credentialPresent === null ? t('content.devecoAccount.states.unknown')
                : t('content.devecoAccount.states.signedOut');
  const loginFailed = supported && snapshot?.login?.state === 'failed';
  const errorCode = failure ?? (loginFailed ? snapshot?.login?.error : undefined);
  const errorMessage = errorCode === 'deveco_auth_timeout' ? t('content.devecoAccount.errors.timeout')
    : errorCode === 'deveco_auth_unsupported' ? t('content.devecoAccount.errors.unsupported')
      : errorCode === 'deveco_auth_invalid_response' || errorCode === 'deveco_auth_html_response' ? t('content.devecoAccount.errors.invalidResponse')
        : errorCode === 'deveco_auth_unavailable' ? t('content.devecoAccount.errors.unavailable')
          : errorCode === 'deveco_login_cancel_failed' ? t('content.devecoAccount.errors.cancelFailed')
            : errorCode === 'deveco_login_in_progress' ? t('content.devecoAccount.errors.inProgress')
              : errorCode === 'deveco_login_session_mismatch' ? t('content.devecoAccount.errors.sessionChanged')
                : errorCode === 'deveco_auth_read_only' ? t('content.devecoAccount.errors.readOnly')
                  : t('content.devecoAccount.errors.failed');

  return <div data-content-group="account" role="rowgroup" className="ecosystem-compatibility__content-group">
    <div className="ecosystem-compatibility__content-summary" role="row">
      <span role="cell" className="ecosystem-compatibility__import-item">
        <span className="ecosystem-compatibility__import-item-icon"><Icon glyph={CircleUserRound} size="md" /></span>
        <span className="ecosystem-compatibility__import-item-copy"><strong>{t('capabilities.account')}</strong><small>{t('content.devecoAccount.description')}</small></span>
      </span>
      <span role="cell"><OverflowText>{t('content.accounts.providers.deveco')}</OverflowText></span>
      <span role="cell" className="ecosystem-compatibility__content-summary-state">
        <StatusPill tone="neutral">{label}</StatusPill>
        <IconButton size="sm" variant="quiet" icon={<Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />}
          aria-label={t(expanded ? 'content.collapseCategory' : 'content.expandCategory', { type: t('capabilities.account') })}
          aria-expanded={expanded} aria-controls={id} data-testid="ecosystem-account-expand-deveco-code"
          onClick={() => { if (!expanded) setRevision((value) => value + 1); onToggle(); }} />
      </span>
    </div>
    <div role="row" hidden={!expanded}><div id={id} role="cell" aria-colspan={3} className="ecosystem-compatibility__content-expanded">
      {expanded ? <Card appearance="subtle" padding="sm" className="ecosystem-compatibility__account-panel">
        <CardHeader title={t('content.accounts.providers.deveco')} description={t('content.devecoAccount.note')} />
        <div className="ecosystem-compatibility__account-actions">
          {supported && (snapshot?.available || failed) ? pending
            ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate(() => devecoAccountAPI.cancelLogin(snapshot!.login!.id))}>{t('content.devecoAccount.cancel')}</Button>
            : <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void mutate(devecoAccountAPI.startLogin)}>{t(snapshot?.credentialPresent === true ? 'content.devecoAccount.signInAgain' : 'content.devecoAccount.signIn')}</Button>
            : null}
          {supported && snapshot?.credentialPresent === true ? <Button size="sm" variant="outline" disabled={busy || pending || loading} onClick={() => void mutate(devecoAccountAPI.logout)}>{t('content.devecoAccount.signOut')}</Button> : null}
          <IconButton size="sm" variant="quiet" icon={<Icon name="refresh" size="sm" />}
            aria-label={t('content.accounts.refresh')} title={t('content.accounts.refresh')}
            disabled={!supported || loading || busy} onClick={() => setRevision((value) => value + 1)} />
        </div>
        {failed || loginFailed ? <Alert tone="error" className="ecosystem-compatibility__account-feedback" message={errorMessage} />
          : !supported || (!loading && !snapshot?.available) ? <Alert tone="info" className="ecosystem-compatibility__account-feedback"
            message={t(supported ? 'content.devecoAccount.unavailable' : 'content.devecoAccount.unsupportedHost')} />
            : snapshot?.credentialPresent === null ? <Alert tone="info" className="ecosystem-compatibility__account-feedback"
              message={t('content.devecoAccount.unknown')} /> : null}
      </Card> : null}
    </div></div>
  </div>;
}
