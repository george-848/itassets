import { useEffect, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  formatter?: (val: number) => string;
  durationMs?: number;
}

export function AnimatedNumber({
  value,
  formatter,
  durationMs = 420,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setDisplay(value);
      return;
    }

    const startVal = display;
    const diff = value - startVal;
    if (diff === 0) return;

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(startVal + diff * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, durationMs]);

  return <>{formatter ? formatter(display) : display}</>;
}
