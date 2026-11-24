import {
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

// Minimal Google Drive scope: only files created by IND AGENT or opened by the user.
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Combined Workspace scopes configured for this application.
export const SCOPES = [...GMAIL_SCOPES, ...DRIVE_SCOPES];

function buildProvider(scopes: string[]): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of scopes) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'consent' });
  return provider;
}

/**
 * Triggers Google OAuth popup for Gmail minimal scopes and returns the access token ONCE
 * so the caller immediately stores it in the server's AES-256-GCM per-user token vault.
 */
export async function signInWithGoogleGmail(): Promise<{
  user: User;
  accessToken: string;
}> {
  const result = await signInWithPopup(auth, buildProvider(GMAIL_SCOPES));
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google sign-in completed, but no Gmail access token was returned.');
  }
  return {
    user: result.user,
    accessToken: credential.accessToken,
  };
}

/**
 * Triggers Google OAuth popup requesting ONLY the minimal `drive.file` scope
 * and returns the access token ONCE for server-side encrypted storage.
 */
export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  const result = await signInWithPopup(auth, buildProvider(DRIVE_SCOPES));
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google sign-in completed, but no Google Drive access token was returned.');
  }
  return {
    user: result.user,
    accessToken: credential.accessToken,
  };
}

export async function signOutGoogleFirebase(): Promise<void> {
  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase sign-out errors if user was already signed out
  }
}
