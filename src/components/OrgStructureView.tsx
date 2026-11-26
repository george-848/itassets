import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Building2, Layers, MapPin, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type {
  ClientOrganisation,
  DepartmentItem,
  LocationItem,
} from '../types/saas.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface OrgStructureViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

type OrgTab = 'organisations' | 'locations' | 'departments';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

function isBlockedErr(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

export function OrgStructureView({
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: OrgStructureViewProps) {
  const [tab, setTab] = useState<OrgTab>('organisations');
  const [loading, setLoading] = useState(true);
  const [organisations, setOrganisations] = useState<ClientOrganisation[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);

  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgCode, setOrgCode] = useState('');
  const [orgIndustry, setOrgIndustry] = useState('Enterprise IT');
  const [orgEmail, setOrgEmail] = useState('');

  const [locModalOpen, setLocModalOpen] = useState(false);
  const [locName, setLocName] = useState('');
  const [locCode, setLocCode] = useState('');
  const [locCity, setLocCity] = useState('Accra');
  const [locCountry, setLocCountry] = useState('Ghana');

  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptManager, setDeptManager] = useState('');
  const [deptCostCenter, setDeptCostCenter] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'org'; item: ClientOrganisation }
    | { kind: 'location'; item: LocationItem }
    | { kind: 'department'; item: DepartmentItem }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const hasMspMode = !tenantCtx || tenantCtx.effectiveFeatures.includes('msp_mode');
  const canManage = !isReadOnly && (tenantCtx?.permissions.includes('org.manage') ?? false);

  const loadOrgs = async () => {
    setLoading(true);
    try {
      const res = await api.listOrgs();
      setOrganisations(res.organisations);
      setLocations(res.locations);
      setDepartments(res.departments);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load org structure.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrgs();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id]);

  const handleBlocked = (err: unknown, fallback: string) => {
    if (isBlockedErr(err) && onPlanBlocked) {
      onPlanBlocked(err);
      return;
    }
    onToast('error', err instanceof ApiError ? err.message : fallback);
  };

  const handleCreateOrg = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createClientOrg({
        name: orgName.trim(),
        code: orgCode.trim().toUpperCase(),
        industry: orgIndustry.trim(),
        contactEmail: orgEmail.trim(),
      });
      onToast('success', `Client organisation ${orgName.trim()} created.`);
      setOrgModalOpen(false);
      setOrgName('');
      setOrgCode('');
      setOrgEmail('');
      await Promise.all([loadOrgs(), onRefresh()]);
    } catch (err) {
      setOrgModalOpen(false);
      handleBlocked(err, 'Failed to create client organisation.');
    }
  };

  const handleCreateLoc = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createLocation({
        name: locName.trim(),
        code: locCode.trim().toUpperCase(),
        city: locCity.trim(),
        country: locCountry.trim(),
      });
      onToast('success', `Location ${locName.trim()} added.`);
      setLocModalOpen(false);
      setLocName('');
      setLocCode('');
      await Promise.all([loadOrgs(), onRefresh()]);
    } catch (err) {
      setLocModalOpen(false);
      handleBlocked(err, 'Failed to add location.');
    }
  };

  const handleCreateDept = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createDepartment({
        name: deptName.trim(),
        code: deptCode.trim().toUpperCase(),
        managerName: deptManager.trim(),
        costCenter: deptCostCenter.trim(),
      });
      onToast('success', `Department ${deptName.trim()} added.`);
      setDeptModalOpen(false);
      setDeptName('');
      setDeptCode('');
      await Promise.all([loadOrgs(), onRefresh()]);
    } catch (err) {
      setDeptModalOpen(false);
      handleBlocked(err, 'Failed to add department.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'org') {
        await api.deleteClientOrg(deleteTarget.item.id);
        onToast('success', `Client organisation "${deleteTarget.item.name}" deleted.`);
      } else if (deleteTarget.kind === 'location') {
        await api.deleteLocation(deleteTarget.item.id);
        onToast('success', `Site / location "${deleteTarget.item.name}" deleted.`);
      } else {
        await api.deleteDepartment(deleteTarget.item.id);
        onToast('success', `Department "${deleteTarget.item.name}" deleted.`);
      }
      setDeleteTarget(null);
      await Promise.all([loadOrgs(), onRefresh()]);
    } catch (err) {
      setDeleteTarget(null);
      handleBlocked(err, 'Failed to delete record.');
    } finally {
      setDeleting(false);
    }
  };

  const limits = tenantCtx?.effectiveLimits;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              {
                id: 'organisations',
                label: `Client Organisations (${organisations.length}${
                  limits?.maxClientOrgs ? `/${limits.maxClientOrgs}` : ''
                })`,
                icon: Building2,
              },
              {
                id: 'locations',
                label: `Locations (${locations.length}${
                  limits?.maxLocations ? `/${limits.maxLocations}` : ''
                })`,
                icon: MapPin,
              },
              {
                id: 'departments',
                label: `Departments (${departments.length})`,
                icon: Layers,
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  tab === item.id
                    ? 'bg-[var(--av-accent)] text-white'
                    : 'bg-[var(--av-surface-muted)] text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {canManage && (tab !== 'organisations' || hasMspMode) && (
          <button
            type="button"
            onClick={() => {
              if (tab === 'organisations') setOrgModalOpen(true);
              if (tab === 'locations') setLocModalOpen(true);
              if (tab === 'departments') setDeptModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            <span>
              {tab === 'organisations'
                ? 'Add Client Org'
                : tab === 'locations'
                  ? 'Add Location'
                  : 'Add Department'}
            </span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-10 text-center text-xs text-[var(--av-text-subtle)]">
          Loading organisation hierarchy...
        </div>
      ) : tab === 'organisations' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {organisations.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No client organisations"
              description="Manage internal subsidiaries or MSP client accounts."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Organisation Name</th>
                    <th className="py-3 px-4">Industry</th>
                    <th className="py-3 px-4">Primary Contact</th>
                    <th className="py-3 px-4">Status</th>
                    {canManage && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {organisations.map((org) => (
                    <tr key={org.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4 font-mono font-bold text-[var(--av-accent)]">
                        {org.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--av-text)]">
                        {org.name}
                      </td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">{org.industry}</td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">
                        {org.contactEmail || org.contactName || '—'}
                      </td>
                      <td className="py-3 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                        {org.status}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            disabled={organisations.length <= 1}
                            onClick={() => setDeleteTarget({ kind: 'org', item: org })}
                            title={
                              organisations.length <= 1
                                ? 'Cannot delete the only organisation in this workspace'
                                : 'Delete client organisation'
                            }
                            className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'locations' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {locations.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No locations defined"
              description="Define regional offices, server rooms, and data centres."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Location Name</th>
                    <th className="py-3 px-4">City / Country</th>
                    <th className="py-3 px-4">Status</th>
                    {canManage && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {locations.map((loc) => (
                    <tr key={loc.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4 font-mono font-bold text-[var(--av-accent)]">
                        {loc.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--av-text)]">
                        {loc.name}
                      </td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">
                        {loc.city}, {loc.country}
                      </td>
                      <td className="py-3 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                        {loc.status}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ kind: 'location', item: loc })}
                            title="Delete site / location"
                            className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {departments.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No departments defined"
              description="Track cost centers and department leads across your workspace."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Manager</th>
                    <th className="py-3 px-4">Cost Center</th>
                    {canManage && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {departments.map((d) => (
                    <tr key={d.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4 font-mono font-bold text-[var(--av-accent)]">
                        {d.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--av-text)]">{d.name}</td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">
                        {d.managerName || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[var(--av-text-subtle)]">
                        {d.costCenter || '—'}
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ kind: 'department', item: d })}
                            title="Delete department"
                            className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Create Client Org Modal */}
      <AnimatePresence>
        {orgModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Add Client Organisation
                </h3>
                <button type="button" onClick={() => setOrgModalOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateOrg} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Organisation Name (e.g. Horizon Logistics)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
                    placeholder="Code (e.g. HRZ)"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <input
                    type="text"
                    value={orgIndustry}
                    onChange={(e) => setOrgIndustry(e.target.value)}
                    placeholder="Industry"
                    className={INPUT_CLASS}
                  />
                </div>
                <input
                  type="email"
                  value={orgEmail}
                  onChange={(e) => setOrgEmail(e.target.value)}
                  placeholder="it-contact@client.com"
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setOrgModalOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Create Organisation
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Location Modal */}
      <AnimatePresence>
        {locModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Add Location
                </h3>
                <button type="button" onClick={() => setLocModalOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateLoc} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="Location Name (e.g. Tema Port Hub)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    required
                    value={locCode}
                    onChange={(e) => setLocCode(e.target.value.toUpperCase())}
                    placeholder="Code"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <input
                    type="text"
                    value={locCity}
                    onChange={(e) => setLocCity(e.target.value)}
                    placeholder="City"
                    className={INPUT_CLASS}
                  />
                  <input
                    type="text"
                    value={locCountry}
                    onChange={(e) => setLocCountry(e.target.value)}
                    placeholder="Country"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setLocModalOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Location
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Department Modal */}
      <AnimatePresence>
        {deptModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Add Department
                </h3>
                <button type="button" onClick={() => setDeptModalOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateDept} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="Department Name"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={deptCode}
                    onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
                    placeholder="Code (e.g. ENG)"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <input
                    type="text"
                    value={deptCostCenter}
                    onChange={(e) => setDeptCostCenter(e.target.value)}
                    placeholder="Cost Center (CC-104)"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>
                <input
                  type="text"
                  value={deptManager}
                  onChange={(e) => setDeptManager(e.target.value)}
                  placeholder="Department Lead / Manager"
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeptModalOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Department
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.kind === 'org'
            ? 'Delete Client Organisation'
            : deleteTarget?.kind === 'location'
              ? 'Delete Site / Location'
              : 'Delete Department'
        }
        description={
          deleteTarget?.kind === 'org'
            ? `Permanently delete client organisation "${deleteTarget.item.name}" (${deleteTarget.item.code})? Deletion is blocked if assets, employees, tickets, contracts, or licences remain linked.`
            : deleteTarget?.kind === 'location'
              ? `Permanently delete site / location "${deleteTarget.item.name}" (${deleteTarget.item.code})? Deletion is blocked if any assets or employees reference this site.`
              : `Permanently delete department "${deleteTarget?.item.name}" (${deleteTarget?.item.code})?`
        }
        confirmLabel={
          deleteTarget?.kind === 'org'
            ? 'Delete Organisation'
            : deleteTarget?.kind === 'location'
              ? 'Delete Site'
              : 'Delete Department'
        }
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
