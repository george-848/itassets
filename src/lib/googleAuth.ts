import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Unsubscribe,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Keep Google OAuth access token strictly in memory (never localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function initGoogleAuthListener(): Unsubscribe {
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser || !isSigningIn) {
      if (!firebaseUser) {
        cachedAccessToken = null;
      }
    }
  });
}

export async function googleSignIn(): Promise<{
  accessToken: string;
  email: string | null;
  name: string | null;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in did not return an access token.');
    }
    cachedAccessToken = credential.accessToken;
    return {
      accessToken: cachedAccessToken,
      email: result.user.email,
      name: result.user.displayName,
    };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Sign-in popup was blocked by your browser. Please allow popups and try again.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      const host =
        typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${host}" is not authorized for Google Sign-In. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`
      );
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Google sign-in failed. Please try again.');
  } finally {
    isSigningIn = false;
  }
}

export async function connectFirebaseGoogleAccount(): Promise<{
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }
    return {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      emailVerified: result.user.emailVerified,
    };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Google sign-in popup was closed before completing.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Sign-in popup was blocked by your browser. Please allow popups and try again.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      const host =
        typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      throw new Error(
        `Domain "${host}" is not authorized for Google Sign-In. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`
      );
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to connect Google account to Firebase.');
  } finally {
    isSigningIn = false;
  }
}

export async function googleSignOut(): Promise<void> {
  cachedAccessToken = null;
  try {
    await signOut(auth);
  } catch {
    // Ignore Firebase signOut errors if not signed in via Google
  }
}
