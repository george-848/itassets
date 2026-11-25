import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  UserCheck,
  Wrench,
} from 'lucide-react';
import type { AssetStatus, MaintenanceStatus } from '../types/itams.ts';

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatCurrencyExact(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatGhs(amount: number): string {
  return `GH₵${new Intl.NumberFormat('en-GH', {
    maximumFractionDigits: 0,
  }).format(amount || 0)}`;
}

export function formatGhsExact(amount: number): string {
  return `GH₵${new Intl.NumberFormat('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0)}`;
}

export function AssetStatusIndicator({ status }: { status: AssetStatus }) {
  switch (status) {
    case 'Available':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Available</span>
        </span>
      );
    case 'Assigned':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
          <UserCheck className="h-3.5 w-3.5 shrink-0" />
          <span>Assigned</span>
        </span>
      );
    case 'Under Maintenance':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span>Under Maintenance</span>
        </span>
      );
    case 'Damaged':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Damaged</span>
        </span>
      );
    case 'Retired':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
          <Archive className="h-3.5 w-3.5 shrink-0" />
          <span>Retired</span>
        </span>
      );
  }
}

export function MaintenanceStatusIndicator({
  status,
}: {
  status: MaintenanceStatus;
}) {
  switch (status) {
    case 'Completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Completed</span>
        </span>
      );
    case 'In Progress':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span>In Progress</span>
        </span>
      );
    case 'Scheduled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400 whitespace-nowrap">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Scheduled</span>
        </span>
      );
  }
}
