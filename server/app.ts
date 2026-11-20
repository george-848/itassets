import crypto from 'node:crypto';
import express from 'express';
import {
  createAuthMiddleware,
  hashPassword,
  requireAdmin,
  signSessionToken,
  verifyPassword,
  type AuthenticatedRequest,
} from './auth.ts';
import { createDatabase, type ItamsDatabase } from './db.ts';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  type Asset,
  type AssetCategory,
  type AssetStatus,
  type Employee,
  type MaintenanceLog,
  type MaintenanceStatus,
  type MaintenanceType,
  type UserRole,
} from '../src/types/itams.ts';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

let sharedDbPromise: Promise<ItamsDatabase> | null = null;

export function getSharedDatabase(): Promise<ItamsDatabase> {
  if (!sharedDbPromise) {
    sharedDbPromise = createDatabase().catch((err) => {
      sharedDbPromise = null;
      throw err;
    });
  }
  return sharedDbPromise;
}

export function createApiApp(db: ItamsDatabase): express.Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  const requireAuth = createAuthMiddleware((id) => db.findUserById(id));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, engine: db.engine });
  });

  // -------------------------------------------------------------------------
  // Auth Routes
  // -------------------------------------------------------------------------
  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = await db.findUserByEmail(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: 'Invalid email address or password.' });
        return;
      }
      if (user.status !== 'active') {
        res.status(403).json({
          error: 'Your account has been deactivated. Contact an administrator.',
        });
        return;
      }

      const now = new Date().toISOString();
      await db.updateUserLastLogin(user.id, now);
      const token = signSessionToken({ id: user.id, email: user.email, role: user.role });

      res.cookie('av_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      const { password_hash: _ignored, ...safeUser } = user;
      res.json({
        token,
        user: { ...safeUser, last_login: now },
        engine: db.engine,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Authentication service error.' });
    }
  });

  app.post('/api/auth/google', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const googleToken =
        authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';
      if (!googleToken) {
        res.status(401).json({ error: 'Google access token is required.' });
        return;
      }

      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${googleToken}` },
      });
      if (!userinfoRes.ok) {
        res.status(401).json({ error: 'Invalid or expired Google credentials.' });
        return;
      }

      const profile = (await userinfoRes.json()) as {
        email?: unknown;
        email_verified?: unknown;
        name?: unknown;
      };
      const email =
        typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
      if (!email || profile.email_verified !== true) {
        res.status(401).json({ error: 'A verified Google email address is required.' });
        return;
      }

      const now = new Date().toISOString();
      const existingUser = await db.findUserByEmail(email);

      let safeUser;
      if (existingUser) {
        if (existingUser.status !== 'active') {
          res.status(403).json({
            error: 'Your account has been deactivated. Contact an administrator.',
          });
          return;
        }
        await db.updateUserLastLogin(existingUser.id, now);
        const { password_hash: _ignored, ...rest } = existingUser;
        safeUser = { ...rest, last_login: now };
      } else {
        const displayName =
          typeof profile.name === 'string' && profile.name.trim()
            ? profile.name.trim()
            : email.split('@')[0] || 'IT Staff Member';
        safeUser = await db.createUser({
          id: `usr-${crypto.randomUUID().slice(0, 8)}`,
          name: displayName,
          email,
          password_hash: hashPassword(crypto.randomBytes(24).toString('hex')),
          role: 'staff',
          department: 'IT Infrastructure',
          status: 'active',
          created_at: now,
          last_login: now,
        });
      }

      const token = signSessionToken({
        id: safeUser.id,
        email: safeUser.email,
        role: safeUser.role,
      });

      res.cookie('av_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.json({
        token,
        user: safeUser,
        engine: db.engine,
      });
    } catch (err) {
      console.error('Google login error:', err);
      res.status(500).json({ error: 'Google authentication service error.' });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('av_session', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser, engine: db.engine });
  });

  // -------------------------------------------------------------------------
  // Dashboard Route
  // -------------------------------------------------------------------------
  app.get('/api/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const summary = await db.getDashboardSummary(req.authUser!.id);
      res.json(summary);
    } catch (err) {
      console.error('Dashboard error:', err);
      res.status(500).json({ error: 'Failed to load dashboard metrics.' });
    }
  });

  // -------------------------------------------------------------------------
  // Assets Routes
  // -------------------------------------------------------------------------
  app.get('/api/assets', requireAuth, async (_req, res) => {
    try {
      const assets = await db.listAssets();
      res.json({ assets });
    } catch (err) {
      console.error('List assets error:', err);
      res.status(500).json({ error: 'Failed to load assets.' });
    }
  });

  app.get('/api/assets/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const asset = await db.getAssetById(id);
      if (!asset) {
        res.status(404).json({ error: 'Asset not found.' });
        return;
      }
      const [assignments, maintenanceLogs] = await Promise.all([
        db.listAssignmentsByAsset(id),
        db.listMaintenanceByAsset(id),
      ]);
      res.json({ asset, assignments, maintenanceLogs });
    } catch (err) {
      console.error('Get asset detail error:', err);
      res.status(500).json({ error: 'Failed to load asset details.' });
    }
  });

  app.post('/api/assets', requireAuth, async (req, res) => {
    try {
      const body = req.body ?? {};
      const asset_tag = String(body.asset_tag ?? '').trim().toUpperCase();
      const name = String(body.name ?? '').trim();
      const category = String(body.category ?? '') as AssetCategory;
      const brand = String(body.brand ?? '').trim();
      const model = String(body.model ?? '').trim();
      const serial_number = String(body.serial_number ?? '').trim().toUpperCase();
      const purchase_date = String(body.purchase_date ?? '').trim();
      const cost = Number(body.cost);
      const warranty_expiry = String(body.warranty_expiry ?? '').trim();
      const status = (String(body.status ?? 'Available') as AssetStatus) || 'Available';
      const location = String(body.location ?? '').trim() || 'IT Vault';
      const notes = String(body.notes ?? '').trim();

      if (!asset_tag || !name || !brand || !model || !serial_number) {
        res.status(400).json({
          error: 'Asset tag, name, brand, model, and serial number are required.',
        });
        return;
      }
      if (!ASSET_CATEGORIES.includes(category)) {
        res.status(400).json({ error: 'Invalid asset category selected.' });
        return;
      }
      if (!ASSET_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid asset status selected.' });
        return;
      }
      if (status === 'Assigned') {
        res.status(400).json({
          error:
            'Create assets as Available first, then use Asset Assignment to issue to an employee.',
        });
        return;
      }
      if (!isIsoDate(purchase_date) || !isIsoDate(warranty_expiry)) {
        res.status(400).json({
          error: 'Purchase date and warranty expiry must be valid YYYY-MM-DD dates.',
        });
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        res.status(400).json({ error: 'Asset cost must be a valid non-negative number.' });
        return;
      }

      const existingAssets = await db.listAssets();
      if (existingAssets.some((a) => a.asset_tag.toUpperCase() === asset_tag)) {
        res.status(409).json({ error: `Asset tag "${asset_tag}" is already registered.` });
        return;
      }
      if (existingAssets.some((a) => a.serial_number.toUpperCase() === serial_number)) {
        res.status(409).json({
          error: `Serial number "${serial_number}" is already registered.`,
        });
        return;
      }

      const now = new Date().toISOString();
      const newAsset: Asset = {
        id: `ast-${crypto.randomUUID().slice(0, 8)}`,
        asset_tag,
        name,
        category,
        brand,
        model,
        serial_number,
        purchase_date,
        cost,
        warranty_expiry,
        status,
        assigned_employee_id: null,
        assigned_date: null,
        location,
        notes,
        created_at: now,
        updated_at: now,
      };

      const created = await db.createAsset(newAsset);
      res.status(201).json({ asset: created });
    } catch (err) {
      console.error('Create asset error:', err);
      res.status(500).json({ error: 'Failed to create asset.' });
    }
  });

  app.put('/api/assets/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.getAssetById(id);
      if (!current) {
        res.status(404).json({ error: 'Asset not found.' });
        return;
      }

      const body = req.body ?? {};
      const asset_tag = String(body.asset_tag ?? current.asset_tag).trim().toUpperCase();
      const name = String(body.name ?? current.name).trim();
      const category = String(body.category ?? current.category) as AssetCategory;
      const brand = String(body.brand ?? current.brand).trim();
      const model = String(body.model ?? current.model).trim();
      const serial_number = String(body.serial_number ?? current.serial_number)
        .trim()
        .toUpperCase();
      const purchase_date = String(body.purchase_date ?? current.purchase_date).trim();
      const cost = body.cost !== undefined ? Number(body.cost) : current.cost;
      const warranty_expiry = String(
        body.warranty_expiry ?? current.warranty_expiry
      ).trim();
      const status = String(body.status ?? current.status) as AssetStatus;
      const location = String(body.location ?? current.location).trim();
      const notes = String(body.notes ?? current.notes).trim();

      if (!asset_tag || !name || !brand || !model || !serial_number) {
        res.status(400).json({
          error: 'Asset tag, name, brand, model, and serial number are required.',
        });
        return;
      }
      if (!ASSET_CATEGORIES.includes(category)) {
        res.status(400).json({ error: 'Invalid asset category selected.' });
        return;
      }
      if (!ASSET_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid asset status selected.' });
        return;
      }
      if (!isIsoDate(purchase_date) || !isIsoDate(warranty_expiry)) {
        res.status(400).json({
          error: 'Purchase date and warranty expiry must be valid YYYY-MM-DD dates.',
        });
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        res.status(400).json({ error: 'Asset cost must be a valid non-negative number.' });
        return;
      }

      if (current.status === 'Assigned' && status === 'Available') {
        res.status(400).json({
          error:
            'Use the Asset Return workflow to return an assigned asset back to Available.',
        });
        return;
      }
      if (
        current.status !== 'Assigned' &&
        status === 'Assigned' &&
        !current.assigned_employee_id
      ) {
        res.status(400).json({
          error: 'Use the Asset Assignment workflow to assign an asset to an employee.',
        });
        return;
      }

      const existingAssets = await db.listAssets();
      if (
        existingAssets.some(
          (a) => a.id !== id && a.asset_tag.toUpperCase() === asset_tag
        )
      ) {
        res.status(409).json({
          error: `Asset tag "${asset_tag}" is already used by another asset.`,
        });
        return;
      }
      if (
        existingAssets.some(
          (a) => a.id !== id && a.serial_number.toUpperCase() === serial_number
        )
      ) {
        res.status(409).json({
          error: `Serial number "${serial_number}" is already used by another asset.`,
        });
        return;
      }

      const updated = await db.updateAsset(id, {
        asset_tag,
        name,
        category,
        brand,
        model,
        serial_number,
        purchase_date,
        cost,
        warranty_expiry,
        status,
        location,
        notes,
        updated_at: new Date().toISOString(),
      });
      res.json({ asset: updated });
    } catch (err) {
      console.error('Update asset error:', err);
      res.status(500).json({ error: 'Failed to update asset.' });
    }
  });

  app.delete('/api/assets/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      const asset = await db.getAssetById(id);
      if (!asset) {
        res.status(404).json({ error: 'Asset not found.' });
        return;
      }
      if (asset.status === 'Assigned') {
        res.status(400).json({
          error: 'Cannot delete an assigned asset. Return it from the employee first.',
        });
        return;
      }
      await db.deleteAsset(id);
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete asset error:', err);
      res.status(500).json({ error: 'Failed to delete asset.' });
    }
  });

  // -------------------------------------------------------------------------
  // Employees Routes
  // -------------------------------------------------------------------------
  app.get('/api/employees', requireAuth, async (_req, res) => {
    try {
      const employees = await db.listEmployees();
      res.json({ employees });
    } catch (err) {
      console.error('List employees error:', err);
      res.status(500).json({ error: 'Failed to load employees.' });
    }
  });

  app.get('/api/employees/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const employee = await db.getEmployeeById(id);
      if (!employee) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }
      const [assets, assignments] = await Promise.all([
        db.listAssets(),
        db.listAssignmentsByEmployee(id),
      ]);
      const assignedAssets = assets.filter(
        (a) => a.assigned_employee_id === id && a.status === 'Assigned'
      );
      res.json({ employee, assignedAssets, assignments });
    } catch (err) {
      console.error('Get employee detail error:', err);
      res.status(500).json({ error: 'Failed to load employee details.' });
    }
  });

  app.post('/api/employees', requireAuth, async (req, res) => {
    try {
      const body = req.body ?? {};
      const employee_code = String(body.employee_code ?? '').trim().toUpperCase();
      const full_name = String(body.full_name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const department = String(body.department ?? '').trim();
      const job_title = String(body.job_title ?? '').trim();
      const phone = String(body.phone ?? '').trim();
      const location = String(body.location ?? '').trim();
      const status = body.status === 'inactive' ? 'inactive' : 'active';

      if (!employee_code || !full_name || !email || !department || !job_title) {
        res.status(400).json({
          error: 'Employee code, full name, email, department, and job title are required.',
        });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Please enter a valid work email address.' });
        return;
      }

      const existing = await db.listEmployees();
      if (existing.some((e) => e.employee_code.toUpperCase() === employee_code)) {
        res.status(409).json({
          error: `Employee code "${employee_code}" is already registered.`,
        });
        return;
      }
      if (existing.some((e) => e.email.toLowerCase() === email)) {
        res.status(409).json({
          error: `Email "${email}" is already assigned to an employee.`,
        });
        return;
      }

      const employee: Employee = {
        id: `emp-${crypto.randomUUID().slice(0, 8)}`,
        employee_code,
        full_name,
        email,
        department,
        job_title,
        phone,
        location: location || 'Main HQ',
        status,
        created_at: new Date().toISOString(),
      };
      const created = await db.createEmployee(employee);
      res.status(201).json({ employee: created });
    } catch (err) {
      console.error('Create employee error:', err);
      res.status(500).json({ error: 'Failed to register employee.' });
    }
  });

  app.put('/api/employees/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.getEmployeeById(id);
      if (!current) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }

      const body = req.body ?? {};
      const employee_code = String(body.employee_code ?? current.employee_code)
        .trim()
        .toUpperCase();
      const full_name = String(body.full_name ?? current.full_name).trim();
      const email = String(body.email ?? current.email).trim().toLowerCase();
      const department = String(body.department ?? current.department).trim();
      const job_title = String(body.job_title ?? current.job_title).trim();
      const phone = String(body.phone ?? current.phone).trim();
      const location = String(body.location ?? current.location).trim();
      const status =
        body.status === 'inactive' || body.status === 'active'
          ? body.status
          : current.status;

      if (!employee_code || !full_name || !email || !department || !job_title) {
        res.status(400).json({
          error: 'Employee code, full name, email, department, and job title are required.',
        });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Please enter a valid work email address.' });
        return;
      }

      const existing = await db.listEmployees();
      if (
        existing.some(
          (e) => e.id !== id && e.employee_code.toUpperCase() === employee_code
        )
      ) {
        res.status(409).json({
          error: `Employee code "${employee_code}" is already used by another employee.`,
        });
        return;
      }
      if (existing.some((e) => e.id !== id && e.email.toLowerCase() === email)) {
        res.status(409).json({
          error: `Email "${email}" is already used by another employee.`,
        });
        return;
      }

      const updated = await db.updateEmployee(id, {
        employee_code,
        full_name,
        email,
        department,
        job_title,
        phone,
        location,
        status,
      });
      res.json({ employee: updated });
    } catch (err) {
      console.error('Update employee error:', err);
      res.status(500).json({ error: 'Failed to update employee.' });
    }
  });

  app.delete('/api/employees/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.getEmployeeById(id);
      if (!current) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }
      if ((current.assigned_count ?? 0) > 0) {
        res.status(400).json({
          error:
            'Cannot delete an employee with active assigned assets. Return all assets first.',
        });
        return;
      }
      await db.deleteEmployee(id);
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete employee error:', err);
      res.status(500).json({ error: 'Failed to delete employee.' });
    }
  });

  // -------------------------------------------------------------------------
  // Asset Assignments Routes
  // -------------------------------------------------------------------------
  app.get('/api/assignments', requireAuth, async (_req, res) => {
    try {
      const assignments = await db.listAssignments();
      res.json({ assignments });
    } catch (err) {
      console.error('List assignments error:', err);
      res.status(500).json({ error: 'Failed to load asset assignments.' });
    }
  });

  app.post('/api/assignments/assign', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const assetId = String(req.body?.asset_id ?? '').trim();
      const employeeId = String(req.body?.employee_id ?? '').trim();
      const assignedDate = String(
        req.body?.assigned_date ?? new Date().toISOString().slice(0, 10)
      ).trim();
      const conditionOut = String(req.body?.condition_out ?? 'Good').trim() || 'Good';
      const notes = String(req.body?.notes ?? '').trim();

      if (!assetId || !employeeId) {
        res.status(400).json({ error: 'Both asset and employee are required.' });
        return;
      }
      if (!isIsoDate(assignedDate)) {
        res.status(400).json({ error: 'Assignment date must be a valid YYYY-MM-DD date.' });
        return;
      }

      const [asset, employee] = await Promise.all([
        db.getAssetById(assetId),
        db.getEmployeeById(employeeId),
      ]);
      if (!asset) {
        res.status(404).json({ error: 'Selected asset not found.' });
        return;
      }
      if (asset.status !== 'Available') {
        res.status(400).json({
          error: `Asset "${asset.asset_tag}" is currently ${asset.status} and cannot be assigned.`,
        });
        return;
      }
      if (!employee) {
        res.status(404).json({ error: 'Selected employee not found.' });
        return;
      }
      if (employee.status !== 'active') {
        res.status(400).json({
          error: `Employee "${employee.full_name}" is inactive and cannot receive assets.`,
        });
        return;
      }

      const assignment = await db.assignAsset({
        assetId,
        employeeId,
        assignedByUserId: req.authUser!.id,
        assignedDate,
        conditionOut,
        notes,
      });
      res.status(201).json({ assignment });
    } catch (err) {
      console.error('Assign asset error:', err);
      res.status(500).json({ error: 'Failed to assign asset.' });
    }
  });

  app.post('/api/assignments/:id/return', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.getAssignmentById(id);
      if (!current) {
        res.status(404).json({ error: 'Assignment record not found.' });
        return;
      }
      if (current.status === 'Returned') {
        res.status(400).json({ error: 'This asset has already been returned.' });
        return;
      }

      const returnedDate = String(
        req.body?.returned_date ?? new Date().toISOString().slice(0, 10)
      ).trim();
      const conditionIn = String(req.body?.condition_in ?? 'Good').trim() || 'Good';
      const returnStatus = String(req.body?.return_status ?? 'Available');
      const notes = String(req.body?.notes ?? '').trim();

      if (!isIsoDate(returnedDate)) {
        res.status(400).json({ error: 'Return date must be a valid YYYY-MM-DD date.' });
        return;
      }
      if (
        returnStatus !== 'Available' &&
        returnStatus !== 'Under Maintenance' &&
        returnStatus !== 'Damaged'
      ) {
        res.status(400).json({ error: 'Invalid post-return asset status.' });
        return;
      }

      const updated = await db.returnAsset({
        assignmentId: id,
        returnedDate,
        conditionIn,
        returnStatus,
        notes,
      });
      res.json({ assignment: updated });
    } catch (err) {
      console.error('Return asset error:', err);
      res.status(500).json({ error: 'Failed to return asset.' });
    }
  });

  // -------------------------------------------------------------------------
  // Maintenance Routes
  // -------------------------------------------------------------------------
  app.get('/api/maintenance', requireAuth, async (_req, res) => {
    try {
      const logs = await db.listMaintenanceLogs();
      res.json({ maintenanceLogs: logs });
    } catch (err) {
      console.error('List maintenance error:', err);
      res.status(500).json({ error: 'Failed to load maintenance logs.' });
    }
  });

  app.post('/api/maintenance', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body ?? {};
      const asset_id = String(body.asset_id ?? '').trim();
      const issue_description = String(body.issue_description ?? '').trim();
      const maintenance_type = String(body.maintenance_type ?? '') as MaintenanceType;
      const vendor_or_technician = String(body.vendor_or_technician ?? '').trim();
      const service_date = String(body.service_date ?? '').trim();
      const next_service_date = body.next_service_date
        ? String(body.next_service_date).trim()
        : null;
      const cost = Number(body.cost ?? 0);
      const status = String(body.status ?? 'In Progress') as MaintenanceStatus;
      const notes = String(body.notes ?? '').trim();
      const setAssetUnderMaintenance = body.set_asset_under_maintenance !== false;

      if (!asset_id || !issue_description || !vendor_or_technician) {
        res.status(400).json({
          error: 'Asset, issue description, and technician/vendor are required.',
        });
        return;
      }
      if (!MAINTENANCE_TYPES.includes(maintenance_type)) {
        res.status(400).json({ error: 'Invalid maintenance type.' });
        return;
      }
      if (!MAINTENANCE_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid maintenance status.' });
        return;
      }
      if (!isIsoDate(service_date)) {
        res.status(400).json({ error: 'Service date must be a valid YYYY-MM-DD date.' });
        return;
      }
      if (next_service_date && !isIsoDate(next_service_date)) {
        res.status(400).json({
          error: 'Next service date must be a valid YYYY-MM-DD date.',
        });
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        res.status(400).json({ error: 'Maintenance cost must be a valid non-negative number.' });
        return;
      }

      const asset = await db.getAssetById(asset_id);
      if (!asset) {
        res.status(404).json({ error: 'Selected asset not found.' });
        return;
      }

      const log: MaintenanceLog = {
        id: `mnt-${crypto.randomUUID().slice(0, 8)}`,
        asset_id,
        issue_description,
        maintenance_type,
        vendor_or_technician,
        service_date,
        next_service_date,
        cost,
        status,
        recorded_by_user_id: req.authUser!.id,
        notes,
        created_at: new Date().toISOString(),
      };

      const created = await db.createMaintenanceLog(log, setAssetUnderMaintenance);
      res.status(201).json({ maintenanceLog: created });
    } catch (err) {
      console.error('Create maintenance error:', err);
      res.status(500).json({ error: 'Failed to create maintenance record.' });
    }
  });

  app.put('/api/maintenance/:id', requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.getMaintenanceById(id);
      if (!current) {
        res.status(404).json({ error: 'Maintenance record not found.' });
        return;
      }

      const body = req.body ?? {};
      const issue_description = String(
        body.issue_description ?? current.issue_description
      ).trim();
      const maintenance_type = String(
        body.maintenance_type ?? current.maintenance_type
      ) as MaintenanceType;
      const vendor_or_technician = String(
        body.vendor_or_technician ?? current.vendor_or_technician
      ).trim();
      const service_date = String(body.service_date ?? current.service_date).trim();
      const next_service_date =
        body.next_service_date === ''
          ? null
          : body.next_service_date !== undefined
            ? String(body.next_service_date).trim()
            : current.next_service_date;
      const cost = body.cost !== undefined ? Number(body.cost) : current.cost;
      const status = String(body.status ?? current.status) as MaintenanceStatus;
      const notes = String(body.notes ?? current.notes).trim();

      if (!issue_description || !vendor_or_technician) {
        res.status(400).json({
          error: 'Issue description and vendor/technician are required.',
        });
        return;
      }
      if (!MAINTENANCE_TYPES.includes(maintenance_type)) {
        res.status(400).json({ error: 'Invalid maintenance type.' });
        return;
      }
      if (!MAINTENANCE_STATUSES.includes(status)) {
        res.status(400).json({ error: 'Invalid maintenance status.' });
        return;
      }
      if (!isIsoDate(service_date)) {
        res.status(400).json({ error: 'Service date must be a valid YYYY-MM-DD date.' });
        return;
      }
      if (next_service_date && !isIsoDate(next_service_date)) {
        res.status(400).json({
          error: 'Next service date must be a valid YYYY-MM-DD date.',
        });
        return;
      }
      if (!Number.isFinite(cost) || cost < 0) {
        res.status(400).json({ error: 'Cost must be a non-negative number.' });
        return;
      }

      const updated = await db.updateMaintenanceLog(id, {
        issue_description,
        maintenance_type,
        vendor_or_technician,
        service_date,
        next_service_date,
        cost,
        status,
        notes,
      });
      res.json({ maintenanceLog: updated });
    } catch (err) {
      console.error('Update maintenance error:', err);
      res.status(500).json({ error: 'Failed to update maintenance record.' });
    }
  });

  app.delete('/api/maintenance/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = String(req.params.id);
      const deleted = await db.deleteMaintenanceLog(id);
      if (!deleted) {
        res.status(404).json({ error: 'Maintenance record not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete maintenance error:', err);
      res.status(500).json({ error: 'Failed to delete maintenance record.' });
    }
  });

  // -------------------------------------------------------------------------
  // Notifications Routes
  // -------------------------------------------------------------------------
  app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const notifications = await db.listNotifications(req.authUser!.id);
      res.json({ notifications });
    } catch (err) {
      console.error('Notifications error:', err);
      res.status(500).json({ error: 'Failed to load system alerts.' });
    }
  });

  app.post(
    '/api/notifications/acknowledge',
    requireAuth,
    async (req: AuthenticatedRequest, res) => {
      try {
        const alertKeys = Array.isArray(req.body?.alertKeys)
          ? req.body.alertKeys.map((k: unknown) => String(k))
          : [];
        if (alertKeys.length === 0) {
          res.status(400).json({ error: 'No alert keys specified.' });
          return;
        }
        await db.acknowledgeNotifications(req.authUser!.id, alertKeys);
        const notifications = await db.listNotifications(req.authUser!.id);
        res.json({ notifications });
      } catch (err) {
        console.error('Acknowledge notification error:', err);
        res.status(500).json({ error: 'Failed to acknowledge notifications.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // User Management Routes (Admin Only)
  // -------------------------------------------------------------------------
  app.get('/api/users', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const users = await db.listUsers();
      res.json({ users });
    } catch (err) {
      console.error('List users error:', err);
      res.status(500).json({ error: 'Failed to load user accounts.' });
    }
  });

  app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
      const body = req.body ?? {};
      const name = String(body.name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const role: UserRole = body.role === 'admin' ? 'admin' : 'staff';
      const department = String(body.department ?? 'IT Infrastructure').trim();
      const status = body.status === 'inactive' ? 'inactive' : 'active';

      if (!name || !email || !password) {
        res.status(400).json({ error: 'Name, email, and initial password are required.' });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const existing = await db.findUserByEmail(email);
      if (existing) {
        res.status(409).json({ error: `User with email "${email}" already exists.` });
        return;
      }

      const user = await db.createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        name,
        email,
        password_hash: hashPassword(password),
        role,
        department,
        status,
        created_at: new Date().toISOString(),
        last_login: null,
      });

      res.status(201).json({ user });
    } catch (err) {
      console.error('Create user error:', err);
      res.status(500).json({ error: 'Failed to create user account.' });
    }
  });

  app.put('/api/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      const current = await db.findUserById(id);
      if (!current) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const body = req.body ?? {};
      const name = String(body.name ?? current.name).trim();
      const email = String(body.email ?? current.email).trim().toLowerCase();
      const role: UserRole =
        body.role === 'admin' || body.role === 'staff' ? body.role : current.role;
      const department = String(body.department ?? current.department).trim();
      const status =
        body.status === 'inactive' || body.status === 'active'
          ? body.status
          : current.status;
      const password = body.password ? String(body.password) : '';

      if (!name || !email) {
        res.status(400).json({ error: 'Name and email are required.' });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      if (password && password.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters.' });
        return;
      }

      const allUsers = await db.listUsers();
      if (allUsers.some((u) => u.id !== id && u.email.toLowerCase() === email)) {
        res.status(409).json({ error: `Email "${email}" is already used by another user.` });
        return;
      }

      const activeAdmins = allUsers.filter(
        (u) => u.id !== id && u.role === 'admin' && u.status === 'active'
      );
      if (activeAdmins.length === 0 && (role !== 'admin' || status !== 'active')) {
        res.status(400).json({
          error: 'At least one active administrator account must remain in the system.',
        });
        return;
      }

      const patch: Parameters<typeof db.updateUser>[1] = {
        name,
        email,
        role,
        department,
        status,
      };
      if (password) {
        patch.password_hash = hashPassword(password);
      }

      const updated = await db.updateUser(id, patch);
      res.json({ user: updated });
    } catch (err) {
      console.error('Update user error:', err);
      res.status(500).json({ error: 'Failed to update user.' });
    }
  });

  app.delete('/api/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const id = String(req.params.id);
      if (id === req.authUser!.id) {
        res.status(400).json({ error: 'You cannot delete your own active session account.' });
        return;
      }
      const allUsers = await db.listUsers();
      const target = allUsers.find((u) => u.id === id);
      if (!target) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      const remainingAdmins = allUsers.filter(
        (u) => u.id !== id && u.role === 'admin' && u.status === 'active'
      );
      if (remainingAdmins.length === 0) {
        res.status(400).json({ error: 'Cannot delete the last active administrator.' });
        return;
      }
      await db.deleteUser(id);
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete user error:', err);
      res.status(500).json({ error: 'Failed to delete user.' });
    }
  });

  return app;
}
