import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import type { NavSection } from './components/DashboardView.tsx';
import { LoginView } from './components/LoginView.tsx';
import { ToastContainer, type ToastMessage } from './components/Toast.tsx';
import { AppLoader } from './components/ui/AppLoader.tsx';
import {
  api,
  ApiError,
  getStoredToken,
  setActiveOrgId,
  setActiveTenantId,
  setStoredToken,
  type ExtendedTenantContext,
  type ExtendedUser,
  type WorkspaceBootstrapPayload,
} from './lib/api.ts';
import { setWorkspaceCurrency } from './lib/currency.ts';
import type {
  Asset,
  AssetAssignment,
  DashboardSummary,
  Employee,
  MaintenanceLog,
  SystemNotification,
  User,
} from './types/itams.ts';
import type { PurchaseOrder, SoftwareLicence, Ticket } from './types/saas.ts';

async function loadWorkspaceShell() {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await import('./components/WorkspaceShell.tsx');
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => window.setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

const WorkspaceShell = lazy(() =>
  loadWorkspaceShell().then((m) => ({
    default: m.WorkspaceShell,
  }))
);

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<ExtendedUser | null>(null);
  const [tenantCtx, setTenantCtx] = useState<ExtendedTenantContext | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');

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

  const applyBootstrapPayload = useCallback(
    (boot: WorkspaceBootstrapPayload) => {
      setCurrentUser(boot.user);
      const ctx = boot.context;
      setTenantCtx(ctx);
      setWorkspaceCurrency(ctx.tenant.currency);
      setActiveTenantId(ctx.tenant.id);
      setActiveOrgId(ctx.isAllOrgsView ? 'all' : ctx.activeOrg.id);
      if (ctx.membership.role === 'employee') {
        setActiveSection((prev) =>
          prev === 'dashboard' ? 'employee_portal' : prev
        );
      }
      setDashboardSummary(boot.dashboard);
      setAssets(boot.assets);
      setEmployees(boot.employees);
      setAssignments(boot.assignments);
      setMaintenanceLogs(boot.maintenanceLogs);
      setNotifications(boot.notifications);
      setUsers(boot.users);
      setTickets(boot.tickets);
      setLicences(boot.licences);
      setPurchaseOrders(boot.purchaseOrders);
    },
    []
  );

  const loadWorkspaceData = useCallback(
    async (_user?: User) => {
      setDataLoading(true);
      try {
        const boot = await api.bootstrap();
        applyBootstrapPayload(boot);
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
    [applyBootstrapPayload, pushToast]
  );

  // Quietly prefetch the authenticated workspace bundle right after login screen paints
  useEffect(() => {
    if (!authChecked || currentUser) return;
    const timer = window.setTimeout(() => {
      void loadWorkspaceShell().catch(() => {});
    }, 120);
    return () => window.clearTimeout(timer);
  }, [authChecked, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    let unsub: (() => void) | undefined;
    void import('./lib/googleAuth.ts')
      .then(({ initGoogleAuthListener }) => {
        if (!active) return;
        unsub = initGoogleAuthListener();
      })
      .catch(() => {});
    return () => {
      active = false;
      unsub?.();
    };
  }, [currentUser?.id]);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      const token = getStoredToken();
      if (!token) {
        if (active) setAuthChecked(true);
        return;
      }
      try {
        // Handle Paystack redirect callback (?paystack_ref=...) if present
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

        const [boot] = await Promise.all([
          api.bootstrap(),
          loadWorkspaceShell().catch(() => undefined),
        ]);
        if (!active) return;
        applyBootstrapPayload(boot);
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
  }, [applyBootstrapPayload, pushToast]);

  const handleLoginSuccess = async (token: string, user: User) => {
    setStoredToken(token);
    setActiveTenantId(null);
    setActiveOrgId(null);
    setCurrentUser(user);
    setActiveSection('dashboard');
    await Promise.all([
      loadWorkspaceData(user),
      loadWorkspaceShell(),
    ]);
    pushToast('success', `Signed in as ${user.name}.`);
  };

  const handleLogout = async () => {
    try {
      await Promise.allSettled([
        api.logout(),
        import('./lib/googleAuth.ts').then(({ googleSignOut }) => googleSignOut()),
      ]);
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

  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<AppLoader label="Verifying session & loading workspace..." />}>
        <WorkspaceShell
          currentUser={currentUser}
          tenantCtx={tenantCtx}
          activeSection={activeSection}
          setActiveSection={setActiveSection}
          dataLoading={dataLoading}
          dashboardSummary={dashboardSummary}
          assets={assets}
          employees={employees}
          assignments={assignments}
          maintenanceLogs={maintenanceLogs}
          notifications={notifications}
          users={users}
          tickets={tickets}
          licences={licences}
          purchaseOrders={purchaseOrders}
          toasts={toasts}
          dismissToast={dismissToast}
          pushToast={pushToast}
          onRefresh={handleRefresh}
          onLogout={handleLogout}
          onSwitchTenant={handleSwitchTenant}
          onSwitchOrg={handleSwitchOrg}
        />
      </Suspense>
    </MotionConfig>
  );
}
