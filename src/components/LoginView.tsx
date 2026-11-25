import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  User as UserIcon,
  Wrench,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { googleSignIn } from '../lib/googleAuth.ts';
import type { User } from '../types/itams.ts';
import type { PlanCode, SubscriptionPlan, TenantType } from '../types/saas.ts';
import { ThemeSwitcher } from './ThemeSwitcher.tsx';
import { FlyingStarsCanvas } from './ui/FlyingStarsCanvas.tsx';

interface LoginViewProps {
  onSuccess: (token: string, user: User) => void;
}

export function LoginView({ onSuccess }: LoginViewProps) {
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Registration state
  const [regName, setRegName] = useState('');
  const [regCompany, setRegCompany] = useState('');
  const [regTenantType, setRegTenantType] = useState<TenantType>('company');
  const [regPlanCode, setRegPlanCode] = useState<PlanCode>('professional');
  const [publicPlans, setPublicPlans] = useState<SubscriptionPlan[]>([]);

  // Password reset modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<'request' | 'confirm'>('request');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPublicPlans()
      .then((res) => setPublicPlans(res.plans))
      .catch(() => {
        // Non-blocking fallback
      });
  }, []);

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

    if (authMode === 'signin') {
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
      return;
    }

    // Create Workspace (Company / MSP)
    if (!regName.trim() || !regCompany.trim() || !email.trim() || password.length < 8) {
      setError(
        'Enter your full name, organisation name, valid work email, and a password (min 8 characters).'
      );
      return;
    }
    setLoading(true);
    try {
      const res = await api.register({
        name: regName.trim(),
        email: email.trim(),
        password,
        companyName: regCompany.trim(),
        tenantType: regTenantType,
        planCode: regPlanCode,
      });
      onSuccess(res.token, res.user);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to create workspace right now.'
      );
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

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setResetMessage(null);
    setResetLoading(true);
    try {
      if (resetStep === 'request') {
        const res = await api.forgotPassword(resetEmail.trim());
        if (res.testResetToken) {
          setResetToken(res.testResetToken);
          setResetMessage(
            `${res.message} Token prefilled for verification: ${res.testResetToken}`
          );
        } else {
          setResetMessage(res.message);
        }
        setResetStep('confirm');
      } else {
        await api.resetPassword(resetToken.trim(), resetNewPass);
        setResetMessage('Password updated successfully. You can sign in now.');
        window.setTimeout(() => {
          setResetOpen(false);
          setResetStep('request');
          setResetNewPass('');
        }, 1200);
      }
    } catch (err) {
      setResetMessage(
        err instanceof ApiError ? err.message : 'Password reset failed.'
      );
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--av-bg)] text-[var(--av-text)] av-grid-surface flex flex-col lg:flex-row relative transition-colors duration-200">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
        <ThemeSwitcher variant="segmented" />
      </div>

      {/* Left Enterprise Architectural Panel (Desktop only) */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-[#111827] av-grid-dark text-white p-14 flex-col justify-between border-r border-white/[0.08]">
        <FlyingStarsCanvas />

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
              Enterprise ITAM, Helpdesk, and ITSM for companies &amp; MSPs.
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
              Govern hardware lifecycles, software licences, procurement, service
              tickets, SLA targets, and multi-client MSP operations from one
              isolated platform.
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
                Multi-Tenant &amp; MSP Isolation
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Strict tenant boundaries, client-organisation scoping, and granular
                RBAC roles across internal IT teams and managed service providers.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-[#2DD4BF]">
              <Wrench className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Helpdesk, ITSM &amp; SLA Automation
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Asset-linked service tickets, incident severity, CAB change
                approvals, business-hours SLAs, and automated breach escalation.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 pt-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <FileSpreadsheet className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                GH₵ Commercial Billing &amp; Audit Exports
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Paystack GH₵ subscriptions, PDF custody forms, QR/barcode labels,
                and immutable workspace audit trails.
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right Sign-In / Workspace Signup Card */}
      <div className="flex-1 flex items-center justify-center p-5 pt-20 sm:p-10 lg:p-12">
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[460px] bg-[var(--av-surface)] border border-[var(--av-border)] rounded-xl p-7 sm:p-8 shadow-sm transition-colors duration-200"
        >
          <div className="border-b border-[var(--av-border-subtle)] pb-4">
            <div className="flex items-center gap-2.5 lg:hidden mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B82F6] text-white">
                <Server className="h-4 w-4" />
              </div>
              <span className="font-display text-base font-bold text-[var(--av-text)]">
                AssetVault IT
              </span>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[var(--av-surface-muted)] rounded-lg mb-4">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  authMode === 'signin'
                    ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                    : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  authMode === 'register'
                    ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                    : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                }`}
              >
                Create Workspace (14-Day Trial)
              </button>
            </div>

            <h2 className="font-display text-xl font-bold text-[var(--av-text)] tracking-tight">
              {authMode === 'signin'
                ? 'Sign in to workspace'
                : 'Provision new SaaS workspace'}
            </h2>
            <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
              {authMode === 'signin'
                ? 'Authenticate with your corporate credentials or SSO provider.'
                : 'Launch a Company or MSP multi-client workspace with a 14-day free trial.'}
            </p>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-4 rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 leading-relaxed"
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
            {authMode === 'register' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <UserIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--av-accent)]" />
                      <input
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder="Ama Mensah"
                        className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3 py-2 text-sm text-[var(--av-text)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                      Organisation Name
                    </label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-teal-500" />
                      <input
                        type="text"
                        required
                        value={regCompany}
                        onChange={(e) => setRegCompany(e.target.value)}
                        placeholder="GoldCoast Systems Ltd"
                        className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3 py-2 text-sm text-[var(--av-text)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Operating Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRegTenantType('company')}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        regTenantType === 'company'
                          ? 'border-[var(--av-accent)] bg-[var(--av-accent-soft)] text-[var(--av-text)] font-semibold'
                          : 'border-[var(--av-border)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]'
                      }`}
                    >
                      <Building2 className="h-3.5 w-3.5 text-[var(--av-accent)] shrink-0" />
                      <span>Company IT</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegTenantType('msp')}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        regTenantType === 'msp'
                          ? 'border-[var(--av-accent)] bg-[var(--av-accent-soft)] text-[var(--av-text)] font-semibold'
                          : 'border-[var(--av-border)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]'
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5 text-teal-500 shrink-0" />
                      <span>MSP Multi-Client</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                    Trial Plan (GH₵)
                  </label>
                  <select
                    value={regPlanCode}
                    onChange={(e) => setRegPlanCode(e.target.value as PlanCode)}
                    className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
                  >
                    {publicPlans.length > 0 ? (
                      publicPlans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name} — GH₵{p.monthlyPriceGhs.toLocaleString()}/mo
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="starter">Starter — GH₵149/mo</option>
                        <option value="professional">
                          Professional — GH₵349/mo
                        </option>
                        <option value="business">Business — GH₵699/mo</option>
                        <option value="enterprise">
                          Enterprise — GH₵1,499/mo
                        </option>
                      </>
                    )}
                  </select>
                </div>
              </>
            )}

            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5"
              >
                Work Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6] dark:text-blue-400" />
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
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Password
                </label>
                {authMode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(email);
                      setResetMessage(null);
                      setResetStep('request');
                      setResetOpen(true);
                    }}
                    className="text-[11px] font-medium text-[var(--av-accent)] hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-500 dark:text-indigo-400" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    authMode === 'signin' ? 'current-password' : 'new-password'
                  }
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    authMode === 'signin'
                      ? 'Enter your password'
                      : 'Minimum 8 characters'
                  }
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
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>
                {loading
                  ? authMode === 'signin'
                    ? 'Verifying credentials...'
                    : 'Provisioning workspace...'
                  : authMode === 'signin'
                    ? 'Sign In'
                    : 'Start 14-Day Free Trial'}
              </span>
              {!loading && <ArrowRight className="h-4 w-4" />}
            </motion.button>
          </form>

          {authMode === 'signin' && (
            <>
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
                  <span
                    className="gsi-material-button-icon h-4 w-4 shrink-0"
                    aria-hidden="true"
                  >
                    {googleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--av-accent)]" />
                    ) : (
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
                    )}
                  </span>
                  <span className="gsi-material-button-contents whitespace-nowrap">
                    {googleLoading ? 'Connecting...' : 'Google'}
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
                    {githubLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--av-accent)]" />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="block h-full w-full"
                      >
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
                      </svg>
                    )}
                  </span>
                  <span className="whitespace-nowrap">
                    {githubLoading ? 'Connecting...' : 'GitHub'}
                  </span>
                </motion.button>
              </div>
            </>
          )}

          <div className="mt-5 border-t border-[var(--av-border-subtle)] pt-3.5">
            <p className="text-xs leading-relaxed text-[var(--av-text-subtle)]">
              Authorized access only. Sign in with your administrator, IT staff,
              Google, or GitHub account, or create a new Company / MSP workspace.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Password Reset Modal */}
      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[var(--av-accent)]" />
                <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                  Reset Account Password
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="rounded-md p-1 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {resetMessage && (
              <div className="mt-3 rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-200 break-all">
                {resetMessage}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="mt-4 space-y-3">
              {resetStep === 'request' ? (
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                    Registered Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)]"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                      Reset Token
                    </label>
                    <input
                      type="text"
                      required
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 font-mono text-xs text-[var(--av-text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                      New Password (min 8 chars)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={resetNewPass}
                      onChange={(e) => setResetNewPass(e.target.value)}
                      className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)]"
                    />
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="rounded-lg border border-[var(--av-border)] px-3.5 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                >
                  {resetLoading
                    ? 'Processing...'
                    : resetStep === 'request'
                      ? 'Send Reset Instructions'
                      : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
