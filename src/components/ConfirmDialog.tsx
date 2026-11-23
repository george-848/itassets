import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.35)] overflow-hidden"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--av-border-subtle)] px-6 py-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    variant === 'danger'
                      ? 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400'
                      : 'bg-[var(--av-accent-soft)] text-[var(--av-accent)]'
                  }`}
                >
                  <AlertTriangle className="h-4.5 w-4.5" />
                </div>
                <h3
                  id="confirm-dialog-title"
                  className="font-display text-base font-semibold text-[var(--av-text)]"
                >
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--av-accent)]"
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm leading-relaxed text-[var(--av-text-muted)]">
                {description}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 border-t border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-6 py-3.5">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] bg-[var(--av-surface)] border border-[var(--av-border)] rounded-lg hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  variant === 'danger'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[var(--av-accent)] hover:bg-[var(--av-accent-hover)]'
                }`}
              >
                {loading ? 'Processing...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
