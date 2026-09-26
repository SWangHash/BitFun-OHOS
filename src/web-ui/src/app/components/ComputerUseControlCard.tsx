import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Card, CardBody, CardFooter, CardHeader, OverlayLayer, OverflowText } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { getActiveSurfaceScope, onSurfaceActivated } from '@/infrastructure/peer-device/deviceSurface';
import {
  computerUseControlAPI, projectControlPointer,
  type ComputerUseControlSnapshot, type ComputerUseControlPreview,
} from '@/infrastructure/api/service-api/ComputerUseControlAPI';
import './ComputerUseControlCard.scss';

interface View {
  epoch: number;
  snapshot: ComputerUseControlSnapshot;
  frame?: ComputerUseControlPreview;
  framePointer?: ComputerUseControlSnapshot['pointer'];
  error?: boolean;
}

/** One passive card in the shared notification region; never intercepts input. */
export function ComputerUseControlCard() {
  const { t } = useI18n('common');
  const scope = useSyncExternalStore(onSurfaceActivated, getActiveSurfaceScope, getActiveSurfaceScope);
  const [view, setView] = useState<View>();
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const mutation = useRef(0);
  const [stopping, setStopping] = useState(false);
  const [clickFeedback, setClickFeedback] = useState<{ x: number; y: number } | null>(null);
  const [dismissed, setDismissed] = useState<string>();
  const current = view?.epoch === scope.epoch ? view : undefined;
  const snapshot = current?.snapshot;
  const active = snapshot?.state === 'active' || snapshot?.state === 'starting';

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setView(undefined);
    setExpanded(false);
    setStopping(false);
    const poll = async () => {
      const revision = mutation.current;
      try {
        const next = await computerUseControlAPI.status();
        if (disposed || !scope.isCurrent() || revision !== mutation.current) return;
        setView(previous => ({ epoch: scope.epoch, snapshot: next,
          ...(next.state === 'active' && previous?.epoch === scope.epoch && previous.snapshot.generation === next.generation
            && previous.snapshot.target === next.target ? { frame: previous.frame, framePointer: previous.framePointer } : {}),
        }));
        if (expandedRef.current && next.supported && next.state === 'active') {
          try {
            const frame = await computerUseControlAPI.preview(next.generation);
            if (disposed || !scope.isCurrent() || revision !== mutation.current) return;
            if (frame.generation !== next.generation || frame.target !== next.target) {
              throw new Error('Control preview target changed');
            }
            if (!/^image\/(png|jpeg|webp)$/.test(frame.mime_type) || frame.width <= 0 || frame.height <= 0) {
              throw new Error('Invalid control preview');
            }
            setView(previous => previous?.snapshot.generation === next.generation
              && previous.snapshot.target === next.target
              ? { ...previous, frame, framePointer: next.pointer } : previous);
          } catch {
            if (!disposed && scope.isCurrent() && revision === mutation.current) setView(previous => previous && {
              ...previous, frame: undefined, framePointer: undefined, error: true,
            });
          }
        }
      } catch {
        // Older peers may not expose this capability. Retain a previously
        // active card with an explicit unavailable state, never a local fallback.
        if (!disposed && scope.isCurrent() && revision === mutation.current) setView(previous => previous && {
          ...previous, frame: undefined, framePointer: undefined, error: true,
        });
      } finally {
        if (!disposed && scope.isCurrent()) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [scope]);

  const stop = async () => {
    if (!snapshot || !scope.isCurrent()) return;
    mutation.current += 1;
    setStopping(true);
    try {
      const next = await computerUseControlAPI.stop(snapshot.generation);
      if (scope.isCurrent()) {
        mutation.current += 1;
        setView({ epoch: scope.epoch, snapshot: next });
      }
    } catch {
      if (scope.isCurrent()) setView(previous => previous && { ...previous, error: true });
    } finally {
      if (scope.isCurrent()) setStopping(false);
    }
  };

  const lastClick = current?.framePointer?.last_click;
  const clickIdentity = `${scope.epoch}:${snapshot?.generation}:${snapshot?.target}:${lastClick?.sequence}`;
  useEffect(() => {
    setClickFeedback(null);
    if (!expanded || !current?.frame || !lastClick) return;
    const point = projectControlPointer(current.frame, { ...lastClick, click: true });
    if (!point) return;
    setClickFeedback(point);
    const timer = setTimeout(() => setClickFeedback(null), 300);
    return () => clearTimeout(timer);
    // The retained click sequence, rather than the instantaneous down/up bit,
    // survives polling. New frames of the same click must not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickIdentity, expanded]);

  const identity = `${scope.epoch}:${snapshot?.generation}`;
  if (!snapshot?.supported || snapshot.state === 'idle' || !snapshot.owner || dismissed === identity) return null;
  const pointer = current?.frame ? projectControlPointer(current.frame, current.framePointer ?? null) : null;
  const mode = snapshot.mode === 'observe' ? t('computerControl.observe')
    : snapshot.mode === 'foreground' ? t('computerControl.foreground') : t('computerControl.background');

  return <OverlayLayer passive>
    <div className="computer-control-card" data-bitfun-component="computer-control" data-bitfun-part="root">
    <Card appearance="raised" padding="md" gap="sm" radius="md"
      data-bitfun-native-webview-occlusion>
      <CardHeader>{t('computerControl.title')}</CardHeader>
      <CardBody>
        <p role="status" className="computer-control-card__status" data-bitfun-component="computer-control" data-bitfun-part="status">
          {current?.error ? t('computerControl.unavailable') : active ? mode : t('computerControl.stopped')}
        </p>
        {snapshot.target && <OverflowText>{snapshot.target}</OverflowText>}
        {expanded && current?.frame && <div className="computer-control-card__preview" data-bitfun-component="computer-control" data-bitfun-part="preview">
          <img src={`data:${current.frame.mime_type};base64,${current.frame.image_base64}`}
            alt={t('computerControl.previewAlt')} />
          {pointer && <span className="computer-control-card__pointer"
            data-bitfun-component="computer-control" data-bitfun-part="pointer"
            style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} aria-hidden="true">
            <svg viewBox="0 0 40 40" focusable="false"><path d="M8 8 C6 10 7 12 8 15 L14 31 C15.5 35 19 35 20.5 31.5 L23 26 C23.6 24.5 24.5 23.6 26 23 L31.5 20.5 C35 19 35 15.5 31 14 L15 8 C12 7 10 6 8 8 Z" /></svg>
          </span>}
          {clickFeedback && <span className="computer-control-card__click"
            data-bitfun-component="computer-control" data-bitfun-part="click"
            style={{ left: `${clickFeedback.x * 100}%`, top: `${clickFeedback.y * 100}%` }} aria-hidden="true" />}
        </div>}
        {expanded && !current?.frame && <p role="status">{t('computerControl.previewUnavailable')}</p>}
      </CardBody>
      <CardFooter>
        {active && <Button size="sm" variant="outline" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          {expanded ? t('computerControl.hidePreview') : t('computerControl.showPreview')}
        </Button>}
        {active ? <Button size="sm" variant="primary" disabled={stopping} onClick={() => void stop()}>
          {stopping ? t('computerControl.stopping') : t('computerControl.stop')}
        </Button> : <Button size="sm" variant="outline" onClick={() => setDismissed(identity)}>{t('actions.close')}</Button>}
      </CardFooter>
    </Card>
    </div>
  </OverlayLayer>;
}
