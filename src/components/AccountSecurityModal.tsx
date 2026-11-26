import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';

interface AccountSecurityModalProps {
  open: boolean;
  userEmail: string;
  onClose: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
  onChanged?: () => Promise<void>;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function AccountSecurityModal({
  open,
  userEmail,
  onClose,
  onToast,
  onChanged,
}: AccountSecurityModalProps) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState(0);

  const [setupData, setSetupData] = useState<{
    secret: string;
    qrDataUrl: string;
    recoveryCodes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getMfaStatus();
      setEnabled(status.enabled);
      setRecoveryRemaining(status.recoveryCodesRemaining);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to fetch 2FA status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSetupData(null);
      setVerifyCode('');
      setDisableCode('');
      void loadStatus();
    }
  }, [open]);

  const handleStartSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.setupMfa();
      setSetupData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start 2FA setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.enableMfa(verifyCode.trim());
      onToast('success', 'Two-factor authentication (2FA) enabled for your account.');
      setSetupData(null);
      setVerifyCode('');
      await loadStatus();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.disableMfa(disableCode.trim());
      onToast('success', 'Two-factor authentication has been disabled.');
      setDisableCode('');
      await loadStatus();
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to disable 2FA.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4.5 w-4.5 text-[var(--av-accent)]" />
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    Account Security &amp; 2FA (TOTP)
                  </h3>
                  <p className="text-[11px] text-[var(--av-text-subtle)]">{userEmail}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {error && (
                <div className="rounded-lg border border-red-300/60 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {loading ? (
                <div className="text-xs text-[var(--av-text-subtle)] py-4 text-center">
                  Loading security posture...
                </div>
              ) : enabled ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-300/60 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10 p-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Authenticator App 2FA is Active</span>
                    </div>
                    <p className="text-xs text-[var(--av-text-muted)] leading-relaxed">
                      Sign-ins with password now require a 6-digit TOTP verification code. Recovery codes remaining:{' '}
                      <strong className="font-mono">{recoveryRemaining}</strong>
                    </p>
                  </div>

                  <form onSubmit={handleDisable} className="space-y-3 border-t border-[var(--av-border-subtle)] pt-4">
                    <label className="block text-xs font-semibold text-[var(--av-text)]">
                      Disable Two-Factor Authentication
                    </label>
                    <p className="text-[11px] text-[var(--av-text-subtle)]">
                      Enter a current 6-digit code from your authenticator app or an unused recovery code.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value)}
                        placeholder="123456 or ABCD-EF12"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-500/40 px-4 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 whitespace-nowrap disabled:opacity-60"
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        <span>{busy ? 'Disabling...' : 'Disable 2FA'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              ) : !setupData ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/50 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[var(--av-text)]">
                      <KeyRound className="h-4 w-4 text-[var(--av-accent)]" />
                      <span>Protect your workspace with Authenticator 2FA</span>
                    </div>
                    <p className="text-xs text-[var(--av-text-muted)] leading-relaxed">
                      Use Google Authenticator, Microsoft Authenticator, Authy, or 1Password to generate time-based 6-digit codes every 30 seconds.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleStartSetup}
                    className="w-full rounded-lg bg-[var(--av-accent)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                  >
                    {busy ? 'Generating Secret...' : 'Set Up Authenticator App'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleEnable} className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/40 p-4">
                    <img
                      src={setupData.qrDataUrl}
                      alt="2FA QR Code"
                      className="h-36 w-36 rounded-lg bg-white p-2 border border-[var(--av-border)] shrink-0"
                    />
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[var(--av-text)]">
                        1. Scan QR code in your authenticator app
                      </div>
                      <p className="text-[11px] text-[var(--av-text-subtle)]">
                        Or enter this manual setup key:
                      </p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 truncate rounded bg-[var(--av-surface)] border border-[var(--av-border)] px-2 py-1 text-[11px] font-mono text-[var(--av-text)]">
                          {setupData.secret}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(setupData.secret);
                            setCopiedSecret(true);
                            setTimeout(() => setCopiedSecret(false), 1800);
                          }}
                          className="rounded border border-[var(--av-border)] p-1.5 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]"
                          title="Copy Secret"
                        >
                          {copiedSecret ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--av-border-subtle)] p-3.5 space-y-2">
                    <div className="text-xs font-semibold text-[var(--av-text)]">
                      2. Save your one-time recovery codes
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {setupData.recoveryCodes.map((rc) => (
                        <code
                          key={rc}
                          className="rounded bg-[var(--av-surface-muted)] px-2 py-1 text-center text-[11px] font-mono text-[var(--av-text)]"
                        >
                          {rc}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--av-text)] mb-1">
                      3. Enter 6-digit verification code to activate
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className={`${INPUT_CLASS} font-mono tracking-widest text-center`}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setSetupData(null)}
                      className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={busy || verifyCode.length < 6}
                      className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                    >
                      {busy ? 'Activating...' : 'Verify & Enable 2FA'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
