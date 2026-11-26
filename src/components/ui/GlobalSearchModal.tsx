import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  HardDrive,
  Search,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type {
  Asset,
  Employee,
  MaintenanceLog,
} from '../../types/itams.ts';
import type { FeatureKey, PermissionCode } from '../../types/saas.ts';
import type { NavSection } from '../DashboardView.tsx';

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  assets: Asset[];
  employees: Employee[];
  maintenanceLogs: MaintenanceLog[];
  userRole: 'admin' | 'staff';
  permissions?: PermissionCode[];
  effectiveFeatures?: FeatureKey[];
  isSuperAdmin?: boolean;
  onOpenAsset: (assetId: string) => void;
  onNavigate: (section: NavSection) => void;
}

export function GlobalSearchModal({
  open,
  onClose,
  assets,
  employees,
  maintenanceLogs,
  userRole,
  permissions = [],
  effectiveFeatures = [],
  isSuperAdmin = false,
  onOpenAsset,
  onNavigate,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
      } else if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hasPerm = (p: PermissionCode) =>
      permissions.length === 0 ? userRole === 'admin' : permissions.includes(p);
    const hasFeature = (f: FeatureKey) =>
      effectiveFeatures.length === 0 ? true : effectiveFeatures.includes(f);

    const matchedAssets = assets
      .filter((a) => {
        if (!q) return true;
        return (
          a.asset_tag.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.serial_number.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          (a.assigned_employee_name || '').toLowerCase().includes(q)
        );
      })
      .slice(0, q ? 5 : 4);

    const matchedEmployees = employees
      .filter((e) => {
        if (!q) return false;
        return (
          e.full_name.toLowerCase().includes(q) ||
          e.employee_code.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q)
        );
      })
      .slice(0, 4);

    const matchedMaintenance = maintenanceLogs
      .filter((m) => {
        if (!q) return false;
        return (
          (m.asset_tag || '').toLowerCase().includes(q) ||
          m.issue_description.toLowerCase().includes(q) ||
          m.vendor_or_technician.toLowerCase().includes(q)
        );
      })
      .slice(0, 3);

    const allShortcuts: Array<{
      id: NavSection;
      label: string;
      desc: string;
      visible: boolean;
    }> = [
      { id: 'dashboard', label: 'Dashboard', desc: 'Executive overview & charts', visible: true },
      { id: 'assets', label: 'Asset Inventory', desc: 'Hardware, QR/barcode, depreciation & transfers', visible: hasPerm('assets.read') || true },
      { id: 'employees', label: 'Employees', desc: 'Staff directory & custody', visible: hasPerm('employees.read') },
      { id: 'assignments', label: 'Assignments & Returns', desc: 'Issue or return equipment', visible: hasPerm('assignments.read') },
      { id: 'maintenance', label: 'Maintenance', desc: 'Service tickets & repairs', visible: hasPerm('maintenance.read') },
      { id: 'licences', label: 'Software & Licences', desc: 'Seat tracking & renewals', visible: hasPerm('licences.read') && hasFeature('software_licences') },
      { id: 'tickets', label: 'Helpdesk Tickets', desc: 'Support queue & SLA timers', visible: hasPerm('tickets.read') && hasFeature('helpdesk') },
      { id: 'itsm', label: 'ITSM Suite', desc: 'Incidents, problems, CAB changes & catalogue', visible: hasPerm('itsm.read') && hasFeature('itsm_suite') },
      { id: 'sla_contracts', label: 'SLA & Contracts', desc: 'SLA targets & client retainers', visible: (hasPerm('sla.read') || hasPerm('contracts.read')) && hasFeature('sla_automation') },
      { id: 'kb', label: 'Knowledge Base', desc: 'Self-service guides & internal runbooks', visible: hasPerm('kb.read') && hasFeature('knowledge_base') },
      { id: 'procurement', label: 'Procurement', desc: 'Vendors, purchase requests & PO receiving', visible: hasPerm('procurement.read') && hasFeature('procurement') },
      { id: 'reports', label: 'Reports & Exports', desc: 'PDF & Excel audit exports', visible: hasPerm('reports.read') },
      { id: 'notifications', label: 'Notifications', desc: 'Warranty, SLA & licence alerts', visible: true },
      { id: 'audit_logs', label: 'Audit Logs', desc: 'Immutable workspace activity trail', visible: hasPerm('audit.read') && hasFeature('audit_logs') },
      { id: 'org_structure', label: 'Org Structure', desc: 'Client orgs, locations & departments', visible: hasPerm('org.read') },
      { id: 'users', label: 'User Management', desc: 'Accounts, roles & invitations', visible: hasPerm('users.read') },
      { id: 'billing', label: 'Subscription & Billing', desc: 'GH₵ plans, Paystack & invoices', visible: hasPerm('billing.read') },
      { id: 'super_admin', label: 'Super Admin Console', desc: 'Platform tenants, MRR & plan governance', visible: isSuperAdmin },
    ];

    const navShortcuts = allShortcuts
      .filter((n) => n.visible)
      .filter(
        (n) =>
          !q ||
          n.label.toLowerCase().includes(q) ||
          n.desc.toLowerCase().includes(q)
      );

    return { matchedAssets, matchedEmployees, matchedMaintenance, navShortcuts };
  }, [query, assets, employees, maintenanceLogs, userRole, permissions, effectiveFeatures, isSuperAdmin]);

  const hasAny =
    results.matchedAssets.length > 0 ||
    results.matchedEmployees.length > 0 ||
    results.matchedMaintenance.length > 0 ||
    results.navShortcuts.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 backdrop-blur-xs p-4 pt-[10vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Global workspace search"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 border-b border-[var(--av-border)] px-4 py-3">
              <Search className="h-4 w-4 text-[var(--av-text-subtle)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search assets, serials, employees, tickets, or modules..."
                className="flex-1 bg-transparent text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                aria-label="Close search"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto divide-y divide-[var(--av-border-subtle)]">
              {!hasAny ? (
                <div className="py-12 text-center text-xs text-[var(--av-text-subtle)]">
                  No matching assets, employees, or modules found for "{query}".
                </div>
              ) : (
                <>
                  {results.matchedAssets.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--av-text-subtle)]">
                        Assets
                      </div>
                      {results.matchedAssets.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            onOpenAsset(a.id);
                            onClose();
                          }}
                          className="w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--av-surface-hover)] transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <HardDrive className="h-4 w-4 text-[var(--av-accent)] shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                                <span className="font-mono text-[var(--av-accent)]">
                                  {a.asset_tag}
                                </span>{' '}
                                · {a.name}
                              </div>
                              <div className="text-[11px] text-[var(--av-text-subtle)] truncate">
                                {a.category} · SN: {a.serial_number} · {a.status}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--av-text-subtle)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}

                  {results.matchedEmployees.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--av-text-subtle)]">
                        Employees
                      </div>
                      {results.matchedEmployees.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => {
                            onNavigate('employees');
                            onClose();
                          }}
                          className="w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--av-surface-hover)] transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Users className="h-4 w-4 text-[var(--av-teal)] shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                                {emp.full_name} ({emp.employee_code})
                              </div>
                              <div className="text-[11px] text-[var(--av-text-subtle)] truncate">
                                {emp.department} · {emp.job_title}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--av-text-subtle)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}

                  {results.matchedMaintenance.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--av-text-subtle)]">
                        Maintenance Tickets
                      </div>
                      {results.matchedMaintenance.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            onNavigate('maintenance');
                            onClose();
                          }}
                          className="w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--av-surface-hover)] transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Wrench className="h-4 w-4 text-amber-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                                {m.asset_tag} · {m.issue_description}
                              </div>
                              <div className="text-[11px] text-[var(--av-text-subtle)] truncate">
                                {m.maintenance_type} · {m.status}
                              </div>
                            </div>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--av-text-subtle)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}

                  {results.navShortcuts.length > 0 && (
                    <div className="p-2">
                      <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--av-text-subtle)]">
                        Workspace Modules
                      </div>
                      {results.navShortcuts.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onNavigate(item.id);
                            onClose();
                          }}
                          className="w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--av-surface-hover)] transition-colors"
                        >
                          <div className="text-xs">
                            <span className="font-semibold text-[var(--av-text)]">
                              {item.label}
                            </span>
                            <span className="ml-2 text-[var(--av-text-subtle)]">
                              {item.desc}
                            </span>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--av-text-subtle)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-4 py-2 text-[11px] text-[var(--av-text-subtle)]">
              <span>Search across inventory, custody, and maintenance</span>
              <span className="font-mono">ESC to close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
