import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Crown,
  FileBarChart2,
  FileCheck2,
  GitBranch,
  HardDrive,
  HelpCircle,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  Shield,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { AccountSecurityModal } from './components/AccountSecurityModal.tsx';
import { AssetsView } from './components/AssetsView.tsx';
import { AssignmentsView } from './components/AssignmentsView.tsx';
import { AuditLogsView } from './components/AuditLogsView.tsx';
import { DashboardView, type NavSection } from './components/DashboardView.tsx';
import { EmployeePortalView } from './components/EmployeePortalView.tsx';
import { EmployeesView } from './components/EmployeesView.tsx';
import { HelpdeskView } from './components/HelpdeskView.tsx';
import { IntegrationsAndAutomationView } from './components/IntegrationsAndAutomationView.tsx';
import { ItsmView } from './components/ItsmView.tsx';
import { KnowledgeBaseView } from './components/KnowledgeBaseView.tsx';
import { LoginView } from './components/LoginView.tsx';
import { MaintenanceView } from './components/MaintenanceView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { OrgStructureView } from './components/OrgStructureView.tsx';
import { ProcurementView } from './components/ProcurementView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { SlaAndContractsView } from './components/SlaAndContractsView.tsx';
import { SoftwareLicencesView } from './components/SoftwareLicencesView.tsx';
import { SubscriptionBillingView } from './components/SubscriptionBillingView.tsx';
import { SuperAdminView } from './components/SuperAdminView.tsx';
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx';
import { ToastContainer, type ToastMessage } from './components/Toast.tsx';
import { AppLoader } from './components/ui/AppLoader.tsx';
import { GlobalSearchModal } from './components/ui/GlobalSearchModal.tsx';
import { SupportModal } from './components/ui/SupportModal.tsx';
import { UsersView } from './components/UsersView.tsx';
import {
  api,
  ApiError,
  getStoredToken,
  setActiveOrgId,
  setActiveTenantId,
  setStoredToken,
  type ExtendedTenantContext,
  type ExtendedUser,
} from './lib/api.ts';
import { setWorkspaceCurrency } from './lib/currency.ts';
import { googleSignOut, initGoogleAuthListener } from './lib/googleAuth.ts';
import { useTheme } from './lib/theme.tsx';
import type {
  Asset,
  AssetAssignment,
  DashboardSummary,
  Employee,
  MaintenanceLog,
  SystemNotification,
  User,
} from './types/itams.ts';
import type {
  FeatureKey,
  PermissionCode,
  PurchaseOrder,
  SoftwareLicence,
  Ticket,
} from './types/saas.ts';

const SECTION_META: Record<
  NavSection,
  { group: string; label: string; subtitle: string }
> = {
  dashboard: {
    group: 'Core Operations',
    label: 'Dashboard',
    subtitle: 'Executive inventory overview, SLA health, and compliance alerts',
  },
  assets: {
    group: 'Core Operations',
    label: 'Asset Inventory',
    subtitle: 'Manage corporate hardware, QR/barcodes, depreciation, and lifecycle state',
  },
  employees: {
    group: 'Core Operations',
    label: 'Employees',
    subtitle: 'Organization directory, departments, and equipment custody history',
  },
  assignments: {
    group: 'Core Operations',
    label: 'Assignments & Handovers',
    subtitle: 'Issue, return, and generate signed PDF equipment handover records',
  },
  maintenance: {
    group: 'Core Operations',
    label: 'Maintenance',
    subtitle: 'Track hardware repairs, preventive service schedules, and costs',
  },
  licences: {
    group: 'Core Operations',
    label: 'Software Licences',
    subtitle: 'Seat allocations, masked/unmasked keys, and annual GH₵ renewals',
  },
  tickets: {
    group: 'Helpdesk & ITSM',
    label: 'IT Helpdesk',
    subtitle: 'Multi-tenant ticketing queue, SLA timers, internal notes, and CSAT',
  },
  employee_portal: {
    group: 'Helpdesk & ITSM',
    label: 'Self-Service Portal',
    subtitle: 'Assigned IT equipment, direct ticket intake, service catalogue, and help guides',
  },
  itsm: {
    group: 'Helpdesk & ITSM',
    label: 'ITSM Suite',
    subtitle: 'Incidents, service catalogue requests, problems (KEDB), and CAB changes',
  },
  sla_contracts: {
    group: 'Helpdesk & ITSM',
    label: 'SLAs & Contracts',
    subtitle: 'Response/resolution policies, vendor retainers, and automated compliance',
  },
  kb: {
    group: 'Helpdesk & ITSM',
    label: 'Knowledge Base',
    subtitle: 'Self-service portal guides and internal IT troubleshooting runbooks',
  },
  procurement: {
    group: 'Governance & Spend',
    label: 'Procurement',
    subtitle: 'Vendors, purchase requests, PO issuance, and automated asset receiving',
  },
  reports: {
    group: 'Governance & Spend',
    label: 'Reports & Exports',
    subtitle: 'Generate filterable inventory, depreciation, helpdesk, licence, and procurement exports',
  },
  notifications: {
    group: 'Governance & Spend',
    label: 'Notifications',
    subtitle: 'Expiring warranties, overdue maintenance, and SLA advisories',
  },
  audit_logs: {
    group: 'Governance & Spend',
    label: 'Audit Logs',
    subtitle: 'Immutable tenant activity stream across assets, tickets, and billing',
  },
  org_structure: {
    group: 'Workspace & Billing',
    label: 'Organisations & Sites',
    subtitle: 'Manage MSP client organisations, office locations, and departments',
  },
  users: {
    group: 'Workspace & Billing',
    label: 'Users & Access',
    subtitle: 'Manage role-based permissions, client scopes, and workspace invitations',
  },
  billing: {
    group: 'Workspace & Billing',
    label: 'Billing & Plans',
    subtitle: 'GH₵ subscription tiers, usage quotas, Paystack checkout, and invoices',
  },
  integrations: {
    group: 'Workspace & Billing',
    label: 'Settings, API & Automation',
    subtitle: 'Multi-currency, custom fields, API keys, outbound webhooks, and scheduled reports',
  },
  super_admin: {
    group: 'Platform Admin',
    label: 'Platform Console',
    subtitle: 'Cross-tenant governance, GH₵ plan pricing, payments, and system settings',
  },
};

