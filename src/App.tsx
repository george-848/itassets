import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowLeftRight,
  Bell,
  ChevronDown,
  ChevronRight,
  FileBarChart2,
  HardDrive,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Server,
  Shield,
  Sun,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { AssetsView } from './components/AssetsView.tsx';
import { AssignmentsView } from './components/AssignmentsView.tsx';
import { DashboardView, type NavSection } from './components/DashboardView.tsx';
import { EmployeesView } from './components/EmployeesView.tsx';
import { LoginView } from './components/LoginView.tsx';
import { MaintenanceView } from './components/MaintenanceView.tsx';
import { NotificationsView } from './components/NotificationsView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx';
import { ToastContainer, type ToastMessage } from './components/Toast.tsx';
import { GlobalSearchModal } from './components/ui/GlobalSearchModal.tsx';
import { SupportModal } from './components/ui/SupportModal.tsx';
import { UsersView } from './components/UsersView.tsx';
import { api, ApiError, getStoredToken, setStoredToken } from './lib/api.ts';
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

const SECTION_META: Record<
  NavSection,
  { group: string; label: string; subtitle: string }
> = {
  dashboard: {
    group: 'Overview',
    label: 'Dashboard',
    subtitle: 'Executive inventory overview, utilization, and compliance alerts',
  },
  assets: {
    group: 'Operations',
    label: 'Asset Inventory',
    subtitle: 'Manage corporate hardware, serials, warranties, and lifecycle state',
  },
  employees: {
    group: 'Operations',
    label: 'Employees',
    subtitle: 'Organization directory, departments, and equipment custody history',
  },
  assignments: {
    group: 'Operations',
    label: 'Assignments & Handovers',
    subtitle: 'Issue, return, and generate signed PDF equipment handover records',
  },
  maintenance: {
    group: 'Operations',
    label: 'Maintenance',
    subtitle: 'Track hardware repairs, preventive service schedules, and costs',
  },
  reports: {
    group: 'Governance',
    label: 'Reports & Exports',
    subtitle: 'Generate filterable inventory, custody, and warranty audit exports',
  },
  notifications: {
    group: 'Governance',
    label: 'Notifications',
    subtitle: 'Expiring warranties, overdue maintenance, and replacement advisories',
  },
  users: {
    group: 'Governance',
    label: 'User Management',
    subtitle: 'Manage Admin and IT Staff authentication accounts and permissions',
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
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
  const [users, setUsers] = useState<User[]>([]);

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
        const [dashRes, assetsRes, empRes, asgRes, mntRes, notifRes] =
          await Promise.all([
            api.getDashboard(),
            api.listAssets(),
            api.listEmployees(),
            api.listAssignments(),
            api.listMaintenance(),
            api.listNotifications(),
          ]);
        setDashboardSummary(dashRes);
        setAssets(assetsRes.assets);
        setEmployees(empRes.employees);
        setAssignments(asgRes.assignments);
        setMaintenanceLogs(mntRes.maintenanceLogs);
        setNotifications(notifRes.notifications);

        if (user.role === 'admin') {
          const usersRes = await api.listUsers();
          setUsers(usersRes.users);
        } else {
          setUsers([]);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setStoredToken(null);
          setCurrentUser(null);
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
        if (active) {
          setCurrentUser(res.user);
          await loadWorkspaceData(res.user);
        }
      } catch {
        setStoredToken(null);
      } finally {
        if (active) setAuthChecked(true);
      }
    }
    restoreSession();
    return () => {
      active = false;
    };
  }, [loadWorkspaceData]);

  const handleLoginSuccess = async (token: string, user: User) => {
    setStoredToken(token);
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
    setCurrentUser(null);
    setDashboardSummary(null);
    setAssets([]);
    setEmployees([]);
    setAssignments([]);
    setMaintenanceLogs([]);
    setNotifications([]);
    setUsers([]);
  };

  const handleRefresh = useCallback(async () => {
    if (!currentUser) return;
    await loadWorkspaceData(currentUser);
  }, [currentUser, loadWorkspaceData]);

  const navigateTo = (section: NavSection) => {
    if (section === 'users' && currentUser?.role !== 'admin') return;
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
        <div className="min-h-screen bg-[var(--av-bg)] av-grid-surface flex items-center justify-center transition-colors duration-200">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#111827] text-white shadow-lg border border-white/10">
              <Server className="h-5 w-5 text-[#3B82F6]" />
            </div>
            <p className="mt-3 font-display text-sm font-semibold text-[var(--av-text-muted)]">
              Loading AssetVault IT...
            </p>
          </motion.div>
        </div>
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

  type NavItem = {
    id: NavSection;
    label: string;
    icon: typeof LayoutDashboard;
    group: 'operations' | 'governance';
    badge?: number;
    adminOnly?: boolean;
  };

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'operations' },
    { id: 'assets', label: 'Asset Inventory', icon: HardDrive, group: 'operations' },
    { id: 'employees', label: 'Employees', icon: Users, group: 'operations' },
    { id: 'assignments', label: 'Assignments', icon: ArrowLeftRight, group: 'operations' },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, group: 'operations' },
    { id: 'reports', label: 'Reports', icon: FileBarChart2, group: 'governance' },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      group: 'governance',
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'users', label: 'User Management', icon: Shield, group: 'governance', adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || currentUser.role === 'admin'
  );
  const operationsItems = visibleNavItems.filter((i) => i.group === 'operations');
  const governanceItems = visibleNavItems.filter((i) => i.group === 'governance');

  const initials = currentUser.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
            collapsed ? 'justify-center px-2.5' : 'justify-between px-3'
          } gap-3 rounded-lg py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
            isActive
              ? 'text-white'
              : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
          }`}
        >
          {isActive && (
            <motion.span
              layoutId={`sidebar-active-${scope}`}
              transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              className="absolute inset-0 rounded-lg bg-[#3B82F6]/15 border border-[#3B82F6]/25"
            />
          )}
          {isActive && !collapsed && (
            <motion.span
              layoutId={`sidebar-rail-${scope}`}
              transition={{ type: 'spring', stiffness: 450, damping: 36 }}
              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-[#3B82F6]"
            />
          )}
          <span className="relative z-10 flex items-center gap-2.5 min-w-0">
            <Icon
              className={`h-4 w-4 shrink-0 transition-colors ${
                isActive
                  ? 'text-[#60A5FA]'
                  : 'text-slate-400 group-hover:text-slate-200'
              }`}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </span>
          {!collapsed && item.badge !== undefined && (
            <span
              className={`relative z-10 font-mono text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                isActive
                  ? 'bg-[#3B82F6]/30 text-blue-100'
                  : 'bg-red-600 text-white'
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
            collapsed ? 'justify-center px-3' : 'justify-between px-4'
          } h-14 border-b border-[var(--av-sidebar-border)] shrink-0`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B82F6] text-white shrink-0 shadow-xs">
              <Server className="h-4 w-4" />
            </div>
            {!collapsed && (
              <span className="font-display text-[15px] font-bold tracking-tight text-white whitespace-nowrap truncate">
                AssetVault IT
              </span>
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
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
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

          <div>
            {!collapsed && (
              <div className="px-3 mb-2 text-[11px] font-semibold tracking-wide text-slate-500">
                Core Operations
              </div>
            )}
            <div className="space-y-1">
              {renderNavGroup(operationsItems, scope, collapsed)}
            </div>
          </div>

          <div>
            {!collapsed && (
              <div className="px-3 mb-2 text-[11px] font-semibold tracking-wide text-slate-500">
                Governance & Reports
              </div>
            )}
            <div className="space-y-1">
              {renderNavGroup(governanceItems, scope, collapsed)}
            </div>
          </div>
        </nav>

        {/* Bottom Appearance & Profile Section */}
        <div className="border-t border-[var(--av-sidebar-border)] p-3 bg-white/[0.015] space-y-3 shrink-0">
          <ThemeSwitcher variant="sidebar" collapsed={collapsed} />

          <div className="pt-2 border-t border-[var(--av-sidebar-border)]">
            <div
              className={`flex items-center ${
                collapsed ? 'justify-center' : 'gap-2.5'
              }`}
            >
              <div
                title={`${currentUser.name} (${currentUser.email})`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#3B82F6]/20 border border-[#3B82F6]/30 font-display text-xs font-bold text-[#93C5FD]"
              >
                {initials}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white">
                    {currentUser.name}
                  </div>
                  <div className="truncate text-[11px] text-slate-400">
                    {currentUser.role === 'admin' ? 'Administrator' : 'IT Staff'}
                  </div>
                </div>
              )}
            </div>

            {!collapsed && (
              <button
                type="button"
                onClick={handleLogout}
                className="mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const meta = SECTION_META[activeSection];

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[var(--av-bg)] text-[var(--av-text)] flex transition-colors duration-200 overflow-x-clip">
        {/* Collapsible Desktop Sidebar */}
        <aside
          className={`hidden lg:block shrink-0 border-r border-[var(--av-border)] sticky top-0 h-screen transition-[width] duration-200 ease-out ${
            sidebarCollapsed ? 'w-[72px]' : 'w-[252px]'
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
          <header className="sticky top-0 z-30 h-14 border-b border-[var(--av-border)] bg-[var(--av-header-bg)] backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 transition-colors duration-200">
            {/* Left: Mobile Drawer Button + Breadcrumb & Page Title */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] p-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] transition-colors"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5 text-xs text-[var(--av-text-subtle)] min-w-0">
                <span className="hidden sm:inline font-medium whitespace-nowrap">
                  {meta.group}
                </span>
                <ChevronRight className="hidden sm:inline h-3.5 w-3.5 opacity-60 shrink-0" />
                <span className="font-display text-sm font-semibold text-[var(--av-text)] truncate">
                  {meta.label}
                </span>
              </div>
            </div>

            {/* Right: Global Search, Light/Dark Toggle, Notifications Popover, Help, Profile Dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Global Search */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2.5 sm:px-3 py-1.5 text-xs text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0"
                aria-label="Search workspace"
              >
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden md:inline">Search assets, staff...</span>
                <kbd className="hidden lg:inline-block rounded border border-[var(--av-border)] bg-[var(--av-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--av-text-subtle)]">
                  ⌘K
                </kbd>
              </button>

              {/* Light / Dark Toggle */}
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
                  className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors shrink-0"
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
                              onClick={() =>
                                n.entity_type === 'maintenance'
                                  ? navigateTo('maintenance')
                                  : handleOpenAsset(n.asset_id)
                              }
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

              {/* Help / Support Access */}
              <button
                type="button"
                onClick={() => setSupportOpen(true)}
                title="Help & shortcuts"
                aria-label="Help and keyboard shortcuts"
                className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors shrink-0"
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
                      className="absolute right-0 mt-2 w-60 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-xl overflow-hidden z-40"
                    >
                      <div className="border-b border-[var(--av-border-subtle)] px-4 py-3">
                        <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                          {currentUser.name}
                        </div>
                        <div className="text-[11px] text-[var(--av-text-subtle)] truncate">
                          {currentUser.email}
                        </div>
                        <div className="mt-1 text-[11px] font-medium text-[var(--av-accent)]">
                          {currentUser.role === 'admin' ? 'Administrator' : 'IT Staff'} ·{' '}
                          {currentUser.department}
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
                              <Sun className="h-3.5 w-3.5" />
                            ) : (
                              <Moon className="h-3.5 w-3.5" />
                            )}
                            <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setProfileMenuOpen(false);
                            setSupportOpen(true);
                          }}
                          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                          <span>Help & Shortcuts</span>
                        </button>

                        {currentUser.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => navigateTo('users')}
                            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <Shield className="h-3.5 w-3.5" />
                            <span>User Management</span>
                          </button>
                        )}
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

          {/* Active Module Viewport */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1480px] w-full mx-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
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
                    onNavigate={navigateTo}
                    onOpenAsset={handleOpenAsset}
                  />
                )}

                {activeSection === 'assets' && (
                  <AssetsView
                    assets={assets}
                    userRole={currentUser.role}
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
                  />
                )}

                {activeSection === 'employees' && (
                  <EmployeesView
                    employees={employees}
                    userRole={currentUser.role}
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
                    userRole={currentUser.role}
                    preselectedAsset={maintPreselectAsset}
                    onClearPreselectedAsset={() => setMaintPreselectAsset(null)}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'reports' && (
                  <ReportsView
                    assets={assets}
                    assignments={assignments}
                    maintenanceLogs={maintenanceLogs}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'notifications' && (
                  <NotificationsView
                    notifications={notifications}
                    onRefresh={handleRefresh}
                    onOpenAsset={handleOpenAsset}
                    onOpenMaintenance={() => navigateTo('maintenance')}
                    onToast={pushToast}
                  />
                )}

                {activeSection === 'users' && currentUser.role === 'admin' && (
                  <UsersView
                    users={users}
                    currentUserId={currentUser.id}
                    onRefresh={handleRefresh}
                    onToast={pushToast}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <GlobalSearchModal
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          assets={assets}
          employees={employees}
          maintenanceLogs={maintenanceLogs}
          userRole={currentUser.role}
          onOpenAsset={handleOpenAsset}
          onNavigate={navigateTo}
        />

        <SupportModal
          open={supportOpen}
          onClose={() => setSupportOpen(false)}
        />

        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </MotionConfig>
  );
}
