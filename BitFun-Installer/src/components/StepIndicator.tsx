import { useTranslation } from 'react-i18next';
import type { InstallStep } from '../types/installer';

const STEP_INDEX: Record<Exclude<InstallStep, 'uninstall'>, number> = {
  lang: 0,
  options: 1,
  progress: 1,
  model: 2,
  theme: 3,
};

export function StepIndicator({ step }: { step: Exclude<InstallStep, 'uninstall'> }) {
  const { t } = useTranslation();
  const current = STEP_INDEX[step];
  const labels = [t('steps.language'), t('steps.install'), t('steps.model'), t('steps.theme')];

  return (
    <ol className="step-indicator" aria-label={t('steps.label')}>
      {labels.map((label, index) => (
        <li
          key={index}
          className="step-indicator__item"
          aria-current={index === current ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}
