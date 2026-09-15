import { useEffect, useRef, useState } from 'react';
import { Select, Switch } from '@openbitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { externalSourcesAPI, type ExternalIntegrationPolicyMutation, type ExternalSourceCatalogSnapshot } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import type { EcosystemProductRuntime } from './ecosystemCompatibilityModel';

interface Props {
  runtime: EcosystemProductRuntime;
  snapshot: ExternalSourceCatalogSnapshot | null;
  onSnapshotChange: (snapshot: ExternalSourceCatalogSnapshot) => void;
}

export default function ExternalAgentDiscovery({ runtime, snapshot, onSnapshotChange }: Props) {
  const { t } = useI18n('scenes/ecosystem-compatibility');
  const { workspacePath } = useCurrentWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const policy = snapshot?.integrationPolicy;
  const mode = policy?.effective.ecosystems[runtime.spec.ecosystemId]?.mode ?? 'disabled';
  const canChange = policy?.status === 'compatible' && snapshot?.hostCapabilities.canMutatePolicy
    && typeof snapshot.preferenceRevision === 'number';

  async function change(change: ExternalIntegrationPolicyMutation['change']) {
    if (!canChange || !snapshot || busy) return;
    setBusy(true);
    setError(false);
    try {
      const next = await externalSourcesAPI.updateIntegrationPolicy(workspacePath || undefined, {
        expectedPreferenceRevision: snapshot.preferenceRevision!,
        scope: workspacePath ? 'workspace' : 'user',
        change,
      });
      if (alive.current) onSnapshotChange(next);
    } catch {
      if (!alive.current) return;
      setError(true);
      try {
        const current = await externalSourcesAPI.getSnapshot(workspacePath || undefined, false);
        if (alive.current) onSnapshotChange(current);
      } catch { /* Keep the last visible state; the failure remains explicit. */ }
    } finally { if (alive.current) setBusy(false); }
  }

  return <section id="ecosystem-source-manager" className="ecosystem-compatibility__section" data-external-agent-discovery={runtime.spec.ecosystemId}>
    <div className="ecosystem-compatibility__section-heading"><div><h2>{t('sourceSettings.title', { name: runtime.spec.name })}</h2><p>{t('sourceSettings.description')}</p></div></div>
    <div className="ecosystem-compatibility__content-detail">
      <label>{t('sourceSettings.master')}<Switch checked={policy?.effective.enabled ?? false} disabled={busy || !canChange} onChange={(event) => void change({ operation: 'set_enabled', enabled: event.target.checked })} /></label>
      <p>{t(workspacePath ? 'sourceSettings.projectScope' : 'sourceSettings.userScope')}</p>
      <label><span>{t('sourceSettings.mode', { name: runtime.spec.name })}</span><Select size="sm" disabled={busy || !canChange} value={mode} onValueChange={(value) => void change({ operation: 'set_ecosystem_mode', ecosystemId: runtime.spec.ecosystemId, mode: String(value) })} options={[
        { value: 'discover_only', label: t('sourceSettings.discoverOnly') },
        { value: 'disabled', label: t('sourceSettings.disabled') },
        ...(!['discover_only', 'disabled'].includes(mode) ? [{ value: mode, label: t('sourceSettings.existingPolicy') }] : []),
      ]} /></label>
      {!canChange ? <p role="status">{t('sourceSettings.readOnly')}</p> : null}
      {error ? <p role="alert">{t('sourceSettings.failed')}</p> : null}
      {runtime.sources.map((source) => <div key={source.stableKey}><strong>{source.record.displayName}</strong><p>{source.record.location}</p><small>{t(`sourceSettings.health.${source.record.health}`)}</small></div>)}
      {runtime.sources.length === 0 ? <p>{t('sourceSettings.empty')}</p> : null}
    </div>
  </section>;
}
