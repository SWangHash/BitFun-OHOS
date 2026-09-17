import { Button, Checkbox, Disclosure, Field, Input, PageHeader } from '@bitfun/ui';
import { ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { InstallErrorPanel } from '../components/InstallErrorPanel';
import type {
  InstallOptions,
  DiskSpaceInfo,
  InstallPathValidation,
  ExistingInstallation,
} from '../types/installer';

interface OptionsProps {
  previewOnly?: boolean;
  options: InstallOptions;
  setOptions: React.Dispatch<React.SetStateAction<InstallOptions>>;
  diskSpace: DiskSpaceInfo | null;
  error: string | null;
  refreshDiskSpace: (path: string) => Promise<void>;
  existingInstall: ExistingInstallation | null;
  onLaunchRegisteredUninstaller: () => void | Promise<void>;
  onBack: () => void;
  onInstall: () => Promise<void>;
  isInstalling: boolean;
  clearInstallError: () => void;
}

export function Options({
  options,
  setOptions,
  diskSpace,
  error,
  refreshDiskSpace,
  existingInstall,
  onLaunchRegisteredUninstaller,
  onBack,
  onInstall,
  isInstalling,
  clearInstallError,
  previewOnly = false,
}: OptionsProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (options.installPath) refreshDiskSpace(options.installPath);
  }, [options.installPath, refreshDiskSpace]);

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      defaultPath: options.installPath,
      title: t('options.pathLabel'),
    });
    if (selected && typeof selected === 'string') {
      try {
        const validated = await invoke<InstallPathValidation>('validate_install_path', {
          path: selected,
        });
        setOptions((prev) => ({ ...prev, installPath: validated.installPath }));
      } catch {
        setOptions((prev) => ({ ...prev, installPath: selected }));
      }
      clearInstallError();
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="page-shell">
      <div className="page-scroll">
        <div className="page-container">
          <PageHeader className="page-heading" title={t('options.title')} />

          {existingInstall?.detected && (
            <Disclosure
              className="existing-install"
              summary={t(existingInstall.mainBinaryPresent ? 'options.existingInstallTitle' : 'options.existingInstallBinaryMissing')}
            >
              <div className="existing-install__details">
                {existingInstall.displayVersion && (
                  <p>{t('options.existingInstallVersion', { version: existingInstall.displayVersion })}</p>
                )}
                {existingInstall.installLocation && (
                  <p className="selectable-path">{t('options.existingInstallLocation', { path: existingInstall.installLocation })}</p>
                )}
                {existingInstall.uninstallString && (
                  <Button variant="text" size="sm" disabled={isInstalling || previewOnly} onClick={() => { void onLaunchRegisteredUninstaller(); }}>
                    {t('options.existingInstallRunUninstaller')}
                  </Button>
                )}
              </div>
            </Disclosure>
          )}

          <section className="install-location">
            <Field
              label={t('options.pathLabel')}
              controlWidth="fill"
              controlTrailing={
                <Button variant="fill" disabled={isInstalling || previewOnly} onClick={handleBrowse}>{t('options.browse')}</Button>
              }
            >
              <Input
                size="md"
                className="path-input"
                value={options.installPath}
                disabled={isInstalling}
                invalid={!!error}
                aria-describedby={diskSpace ? 'install-disk-space' : undefined}
                onChange={(event) => {
                  setOptions((prev) => ({ ...prev, installPath: event.target.value }));
                  clearInstallError();
                }}
                placeholder={t('options.pathPlaceholder')}
                spellCheck={false}
              />
            </Field>
            {diskSpace && (
              <div className="disk-space" id="install-disk-space">
                <span>{t('options.required')}: {formatBytes(diskSpace.required)}</span>
                <span>
                  {t('options.available')}: {diskSpace.available < Number.MAX_SAFE_INTEGER ? formatBytes(diskSpace.available) : '—'}
                </span>
                {!diskSpace.sufficient && <span className="status-danger">{t('options.insufficientSpace')}</span>}
              </div>
            )}
            {error && <InstallErrorPanel message={error} variant="options" />}
          </section>

          <fieldset className="install-options">
            <legend className="section-label">{t('options.optionsLabel')}</legend>
            <Checkbox
              checked={options.desktopShortcut}
              disabled={isInstalling}
              onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, desktopShortcut: checked }))}
              label={t('options.desktopShortcut')}
            />
            <Checkbox
              checked={options.startMenu}
              disabled={isInstalling}
              onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, startMenu: checked }))}
              label={t('options.startMenu')}
            />
          </fieldset>
        </div>
      </div>

      <div className="page-footer page-footer--split">
        <Button variant="text" disabled={isInstalling} onClick={onBack}>
          {t('options.changeLanguage')}
        </Button>
        <Button
          variant="primary"
          trailingIcon={<ArrowRight />}
          loading={isInstalling}
          onClick={() => { void onInstall(); }}
          disabled={previewOnly || !options.installPath || (diskSpace !== null && !diskSpace.sufficient)}
        >
          {isInstalling ? t('options.installing') : t('options.install')}
        </Button>
      </div>
    </div>
  );
}
