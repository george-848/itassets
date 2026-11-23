import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 w-full max-w-sm pointer-events-none px-4 sm:px-0"
      aria-live="polite"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.95 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3.5 shadow-[0_14px_34px_-8px_rgba(0,0,0,0.22)] bg-[var(--av-surface)]/95 backdrop-blur-md ${
              t.type === 'success'
                ? 'border-emerald-300/80 dark:border-emerald-500/30 text-[var(--av-text)]'
                : 'border-red-300/80 dark:border-red-500/30 text-[var(--av-text)]'
            }`}
          >
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                t.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400'
              }`}
            >
              {t.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
            </div>
            <p className="text-sm font-medium text-[var(--av-text)] flex-1 leading-snug pt-0.5">
              {t.message}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="text-[var(--av-text-subtle)] hover:text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] p-1 rounded-md transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
