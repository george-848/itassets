import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200/70 dark:border-blue-500/25 bg-blue-50/70 dark:bg-blue-500/10 text-[#3B66F6] dark:text-blue-400">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
        {title}
      </h3>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--av-text-subtle)]">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
