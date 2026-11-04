import {
  Component, createElement, forwardRef, lazy,
  type ComponentPropsWithRef, type ComponentType, type ForwardRefExoticComponent,
  type LazyExoticComponent,
} from 'react';
import { Alert, Button } from '@bitfun/ui';
import { useTranslation } from 'react-i18next';
import { createModuleLoader } from './moduleLoader';

class ModuleImportError extends Error {
  constructor(readonly originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
  }
}

function ModuleLoadFailure({ retry }: { retry: () => void }) {
  const { t } = useTranslation('errors', { useSuspense: false });
  return (
    <Alert
      tone="error"
      title={t('moduleLoad.title')}
      message={t('moduleLoad.description')}
      description={<Button size="sm" variant="primary" onClick={retry}>{t('moduleLoad.retry')}</Button>}
    />
  );
}

export type RecoverableLazyComponent<T extends ComponentType<any>> =
  ForwardRefExoticComponent<ComponentPropsWithRef<T>> & { preload: () => Promise<{ default: T }> };

/** Recover rejected imports while leaving render errors and Suspense to the caller. */
export function lazyWithRecovery<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): RecoverableLazyComponent<T> {
  const load = createModuleLoader(loader);
  const createLazyComponent = () => lazy(() => load().catch(error => {
    throw new ModuleImportError(error);
  }));
  let Content = createLazyComponent();

  type Props = { componentProps: ComponentPropsWithRef<T> };
  type State = { failed: boolean; content: LazyExoticComponent<T> };
  class ModuleBoundary extends Component<Props, State> {
    state: State = { failed: false, content: Content };

    static getDerivedStateFromError(error: unknown) {
      if (!(error instanceof ModuleImportError)) throw error;
      return { failed: true };
    }

    componentDidCatch() {
      // A new mount and an explicit retry must not reuse React.lazy's rejection.
      if (Content === this.state.content) Content = createLazyComponent();
    }

    render() {
      return this.state.failed
        ? <ModuleLoadFailure retry={() => this.setState({ failed: false, content: Content })} />
        : createElement(this.state.content, this.props.componentProps);
    }
  }

  const Recoverable = forwardRef((props, ref) => (
    <ModuleBoundary componentProps={{ ...props, ...(ref === null ? {} : { ref }) } as ComponentPropsWithRef<T>} />
  ));
  Recoverable.displayName = 'RecoverableLazy';
  return Object.assign(Recoverable, { preload: load }) as RecoverableLazyComponent<T>;
}