const SIDEBAR_STORAGE_KEY = 'assetvault_sidebar_collapsed';

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const { isDark, toggleTheme } = useTheme();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<ExtendedUser | null>(null);
  const [tenantCtx, setTenantCtx] = useState<ExtendedTenantContext | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    readInitialSidebarCollapsed
  );

  // Header overlays
  const [searchOpen, setSearchOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [notifPopoverOpen, setNotifPopoverOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const [dataLoading, setDataLoading] = useState(false);
  const [dashboardSummary, setDashboardSummary] =
    useState<DashboardSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<AssetAssignment[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [users, setUsers] = useState<ExtendedUser[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [licences, setLicences] = useState<SoftwareLicence[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);

  // Plan quota / feature / read-only block modal
  const [blockedModalErr, setBlockedModalErr] = useState<ApiError | null>(null);

  // Cross-module contextual selection state
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assignPreselectAsset, setAssignPreselectAsset] =
    useState<Asset | null>(null);
  const [assignPreselectEmployee, setAssignPreselectEmployee] =
    useState<Employee | null>(null);
  const [maintPreselectAsset, setMaintPreselectAsset] =
    useState<Asset | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const pushToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handlePlanBlocked = useCallback((err: ApiError) => {
    setBlockedModalErr(err);
  }, []);

  // Global Cmd/Ctrl + K shortcut and outside-click handlers for dropdowns
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (!currentUser) return;
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifPopoverOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [currentUser]);

  const loadWorkspaceData = useCallback(
    async (user: User) => {
      setDataLoading(true);
      try {
        const ctx = await api.getContext();
        setTenantCtx(ctx);
        setWorkspaceCurrency(ctx.tenant.currency);
        setActiveTenantId(ctx.tenant.id);
        setActiveOrgId(ctx.isAllOrgsView ? 'all' : ctx.activeOrg.id);
        if (ctx.membership.role === 'employee') {
          setActiveSection((prev) => (prev === 'dashboard' ? 'employee_portal' : prev));
        }

        const perms = new Set<PermissionCode>(ctx.permissions);
        const features = new Set(ctx.effectiveFeatures);

        const [
          dashRes,
          assetsRes,
          empRes,
          asgRes,
          mntRes,
          notifRes,
          usersRes,
          ticketsRes,
          licencesRes,
          procRes,
        ] = await Promise.all([
          perms.has('dashboard.read')
            ? api.getDashboard().catch(() => null)
            : Promise.resolve(null),
          perms.has('assets.read')
            ? api.listAssets().catch(() => ({ assets: [] }))
            : Promise.resolve({ assets: [] }),
          perms.has('employees.read')
            ? api.listEmployees().catch(() => ({ employees: [] }))
            : Promise.resolve({ employees: [] }),
          perms.has('assignments.read')
            ? api.listAssignments().catch(() => ({ assignments: [] }))
            : Promise.resolve({ assignments: [] }),
          perms.has('maintenance.read')
            ? api.listMaintenance().catch(() => ({ maintenanceLogs: [] }))
            : Promise.resolve({ maintenanceLogs: [] }),
          api.listNotifications().catch(() => ({ notifications: [] })),
          perms.has('users.read') || user.role === 'admin'
            ? api.listUsers().catch(() => ({ users: [] }))
            : Promise.resolve({ users: [] }),
          perms.has('tickets.read') && features.has('helpdesk')
            ? api.listTickets().catch(() => ({ tickets: [] }))
            : Promise.resolve({ tickets: [] }),
          perms.has('licences.read') && features.has('software_licences')
            ? api.listLicences().catch(() => ({ licences: [], canViewKeys: false }))
            : Promise.resolve({ licences: [], canViewKeys: false }),
          perms.has('procurement.read') && features.has('procurement')
            ? api.getProcurement().catch(() => ({
                vendors: [],
                purchaseRequests: [],
                purchaseOrders: [],
              }))
            : Promise.resolve({
                vendors: [],
                purchaseRequests: [],
                purchaseOrders: [],
              }),
        ]);

        setDashboardSummary(dashRes);
        setAssets(assetsRes.assets);
        setEmployees(empRes.employees);
        setAssignments(asgRes.assignments);
        setMaintenanceLogs(mntRes.maintenanceLogs);
        setNotifications(notifRes.notifications);
        setUsers(usersRes.users);
        setTickets(ticketsRes.tickets);
        setLicences(licencesRes.licences);
        setPurchaseOrders(procRes.purchaseOrders);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setStoredToken(null);
          setActiveTenantId(null);
          setActiveOrgId(null);
          setCurrentUser(null);
          setTenantCtx(null);
        } else {
          pushToast(
            'error',
            err instanceof ApiError
              ? err.message
              : 'Failed to synchronize workspace data.'
          );
        }
      } finally {
        setDataLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    const unsubscribe = initGoogleAuthListener();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const token = getStoredToken();
      if (!token) {
        if (active) setAuthChecked(true);
        return;
      }
      try {
        const res = await api.me();
        if (!active) return;
        setCurrentUser(res.user);

        // Handle Paystack redirect callback (?paystack_ref=...)
        const params = new URLSearchParams(window.location.search);
        const paystackRef = params.get('paystack_ref') || params.get('reference');
        if (paystackRef) {
          try {
            await api.verifyPaystack(paystackRef);
            setActiveSection('billing');
            pushToast(
              'success',
              'Paystack payment verified and subscription updated.'
            );
          } catch (verifyErr) {
            setActiveSection('billing');
            pushToast(
              'error',
              verifyErr instanceof ApiError
                ? verifyErr.message
                : 'Unable to verify Paystack transaction.'
            );
          } finally {
            window.history.replaceState({}, '', window.location.pathname);
          }
        }

        await loadWorkspaceData(res.user);
      } catch {
        setStoredToken(null);
        setActiveTenantId(null);
        setActiveOrgId(null);
      } finally {
        if (active) setAuthChecked(true);
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, [loadWorkspaceData, pushToast]);

  const handleLoginSuccess = async (token: string, user: User) => {
    setStoredToken(token);
    setActiveTenantId(null);
    setActiveOrgId(null);
    setCurrentUser(user);
    setActiveSection('dashboard');
    await loadWorkspaceData(user);
    pushToast('success', `Signed in as ${user.name}.`);
  };

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    try {
      await Promise.allSettled([api.logout(), googleSignOut()]);
    } catch {
      // Ignore network errors on logout
    }
    setStoredToken(null);
    setActiveTenantId(null);
    setActiveOrgId(null);
    setCurrentUser(null);
    setTenantCtx(null);
    setDashboardSummary(null);
    setAssets([]);
    setEmployees([]);
    setAssignments([]);
    setMaintenanceLogs([]);
    setNotifications([]);
    setUsers([]);
    setTickets([]);
    setLicences([]);
    setPurchaseOrders([]);
  };

  const handleRefresh = useCallback(async () => {
    if (!currentUser) return;
    await loadWorkspaceData(currentUser);
  }, [currentUser, loadWorkspaceData]);

  const handleSwitchTenant = async (tenantId: string) => {
    if (!currentUser || tenantId === tenantCtx?.tenant.id) return;
    setActiveTenantId(tenantId);
    setActiveOrgId(null);
    setActiveSection('dashboard');
    await loadWorkspaceData(currentUser);
    pushToast('success', 'Switched tenant workspace.');
  };

  const handleSwitchOrg = async (orgId: string) => {
    if (!currentUser) return;
    setActiveOrgId(orgId);
    await loadWorkspaceData(currentUser);
    pushToast(
      'success',
      orgId === 'all' ? 'Viewing all MSP client organisations.' : 'Switched client organisation scope.'
    );
  };

  const permsSet = new Set<PermissionCode>(tenantCtx?.permissions ?? []);
  const featuresSet = new Set<FeatureKey>(tenantCtx?.effectiveFeatures ?? []);
  const hasPerm = (p: PermissionCode) =>
    permsSet.has(p) || Boolean(tenantCtx?.isSuperAdmin);
  const hasFeature = (f: FeatureKey) => !tenantCtx || featuresSet.has(f);

  const canAccessSection = (section: NavSection): boolean => {
    if (section === 'super_admin') return Boolean(tenantCtx?.isSuperAdmin);
    if (!tenantCtx) {
      return section !== 'users' || currentUser?.role === 'admin';
    }
    switch (section) {
      case 'dashboard':
        return hasPerm('dashboard.read');
      case 'assets':
        return hasPerm('assets.read');
      case 'employees':
        return hasPerm('employees.read');
      case 'assignments':
        return hasPerm('assignments.read');
      case 'maintenance':
        return hasPerm('maintenance.read');
      case 'licences':
        return hasPerm('licences.read') && hasFeature('software_licences');
      case 'tickets':
        return hasPerm('tickets.read') && hasFeature('helpdesk');
      case 'employee_portal':
        return hasPerm('tickets.create') || hasPerm('assets.read');
      case 'itsm':
        return hasPerm('itsm.read') && hasFeature('itsm_suite');
      case 'sla_contracts':
        return (hasPerm('sla.read') || hasPerm('contracts.read')) && hasFeature('sla_automation');
      case 'kb':
        return hasPerm('kb.read') && hasFeature('knowledge_base');
      case 'procurement':
        return hasPerm('procurement.read') && hasFeature('procurement');
      case 'reports':
        return hasPerm('reports.read');
      case 'notifications':
        return true;
      case 'audit_logs':
        return hasPerm('audit.read') && hasFeature('audit_logs');
      case 'org_structure':
        return hasPerm('org.read');
      case 'users':
        return hasPerm('users.read');
      case 'billing':
        return hasPerm('billing.read');
      case 'integrations':
        return hasPerm('org.manage') || hasPerm('billing.read');
      default:
        return true;
    }
  };

  useEffect(() => {
    if (!tenantCtx) return;
    if (!canAccessSection(activeSection)) {
      if (tenantCtx.membership.role === 'employee') {
        setActiveSection('employee_portal');
      } else if (canAccessSection('dashboard')) {
        setActiveSection('dashboard');
      } else if (canAccessSection('billing')) {
        setActiveSection('billing');
      } else {
        setActiveSection('notifications');
      }
    }
  }, [tenantCtx, activeSection]);

  const navigateTo = (section: NavSection) => {
    if (!canAccessSection(section)) {
      pushToast('error', 'Your current workspace role does not have access to this module.');
      return;
    }
    setActiveSection(section);
    setMobileMenuOpen(false);
    setNotifPopoverOpen(false);
    setProfileMenuOpen(false);
  };

  const handleOpenAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    setActiveSection('assets');
    setMobileMenuOpen(false);
    setNotifPopoverOpen(false);
  };

  const unreadAlerts = notifications.filter((n) => !n.acknowledged);
  const unreadCount = unreadAlerts.length;

  if (!authChecked) {
    return (
      <MotionConfig reducedMotion="user">
        <AppLoader label="Verifying session & loading workspace..." />
      </MotionConfig>
    );
  }

  if (!currentUser) {
    return (
      <MotionConfig reducedMotion="user">
        <LoginView onSuccess={handleLoginSuccess} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </MotionConfig>
    );
  }

  type NavGroupKey =
    | 'core'
    | 'helpdesk_itsm'
    | 'governance_spend'
    | 'workspace_billing'
    | 'platform_admin';

  type NavItem = {
    id: NavSection;
    label: string;
    icon: typeof LayoutDashboard;
    iconColor: string;
    group: NavGroupKey;
    badge?: number;
  };

  const openTicketCount = tickets.filter(
    (t) => t.status !== 'Resolved' && t.status !== 'Closed'
  ).length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, iconColor: 'text-sky-400', group: 'core' },
    { id: 'assets', label: 'Asset Inventory', icon: HardDrive, iconColor: 'text-indigo-400', group: 'core' },
    { id: 'employees', label: 'Employees', icon: Users, iconColor: 'text-teal-400', group: 'core' },
    { id: 'assignments', label: 'Assignments', icon: ArrowLeftRight, iconColor: 'text-violet-400', group: 'core' },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, iconColor: 'text-amber-400', group: 'core' },
    { id: 'licences', label: 'Software Licences', icon: KeyRound, iconColor: 'text-emerald-400', group: 'core' },

    {
      id: 'employee_portal',
      label: 'Self-Service Portal',
      icon: UserCheck,
      iconColor: 'text-emerald-400',
      group: 'helpdesk_itsm',
    },
    {
      id: 'tickets',
      label: 'IT Helpdesk',
      icon: LifeBuoy,
      iconColor: 'text-blue-400',
      group: 'helpdesk_itsm',
      badge: openTicketCount > 0 ? openTicketCount : undefined,
    },
    { id: 'itsm', label: 'ITSM Suite', icon: GitBranch, iconColor: 'text-purple-400', group: 'helpdesk_itsm' },
    { id: 'sla_contracts', label: 'SLAs & Contracts', icon: FileCheck2, iconColor: 'text-teal-400', group: 'helpdesk_itsm' },
    { id: 'kb', label: 'Knowledge Base', icon: BookOpen, iconColor: 'text-sky-400', group: 'helpdesk_itsm' },

    { id: 'procurement', label: 'Procurement', icon: ShoppingCart, iconColor: 'text-orange-400', group: 'governance_spend' },
    { id: 'reports', label: 'Reports & Exports', icon: FileBarChart2, iconColor: 'text-emerald-400', group: 'governance_spend' },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      iconColor: 'text-rose-400',
      group: 'governance_spend',
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'audit_logs', label: 'Audit Logs', icon: History, iconColor: 'text-slate-300', group: 'governance_spend' },

    { id: 'org_structure', label: 'Organisations & Sites', icon: Building2, iconColor: 'text-indigo-400', group: 'workspace_billing' },
    { id: 'users', label: 'Users & Access', icon: Shield, iconColor: 'text-cyan-400', group: 'workspace_billing' },
    { id: 'billing', label: 'Billing & Plans', icon: CreditCard, iconColor: 'text-emerald-400', group: 'workspace_billing' },
    { id: 'integrations', label: 'API & Automation', icon: SlidersHorizontal, iconColor: 'text-sky-400', group: 'workspace_billing' },

    { id: 'super_admin', label: 'Platform Admin', icon: Crown, iconColor: 'text-amber-400', group: 'platform_admin' },
  ];

  const visibleNavItems = navItems.filter((item) => canAccessSection(item.id));
  const allGroups: Array<{ key: NavGroupKey; title: string; items: NavItem[] }> = [
    { key: 'core', title: 'Core Operations', items: visibleNavItems.filter((i) => i.group === 'core') },
    { key: 'helpdesk_itsm', title: 'Helpdesk & ITSM', items: visibleNavItems.filter((i) => i.group === 'helpdesk_itsm') },
    { key: 'governance_spend', title: 'Governance & Spend', items: visibleNavItems.filter((i) => i.group === 'governance_spend') },
    { key: 'workspace_billing', title: 'Workspace & Billing', items: visibleNavItems.filter((i) => i.group === 'workspace_billing') },
    { key: 'platform_admin', title: 'Platform Admin', items: visibleNavItems.filter((i) => i.group === 'platform_admin') },
  ];
  const navGroups = allGroups.filter((g) => g.items.length > 0);

  const initials = currentUser.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const roleLabel =
    tenantCtx?.isSuperAdmin
      ? 'Platform Super Admin'
      : tenantCtx?.membership.role
        ? tenantCtx.membership.role.replace(/_/g, ' ')
        : currentUser.role === 'admin'
          ? 'Administrator'
          : 'IT Staff';

  const renderNavGroup = (
    items: NavItem[],
    scope: 'desktop' | 'mobile',
    collapsed: boolean
  ) =>
    items.map((item) => {
      const Icon = item.icon;
      const isActive = activeSection === item.id;
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => navigateTo(item.id)}
          title={collapsed ? item.label : undefined}
          aria-current={isActive ? 'page' : undefined}
          className={`group relative w-full flex items-center ${
            collapsed ? 'justify-center px-2.5' : 'justify-between px-3.5'
          } gap-3 rounded-xl py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
            isActive
              ? 'text-white'
              : 'text-slate-300/80 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          {isActive && (
            <motion.span
              layoutId={`sidebar-active-${scope}`}
              transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              className="absolute inset-0 rounded-xl bg-[#3B66F6] shadow-[0_8px_20px_-4px_rgba(59,102,246,0.5)]"
            />
          )}
          <span className="relative z-10 flex items-center gap-3 min-w-0">
            <Icon
              className={`h-4 w-4 shrink-0 transition-colors ${
                isActive
                  ? 'text-white'
                  : `${item.iconColor} group-hover:text-white`
              }`}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </span>
          {!collapsed && item.badge !== undefined && (
            <span
              className={`relative z-10 font-mono text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                isActive
                  ? 'bg-white/20 text-white'
                  : item.id === 'notifications'
                    ? 'bg-red-600 text-white'
                    : 'bg-white/15 text-slate-100'
              }`}
            >
              {item.badge}
            </span>
          )}
        </button>
      );
    });

  const renderSidebar = (scope: 'desktop' | 'mobile') => {
    const collapsed = scope === 'desktop' && sidebarCollapsed;
    return (
      <div className="relative flex h-full flex-col bg-[var(--av-sidebar)] text-[var(--av-sidebar-text)] overflow-hidden transition-colors duration-200">
        {/* Top Brand + Collapse Control */}
        <div
          className={`flex items-center ${
            collapsed ? 'justify-center px-3' : 'justify-between px-5'
          } h-16 shrink-0`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B66F6] text-white shrink-0 shadow-[0_4px_12px_rgba(59,102,246,0.4)]">
              <Server className="h-4 w-4" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-[16px] font-bold tracking-tight text-white whitespace-nowrap truncate leading-tight">
                  AssetVault
                </div>
                {tenantCtx && (
                  <div className="text-[10px] text-slate-400 truncate">
                    {tenantCtx.tenant.type === 'msp' ? 'MSP Console' : tenantCtx.plan.name}
                  </div>
                )}
              </div>
            )}
          </div>

          {scope === 'desktop' ? (
            !collapsed && (
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors shrink-0"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors"
              aria-label="Close navigation menu"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          )}
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3.5 py-2 space-y-4">
          {collapsed && scope === 'desktop' && (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          )}

          {navGroups.map((group) => (
            <div key={group.key}>
              {!collapsed && (
                <div className="px-3.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {renderNavGroup(group.items, scope, collapsed)}
              </div>
            </div>
          ))}

          {!collapsed && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setSupportOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-[13px] font-medium text-slate-300/80 hover:bg-white/[0.06] hover:text-white transition-colors whitespace-nowrap"
              >
                <HelpCircle className="h-4 w-4 shrink-0 text-sky-400" />
                <span>Help &amp; Shortcuts</span>
              </button>
            </div>
          )}
        </nav>

        {/* Bottom Appearance & Profile Section */}
        <div className="border-t border-[var(--av-sidebar-border)] p-3.5 bg-white/[0.015] space-y-3 shrink-0">
          <ThemeSwitcher variant="sidebar" collapsed={collapsed} />

          <div className="pt-2.5 border-t border-[var(--av-sidebar-border)]">
            <div
              className={`flex items-center ${
                collapsed ? 'justify-center' : 'gap-2.5'
              }`}
            >
              <div
                title={`${currentUser.name} (${currentUser.email})`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3B66F6]/25 border border-[#3B66F6]/40 font-display text-xs font-bold text-[#93C5FD]"
              >
                {initials}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">
                    {currentUser.name}
                  </div>
                  <div className="truncate text-[11px] text-slate-400 capitalize">
                    {roleLabel}
                  </div>
                </div>
              )}
            </div>

            {!collapsed && (
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.09] hover:text-white transition-colors"
              >
                <LogOut className="h-3.5 w-3.5 text-rose-400" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const meta = SECTION_META[activeSection];
  const sub = tenantCtx?.subscription;
  const trialDaysLeft = sub?.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400_000
        )
      )
    : 0;
  const showSubscriptionBanner =
    tenantCtx &&
    (tenantCtx.isReadOnlyGraceOrExpired ||
      sub?.status === 'trialing' ||
      sub?.status === 'grace_period');

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--av-bg)] text-[var(--av-text)] flex transition-colors duration-200 overflow-x-clip">
        {/* Live Workspace Sync Top Progress Bar */}
        <AnimatePresence>
          {dataLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed top-0 left-0 right-0 z-50 h-0.5 overflow-hidden bg-transparent pointer-events-none"
              aria-hidden="true"
            >
              <div className="h-full w-1/3 bg-gradient-to-r from-[#3B66F6] via-[#60A5FA] to-[#1AB394] av-progress-sweep" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsible Desktop Sidebar */}
        <aside
          className={`hidden lg:block shrink-0 border-r border-[var(--av-border)] sticky top-0 h-screen transition-[width] duration-200 ease-out ${
            sidebarCollapsed ? 'w-[72px]' : 'w-[258px]'
          }`}
        >
          {renderSidebar('desktop')}
        </aside>

        {/* Mobile Drawer Sidebar */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 flex lg:hidden">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
                onClick={() => setMobileMenuOpen(false)}
              />
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-72 max-w-[82vw] h-full z-10 shadow-2xl"
              >
                {renderSidebar('mobile')}
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        {/* Main Content Viewport */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top Navigation Header */}
          <header className="sticky top-0 z-30 h-16 border-b border-[var(--av-border)] bg-[var(--av-header-bg)] backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 transition-colors duration-200">
            {/* Left: Mobile Drawer Button + Global Search + Breadcrumb */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] transition-colors shrink-0"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex items-center justify-between gap-3 rounded-full border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs text-[var(--av-text-subtle)] shadow-[var(--av-card-shadow)] hover:border-[var(--av-accent)]/40 hover:text-[var(--av-text)] transition-all w-full max-w-[260px] sm:max-w-xs"
                aria-label="Search workspace"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Search className="h-3.5 w-3.5 text-[#3B66F6] shrink-0" />
                  <span className="truncate">Search assets, staff, modules...</span>
                </span>
                <kbd className="hidden sm:inline-block rounded-md border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--av-text-subtle)] shrink-0">
                  ⌘K
                </kbd>
              </button>

              <div className="hidden xl:flex items-center gap-1.5 text-xs text-[var(--av-text-subtle)] min-w-0 pl-1">
                <span className="font-medium whitespace-nowrap">
                  {meta.group}
                </span>
                <ChevronRight className="h-3.5 w-3.5 opacity-60 shrink-0" />
                <span className="font-display text-xs font-semibold text-[var(--av-text)] truncate">
                  {meta.label}
                </span>
              </div>
            </div>

            {/* Right: Workspace/Client Switchers, Theme Toggle, Alerts, Help, Profile */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Tenant Workspace Switcher (multi-tenant members / super admin) */}
              {tenantCtx && tenantCtx.availableTenants.length > 1 && (
                <select
                  aria-label="Switch workspace tenant"
                  value={tenantCtx.tenant.id}
                  onChange={(e) => handleSwitchTenant(e.target.value)}
                  className="hidden md:block max-w-[165px] rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--av-text)] focus:border-[var(--av-accent)] focus:outline-none"
                >
                  {tenantCtx.availableTenants.map((entry) => (
                    <option key={entry.tenant.id} value={entry.tenant.id}>
                      {entry.tenant.name} ({entry.tenant.type.toUpperCase()})
                    </option>
                  ))}
                </select>
              )}

              {/* MSP / Client Organisation Scope Switcher */}
              {tenantCtx &&
                (tenantCtx.tenant.type === 'msp' ||
                  tenantCtx.availableOrgs.length > 1) && (
                  <select
                    aria-label="Switch client organisation"
                    value={
                      tenantCtx.isAllOrgsView ? 'all' : tenantCtx.activeOrg.id
                    }
                    onChange={(e) => handleSwitchOrg(e.target.value)}
                    className="hidden sm:block max-w-[180px] rounded-lg border border-[#3B66F6]/30 bg-[#3B66F6]/10 px-2.5 py-1.5 text-xs font-semibold text-[#3B66F6] dark:text-sky-300 focus:border-[var(--av-accent)] focus:outline-none"
                  >
                    {tenantCtx.tenant.type === 'msp' &&
                      tenantCtx.membership.orgAccessMode === 'all' && (
                        <option value="all">All Client Orgs</option>
                      )}
                    {tenantCtx.availableOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.code})
                      </option>
                    ))}
                  </select>
                )}

              <ThemeSwitcher variant="icon" />

              {/* Notifications Dropdown */}
              <div ref={notifRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setNotifPopoverOpen((prev) => !prev);
                    setProfileMenuOpen(false);
                  }}
                  aria-label="Notifications"
                  aria-expanded={notifPopoverOpen}
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-amber-500 dark:text-amber-400 hover:bg-[var(--av-surface-hover)] transition-colors shrink-0"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold text-white tabular-nums">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {notifPopoverOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                      className="absolute right-0 mt-2 w-80 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-xl overflow-hidden z-40"
                    >
                      <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-4 py-3">
                        <span className="font-display text-xs font-semibold text-[var(--av-text)]">
                          Compliance Alerts ({unreadCount} unread)
                        </span>
                        <button
                          type="button"
                          onClick={() => navigateTo('notifications')}
                          className="text-xs font-semibold text-[var(--av-accent)] hover:underline"
                        >
                          View all
                        </button>
                      </div>
                      <div className="max-h-72 overflow-y-auto divide-y divide-[var(--av-border-subtle)]">
                        {unreadAlerts.length === 0 ? (
                          <div className="py-8 px-4 text-center text-xs text-[var(--av-text-subtle)]">
                            All system alerts are acknowledged.
                          </div>
                        ) : (
                          unreadAlerts.slice(0, 5).map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                if (n.entity_type === 'maintenance' && canAccessSection('maintenance')) {
                                  navigateTo('maintenance');
                                } else if (n.entity_type === 'ticket' && canAccessSection('tickets')) {
                                  navigateTo('tickets');
                                } else if (n.entity_type === 'licence' && canAccessSection('licences')) {
                                  navigateTo('licences');
                                } else if (n.entity_type === 'subscription' && canAccessSection('billing')) {
                                  navigateTo('billing');
                                } else if (n.asset_id && canAccessSection('assets')) {
                                  handleOpenAsset(n.asset_id);
                                } else {
                                  navigateTo('notifications');
                                }
                              }}
                              className="w-full px-4 py-3 text-left hover:bg-[var(--av-surface-hover)] transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`text-[11px] font-semibold ${
                                    n.severity === 'critical'
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {n.asset_tag}
                                </span>
                                <span className="font-mono text-[10px] text-[var(--av-text-subtle)] tabular-nums">
                                  {n.due_date}
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs font-medium text-[var(--av-text)] truncate">
                                {n.title}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => setSupportOpen(true)}
                title="Help & shortcuts"
                aria-label="Help and keyboard shortcuts"
                className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[#1AB394] hover:bg-[var(--av-surface-hover)] transition-colors shrink-0"
              >
                <HelpCircle className="h-4 w-4" />
              </button>

              {/* User Profile Avatar & Dropdown */}
              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen((prev) => !prev);
                    setNotifPopoverOpen(false);
                  }}
                  aria-expanded={profileMenuOpen}
                  aria-label="Account menu"
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] pl-1.5 pr-2.5 py-1 hover:bg-[var(--av-surface-hover)] transition-colors shrink-0"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#111827] dark:bg-[#3B82F6]/20 text-[11px] font-display font-bold text-white dark:text-[#93C5FD]">
                    {initials}
                  </div>
                  <span className="hidden md:inline text-xs font-semibold text-[var(--av-text)] max-w-[120px] truncate">
                    {currentUser.name}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-[var(--av-text-subtle)]" />
                </button>

                <AnimatePresence>
                  {profileMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.98 }}
                      transition={{ duration: 0.14 }}
                      className="absolute right-0 mt-2 w-64 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-xl overflow-hidden z-40"
                    >
                      <div className="border-b border-[var(--av-border-subtle)] px-4 py-3">
                        <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                          {currentUser.name}
                        </div>
                        <div className="text-[11px] text-[var(--av-text-subtle)] truncate">
                          {currentUser.email}
                        </div>
                        <div className="mt-1 text-[11px] font-medium text-[var(--av-accent)] capitalize truncate">
                          {roleLabel} · {currentUser.department}
                        </div>
                      </div>

                      <div className="p-1.5 space-y-0.5 text-xs">
                        <button
                          type="button"
                          onClick={toggleTheme}
                          className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            {isDark ? (
                              <Sun className="h-3.5 w-3.5 text-amber-400" />
                            ) : (
                              <Moon className="h-3.5 w-3.5 text-indigo-500" />
                            )}
                            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                          </span>
                        </button>

                        {canAccessSection('billing') && (
                          <button
                            type="button"
                            onClick={() => navigateTo('billing')}
                            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
                            <span>Billing &amp; Plan ({tenantCtx?.plan.name || 'Plan'})</span>
                          </button>
                        )}

                        {canAccessSection('users') && (
                          <button
                            type="button"
                            onClick={() => navigateTo('users')}
                            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <Shield className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                            <span>Users &amp; Access</span>
                          </button>
                        )}

                        {tenantCtx?.isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => navigateTo('super_admin')}
                            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <Crown className="h-3.5 w-3.5 text-amber-500" />
                            <span>Platform Admin Console</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setSecurityModalOpen(true);
                          }}
                          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                        >
                          <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                          <span>Security &amp; 2FA</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setSupportOpen(true);
                          }}
                          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                        >
                          <HelpCircle className="h-3.5 w-3.5 text-[#1AB394]" />
                          <span>Help &amp; Shortcuts</span>
                        </button>
                      </div>

                      <div className="border-t border-[var(--av-border-subtle)] p-1.5">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>

          {/* Subscription Trial / Grace / Read-Only Banner */}
          {showSubscriptionBanner && (
            <div
              className={`border-b px-4 sm:px-6 lg:px-8 py-2 text-xs flex flex-wrap items-center justify-between gap-2 ${
                tenantCtx.isReadOnlyGraceOrExpired
                  ? 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-800 dark:text-red-200'
                  : sub?.status === 'grace_period'
                    ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    : 'border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-sky-900 dark:text-sky-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">
                  {tenantCtx.isReadOnlyGraceOrExpired
                    ? sub?.status === 'trialing'
                      ? 'Your 14-day free trial has ended. Workspace is in view & export mode until a plan is activated.'
                      : `Subscription ${sub?.status}. Workspace is in view & export mode until payment is renewed.`
                    : sub?.status === 'grace_period'
                      ? `Subscription is in grace period. Renew in billing to prevent view-only lock.`
                      : `${tenantCtx.plan.name} free trial active (${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} remaining).`}
                </span>
              </div>
              {canAccessSection('billing') && (
                <button
                  type="button"
                  onClick={() => navigateTo('billing')}
                  className="rounded-md bg-[var(--av-surface)] border border-[var(--av-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] transition-colors shrink-0"
                >
                  Manage GH₵ Plan
                </button>
              )}
            </div>
          )}

          {/* Active Module Viewport */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1480px] w-full mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeSection}-${tenantCtx?.tenant.id || 'default'}-${tenantCtx?.isAllOrgsView ? 'all' : tenantCtx?.activeOrg.id || 'org'}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {activeSection === 'dashboard' && (
                  <DashboardView
                    summary={dashboardSummary}
                    assets={assets}
                    loading={dataLoading && !dashboardSummary}
                    tenantCtx={tenantCtx}
                    onNavigate={navigateTo}
                    onOpenAsset={handleOpenAsset}
                  />
                )}

                {activeSection === 'assets' && (
                  <AssetsView
                    assets={assets}
                    userRole={currentUser.role}
                    tenantCtx={tenantCtx}
                    selectedAssetId={selectedAssetId}
                    onClearSelectedAsset={() => setSelectedAssetId(null)}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onRequestAssign={(asset) => {
                      setAssignPreselectAsset(asset);
                      setActiveSection('assignments');
                    }}
                    onRequestMaintenance={(asset) => {
                      setMaintPreselectAsset(asset);
                      setActiveSection('maintenance');
                    }}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'employees' && (
                  <EmployeesView
                    employees={employees}
                    userRole={currentUser.role}
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onRequestAssignToEmployee={(employee) => {
                      setAssignPreselectEmployee(employee);
                      setActiveSection('assignments');
                    }}
                  />
                )}

                {activeSection === 'assignments' && (
                  <AssignmentsView
                    assignments={assignments}
                    assets={assets}
                    employees={employees}
                    tenantCtx={tenantCtx}
                    preselectedAsset={assignPreselectAsset}
                    preselectedEmployee={assignPreselectEmployee}
                    onClearPreselections={() => {
                      setAssignPreselectAsset(null);
                      setAssignPreselectEmployee(null);
                    }}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'maintenance' && (
                  <MaintenanceView
                    maintenanceLogs={maintenanceLogs}
                    assets={assets}
                    tickets={tickets}
                    userRole={currentUser.role}
                    tenantCtx={tenantCtx}
                    preselectedAsset={maintPreselectAsset}
                    onClearPreselectedAsset={() => setMaintPreselectAsset(null)}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'licences' && (
                  <SoftwareLicencesView
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'tickets' && (
                  <HelpdeskView
                    assets={assets}
                    users={users}
                    currentUserId={currentUser.id}
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'employee_portal' && (
                  <EmployeePortalView
                    currentUser={currentUser}
                    tenantCtx={tenantCtx}
                    assets={assets}
                    tickets={tickets}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'itsm' && (
                  <ItsmView
                    tenantCtx={tenantCtx}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'sla_contracts' && (
                  <SlaAndContractsView
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'kb' && (
                  <KnowledgeBaseView
                    tenantCtx={tenantCtx}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'procurement' && (
                  <ProcurementView
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'reports' && (
                  <ReportsView
                    assets={assets}
                    assignments={assignments}
                    maintenanceLogs={maintenanceLogs}
                    tickets={tickets}
                    licences={licences}
                    purchaseOrders={purchaseOrders}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'notifications' && (
                  <NotificationsView
                    notifications={notifications}
                    onRefresh={handleRefresh}
                    onOpenAsset={handleOpenAsset}
                    onOpenMaintenance={() => navigateTo('maintenance')}
                    onNavigate={navigateTo}
                    canNavigate={canAccessSection}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'audit_logs' && (
                  <AuditLogsView tenantCtx={tenantCtx} onToast={pushToast} />
                )}

                {activeSection === 'org_structure' && (
                  <OrgStructureView
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'users' && (
                  <UsersView
                    users={users}
                    currentUserId={currentUser.id}
                    tenantCtx={tenantCtx}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'billing' && (
                  <SubscriptionBillingView
                    tenantCtx={tenantCtx}
                    onRefreshContext={handleRefresh}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'integrations' && (
                  <IntegrationsAndAutomationView
                    tenantCtx={tenantCtx}
                    onRefreshContext={handleRefresh}
                    onToast={pushToast}
                    onPlanBlocked={handlePlanBlocked}
                  />
                )}

                {activeSection === 'super_admin' && tenantCtx?.isSuperAdmin && (
                  <SuperAdminView
                    onRefreshContext={handleRefresh}
                    onToast={pushToast}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        {/* Plan Quota / Feature Gate Upgrade Modal */}
        <AnimatePresence>
          {blockedModalErr && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
              role="dialog"
              aria-modal="true"
              aria-labelledby="plan-blocked-title"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 6 }}
                transition={{ duration: 0.16 }}
                className="w-full max-w-md rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-6 shadow-2xl space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div>
                      <h3
                        id="plan-blocked-title"
                        className="font-display text-base font-semibold text-[var(--av-text)]"
                      >
                        {blockedModalErr.code === 'SUBSCRIPTION_READ_ONLY'
                          ? 'Subscription Renewal Required'
                          : blockedModalErr.code === 'QUOTA_EXCEEDED'
                            ? 'Plan Quota Limit Reached'
                            : 'Enterprise / Upgraded Feature'}
                      </h3>
                      <p className="text-xs text-[var(--av-text-subtle)]">
                        Current plan: {tenantCtx?.plan.name || 'Starter'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBlockedModalErr(null)}
                    className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-sm text-[var(--av-text-muted)] leading-relaxed">
                  {blockedModalErr.message}
                </p>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setBlockedModalErr(null)}
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]"
                  >
                    Close
                  </button>
                  {canAccessSection('billing') && (
                    <button
                      type="button"
                      onClick={() => {
                        setBlockedModalErr(null);
                        navigateTo('billing');
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#3B66F6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2F54D4] transition-colors"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      View GH₵ Plans &amp; Upgrade
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <GlobalSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          assets={assets}
          employees={employees}
          maintenanceLogs={maintenanceLogs}
          userRole={currentUser.role}
          permissions={tenantCtx?.permissions ?? []}
          effectiveFeatures={tenantCtx?.effectiveFeatures ?? []}
          isSuperAdmin={Boolean(tenantCtx?.isSuperAdmin)}
          onOpenAsset={handleOpenAsset}
          onNavigate={navigateTo}
        />

        <SupportModal
          open={supportOpen}
          onClose={() => setSupportOpen(false)}
        />

        <AccountSecurityModal
          open={securityModalOpen}
          userEmail={currentUser.email}
          onClose={() => setSecurityModalOpen(false)}
          onToast={pushToast}
        />

        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </MotionConfig>
  );
}
