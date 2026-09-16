interface ProgressBarProps {
  percent: number;
  label: string;
  completed?: boolean;
}

export function ProgressBar({ percent, label, completed = false }: ProgressBarProps) {
  const value = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      data-completed={completed}
    >
      <div className="progress-bar__fill" style={{ width: `${value}%` }} />
    </div>
  );
}
