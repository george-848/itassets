import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  FileBarChart2,
  Keyboard,
  ShieldCheck,
  X,
} from 'lucide-react';

interface SupportModalProps {
  open: boolean;
  onClose: () => void;
}

export function SupportModal({ open, onClose }: SupportModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
              <div>
                <h3
                  id="support-modal-title"
                  className="font-display text-base font-semibold text-[var(--av-text)]"
                >
                  Workspace Reference & Shortcuts
                </h3>
                <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                  AssetVault IT operational policies and navigation controls
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                aria-label="Close help modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--av-accent-soft)] text-[var(--av-accent)]">
                  <Keyboard className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-[var(--av-text)]">
                    Keyboard Shortcuts
                  </div>
                  <div className="mt-2 space-y-1.5 text-[var(--av-text-muted)]">
                    <div className="flex items-center justify-between">
                      <span>Open Global Search</span>
                      <kbd className="rounded border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-1.5 py-0.5 font-mono text-[11px]">
                        Ctrl / ⌘ + K
                      </kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Close Active Modal or Drawer</span>
                      <kbd className="rounded border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-1.5 py-0.5 font-mono text-[11px]">
                        Esc
                      </kbd>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 border-t border-[var(--av-border-subtle)] pt-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--av-teal-soft)] text-[var(--av-teal)]">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-[var(--av-text)]">
                    Automated Compliance Monitoring
                  </div>
                  <p className="mt-1 leading-relaxed text-[var(--av-text-muted)]">
                    Warranty alerts trigger automatically 45 days prior to OEM
                    expiration. Lifecycle refresh advisories flag active assets older
                    than 4 years or marked Damaged.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 border-t border-[var(--av-border-subtle)] pt-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-[var(--av-text)]">
                    Custody & Role Governance
                  </div>
                  <p className="mt-1 leading-relaxed text-[var(--av-text-muted)]">
                    Only Available assets can be issued to active employees. Assigned
                    hardware must be returned through Assignments before retirement or
                    record deletion.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 border-t border-[var(--av-border-subtle)] pt-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <FileBarChart2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-[var(--av-text)]">
                    Audit Exports & Handover Forms
                  </div>
                  <p className="mt-1 leading-relaxed text-[var(--av-text-muted)]">
                    Export filtered datasets to PDF or Excel (.xlsx) from Reports, or
                    generate printable employee handover forms directly from Assignments.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-6 py-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
