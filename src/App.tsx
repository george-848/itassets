import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowLeftRight,
  Bell,
  FileBarChart2,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Server,
  Shield,
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
import { ToastContainer, type ToastMessage } from './components/Toast.tsx';
import { UsersView } from './components/UsersView.tsx';
import { api, ApiError, getStoredToken, setStoredToken } from './lib/api.ts';
import { googleSignOut, initGoogleAuthListener } from './lib/googleAuth.ts';
import type {
  Asset,
  AssetAssignment,
  DashboardSummary,
  Employee,
  MaintenanceLog,
  SystemNotification,
  User,
} from './types/itams.ts';

const SECTION_META: Record<NavSection, { label: string; subtitle: string }> = {
  dashboard: {
    label: 'Dashboard',
    subtitle: 'Executive inventory overview, utilization, and compliance alerts',
  },
  assets: {
    label: 'Asset Inventory',
    subtitle: 'Manage corporate hardware, serials, warranties, and lifecycle state',
  },
  employees: {
    label: 'Employees',
    subtitle: 'Organization directory, departments, and equipment custody history',
  },
  assignments: {
    label: 'Assignments & Handovers',
    subtitle: 'Issue, return, and generate signed PDF equipment handover records',
  },
  maintenance: {
    label: 'Maintenance',
    subtitle: 'Track hardware repairs, preventive service schedules, and costs',
  },
  reports: {
    label: 'Reports & Exports',
    subtitle: 'Generate filterable inventory, custody, and warranty audit exports',
  },
  notifications: {
    label: 'Notifications',
    subtitle: 'Expiring warranties, overdue maintenance, and replacement advisories',
  },
  users: {
    label: 'User Management',
    subtitle: 'Manage Admin and IT Staff authentication accounts and permissions',
  },
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
  };

  const handleOpenAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    setActiveSection('assets');
    setMobileMenuOpen(false);
  };

  const unreadCount = notifications.filter((n) => !n.acknowledged).length;

  if (!authChecked) {
    return (
      <MotionConfig reducedMotion="user">
        <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="text-center"
          >
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#0F172A] text-white">
              <Server className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-600">
              Initializing AssetVault IT...
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

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: number;
    adminOnly?: boolean;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'assets', label: 'Assets', icon: HardDrive },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'assignments', label: 'Assignments', icon: ArrowLeftRight },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'reports', label: 'Reports', icon: FileBarChart2 },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'users', label: 'User Management', icon: Shield, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(
    (item) => !item.adminOnly || currentUser.role === 'admin'
  );

  const initials = currentUser.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const renderSidebar = (scope: 'desktop' | 'mobile') => (
    <div className="flex h-full flex-col bg-[#0F172A] text-slate-200">
      {/* Brand Wordmark */}
      <div className="flex items-center justify-between px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white shrink-0">
            <Server className="h-4.5 w-4.5" />
          </div>
          <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap">
            AssetVault IT
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          aria-label="Close navigation menu"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => navigateTo(item.id)}
              className={`relative w-full flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'text-white'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId={`sidebar-active-${scope}`}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 rounded-lg bg-blue-600"
                />
              )}
              <span className="relative z-10 flex items-center gap-3 min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge !== undefined && (
                <span
                  className={`relative z-10 font-mono text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                    isActive
                      ? 'bg-blue-700 text-white'
                      : 'bg-red-600/90 text-white'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Account Footer */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 font-display text-xs font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">
              {currentUser.name}
            </div>
            <div className="truncate text-[11px] text-slate-400">
              {currentUser.role === 'admin' ? 'Administrator' : 'IT Staff'} ·{' '}
              {currentUser.department}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  const meta = SECTION_META[activeSection];

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 sticky top-0 h-screen">
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
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-68 max-w-[80vw] h-full z-10 shadow-2xl"
            >
              {renderSidebar('mobile')}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Open navigation menu"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-600">AssetVault IT</span>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-slate-900 truncate">
                  {meta.label}
                </span>
              </div>
              <p className="hidden sm:block text-xs text-slate-500 truncate mt-0.5">
                {meta.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigateTo('notifications')}
              className="relative inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              aria-label="View system notifications"
            >
              <Bell className="h-4 w-4 text-slate-600" />
              <span className="hidden sm:inline">Alerts</span>
              {unreadCount > 0 && (
                <span className="font-mono text-[11px] font-semibold text-red-700 tabular-nums">
                  ({unreadCount})
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigateTo('reports')}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <FileBarChart2 className="h-3.5 w-3.5" />
              <span>Export Reports</span>
            </button>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeSection === 'dashboard' && (
                <DashboardView
                  summary={dashboardSummary}
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

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
    </MotionConfig>
  );
}
