import type { CurrencyCode } from '../types/saas.ts';

let activeCurrencyCode: CurrencyCode = 'USD';

export function setWorkspaceCurrency(code?: CurrencyCode | null): void {
  if (code === 'USD' || code === 'GHS' || code === 'EUR' || code === 'GBP') {
    activeCurrencyCode = code;
  } else {
    activeCurrencyCode = 'USD';
  }
}

export function getWorkspaceCurrency(): CurrencyCode {
  return activeCurrencyCode;
}

const CURRENCY_LOCALES: Record<CurrencyCode, string> = {
  USD: 'en-US',
  GHS: 'en-GH',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

export function formatWorkspaceMoney(
  amount: number,
  options?: { exact?: boolean; currency?: CurrencyCode }
): string {
  const code = options?.currency ?? activeCurrencyCode;
  const exact = options?.exact ?? false;
  const val = Number(amount || 0);

  if (code === 'GHS') {
    const formatted = new Intl.NumberFormat('en-GH', {
      minimumFractionDigits: exact ? 2 : 0,
      maximumFractionDigits: exact ? 2 : 0,
    }).format(val);
    return `GH₵${formatted}`;
  }

  return new Intl.NumberFormat(CURRENCY_LOCALES[code] || 'en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: exact ? 2 : 0,
    maximumFractionDigits: exact ? 2 : 0,
  }).format(val);
}
