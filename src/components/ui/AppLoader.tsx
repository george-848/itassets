import { motion } from 'motion/react';
import { Server } from 'lucide-react';

interface AppLoaderProps {
  label?: string;
}

export function AppLoader({
  label = 'Initializing IT asset workspace...',
}: AppLoaderProps) {
  return (
    <div
      className="min-h-screen bg-[var(--av-bg)] av-grid-surface flex flex-col items-center justify-center px-6 transition-colors duration-200"
      role="status"
      aria-live="polite"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center"
      >
        {/* Dual Orbital Spinner Around Brand Emblem */}
        <div className="relative flex h-20 w-20 items-center justify-center">
          {/* Outer Cobalt Ring */}
          <motion.svg
            viewBox="0 0 80 80"
            className="absolute inset-0 h-full w-full"
            animate={{ rotate: 360 }}
            transition={{
              repeat: Infinity,
              duration: 1.5,
              ease: 'linear',
            }}
          >
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="var(--av-border)"
              strokeWidth="2.5"
            />
            <circle
              cx="40"
              cy="40"
              r="36"
              fill="none"
              stroke="#3B66F6"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="72 160"
            />
          </motion.svg>

          {/* Inner Mint Teal Counter-Rotating Arc */}
          <motion.svg
            viewBox="0 0 64 64"
            className="absolute inset-2 h-16 w-16"
            animate={{ rotate: -360 }}
            transition={{
              repeat: Infinity,
              duration: 2.2,
              ease: 'linear',
            }}
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="#1AB394"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="36 140"
              strokeOpacity="0.85"
            />
          </motion.svg>

          {/* Center Emblem */}
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{
              repeat: Infinity,
              duration: 2,
              ease: 'easeInOut',
            }}
            className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[#080D21] text-white shadow-[0_8px_20px_-4px_rgba(59,102,246,0.4)] border border-white/10"
          >
            <Server className="h-5 w-5 text-[#60A5FA]" />
          </motion.div>
        </div>

        <h2 className="mt-5 font-display text-lg font-bold tracking-tight text-[var(--av-text)]">
          AssetVault IT
        </h2>
        <p className="mt-1 text-xs font-medium text-[var(--av-text-subtle)]">
          {label}
        </p>

        {/* Smooth Sweeping Progress Bar */}
        <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-[var(--av-surface-muted)] border border-[var(--av-border)]">
          <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-[#3B66F6] to-[#1AB394] av-progress-sweep" />
        </div>
      </motion.div>
    </div>
  );
}
