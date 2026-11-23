import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { googleSignIn } from '../lib/googleAuth.ts';
import type { User } from '../types/itams.ts';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';

interface LoginViewProps {
  onSuccess: (token: string, user: User) => void;
}

export function LoginView({ onSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      const isTrusted =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost');
      if (!isTrusted) return;

      const data = event.data as
        | { type?: string; token?: string; user?: User; error?: string }
        | undefined;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'GITHUB_OAUTH_SUCCESS' && data.token && data.user) {
        setGithubLoading(false);
        setError(null);
        onSuccess(data.token, data.user);
      } else if (data.type === 'GITHUB_OAUTH_ERROR') {
        setGithubLoading(false);
        setError(data.error || 'GitHub sign-in failed. Please try again.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSuccess]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please enter both your corporate email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login(trimmedEmail, password);
      onSuccess(res.token, res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to reach authentication server. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { accessToken } = await googleSignIn();
      const res = await api.loginWithGoogle(accessToken);
      onSuccess(res.token, res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unable to sign in with Google. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGitHubSignIn = async () => {
    setError(null);
    setGithubLoading(true);
    try {
      const { url } = await api.getGitHubAuthUrl();
      const popup = window.open(
        url,
        'github_oauth_popup',
        'width=600,height=700,noopener=no'
      );
      if (!popup) {
        setGithubLoading(false);
        setError(
          'Sign-in popup was blocked by your browser. Please allow popups and try again.'
        );
        return;
      }

      const pollTimer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(pollTimer);
          setGithubLoading(false);
        }
      }, 500);
    } catch (err) {
      setGithubLoading(false);
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unable to start GitHub sign-in. Please try again.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[var(--av-bg)] text-[var(--av-text)] av-grid-surface flex flex-col lg:flex-row relative transition-colors duration-200">
      {/* Top-right Light / Dark Theme Toggle */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
        <ThemeSwitcher variant="segmented" />
      </div>

      {/* Left Enterprise Architectural Panel (Desktop only) */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-[#111827] av-grid-dark text-white p-14 flex-col justify-between border-r border-white/[0.08]">
        <div
          aria-hidden="true"
          className="av-ambient-orb pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full opacity-20 blur-3xl bg-[#3B82F6]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-28 -right-24 h-72 w-72 rounded-full opacity-15 blur-3xl bg-[#14B8A6]"
        />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3B82F6] text-white shadow-[0_8px_20px_-4px_rgba(59,130,246,0.45)]">
              <Server className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-white">
              AssetVault IT
            </span>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mt-14 max-w-md"
          >
            <h1 className="font-display text-3xl sm:text-[2.25rem] font-bold tracking-[-0.025em] text-white leading-[1.16] [text-wrap:balance]">
              Enterprise IT asset governance and lifecycle control.
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
              Track hardware inventory, employee custody handovers, preventive
              maintenance schedules, and warranty compliance from one unified
              platform.
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 mt-10 divide-y divide-white/[0.08] border-t border-white/[0.08] pt-2"
        >
          <div className="flex items-start gap-4 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-[#60A5FA]">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Role-Based Access Control
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Granular Admin and IT Staff governance for hardware lifecycle
                operations and account approvals.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-[#2DD4BF]">
              <Wrench className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Automated Warranty & Service Alerts
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Real-time advisories for expiring OEM warranties, overdue
                service tickets, and hardware refresh cycles.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 pt-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-[#60A5FA]">
              <FileSpreadsheet className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Audit-Ready PDF & Excel Reports
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Generate formal employee handover forms and export filterable
                audit datasets in seconds.
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right Sign-In Card */}
      <div className="flex-1 flex items-center justify-center p-5 pt-20 sm:p-10 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[420px] bg-[var(--av-surface)] border border-[var(--av-border)] rounded-xl p-7 sm:p-8 shadow-sm transition-colors duration-200"
        >
          <div className="border-b border-[var(--av-border-subtle)] pb-5">
            <div className="flex items-center gap-2.5 lg:hidden mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B82F6] text-white">
                <Server className="h-4 w-4" />
              </div>
              <span className="font-display text-base font-bold text-[var(--av-text)]">
                AssetVault IT
              </span>
            </div>
            <h2 className="font-display text-xl font-bold text-[var(--av-text)] tracking-tight">
              Sign in to workspace
            </h2>
            <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
              Authenticate with your corporate credentials or SSO provider.
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-5 rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed"
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5"
              >
                Work Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--av-text-subtle)]" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@assetvault.io"
                  className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-10 pr-3.5 py-2.5 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--av-text-subtle)]" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-10 pr-10 py-2.5 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[var(--av-text-subtle)] hover:text-[var(--av-text)] rounded-md transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <motion.button
              type="submit"
              whileTap={{ scale: 0.99 }}
              disabled={loading || googleLoading || githubLoading}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--av-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--av-accent)] disabled:opacity-60"
            >
              <span>{loading ? 'Verifying credentials...' : 'Sign In'}</span>
              {!loading && <ArrowRight className="h-4 w-4" />}
            </motion.button>
          </form>

          <div className="relative my-5 flex items-center">
            <div className="flex-grow border-t border-[var(--av-border-subtle)]" />
            <span className="mx-3 shrink-0 text-xs font-medium text-[var(--av-text-subtle)]">
              or continue with
            </span>
            <div className="flex-grow border-t border-[var(--av-border-subtle)]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={handleGoogleSignIn}
              disabled={loading || googleLoading || githubLoading}
              className="gsi-material-button w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--av-accent)] disabled:opacity-60"
            >
              <span className="gsi-material-button-icon h-4 w-4 shrink-0" aria-hidden="true">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="block h-full w-full"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </span>
              <span className="gsi-material-button-contents whitespace-nowrap">
                {googleLoading ? 'Google...' : 'Google'}
              </span>
            </motion.button>

            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={handleGitHubSignIn}
              disabled={loading || googleLoading || githubLoading}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2.5 text-sm font-medium text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--av-accent)] disabled:opacity-60"
            >
              <span className="h-4 w-4 shrink-0" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="block h-full w-full"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
                </svg>
              </span>
              <span className="whitespace-nowrap">
                {githubLoading ? 'GitHub...' : 'GitHub'}
              </span>
            </motion.button>
          </div>

          <div className="mt-6 border-t border-[var(--av-border-subtle)] pt-4">
            <p className="text-xs leading-relaxed text-[var(--av-text-subtle)]">
              Authorized access only. Sign in with your administrator, IT staff,
              Google, or GitHub account.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
