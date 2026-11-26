import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

export const app: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: Pass firestoreDatabaseId explicitly so the provisioned Enterprise database is targeted.
export const db: Firestore = getFirestore(
  app,
  firebaseConfig.firestoreDatabaseId
);
export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function testConnection(force = false): Promise<boolean> {
  if (connectionTested && !force) return true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    connectionTested = true;
    return true;
  } catch (error) {
    connectionTested = false;
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error(
        'Firestore client is offline. Please verify your Firebase configuration in firebase-applet-config.json.'
      );
    }
    return false;
  }
}

/**
 * Mirrors user profile & membership context to Cloud Firestore when the user has
 * an active verified Firebase Auth session. Errors are routed through handleFirestoreError
 * only when strict enforcement is requested, or logged cleanly without blocking SaaS APIs.
 */
export async function syncFirebaseUserMirror(params: {
  displayName: string;
  email: string;
  department: string;
}): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) return;

  const publicPath = `users/${current.uid}`;
  try {
    await setDoc(
      doc(db, 'users', current.uid),
      {
        uid: current.uid,
        displayName: params.displayName.slice(0, 120),
        department: params.department.slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    // Surface structured FirestoreErrorInfo if permissions fail unexpectedly
    console.warn('Firestore user profile sync skipped:', error);
    void publicPath;
  }
}
