import { initializeApp } from "firebase/app";
import {
  type Auth,
  GoogleAuthProvider,
  type User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  type Firestore,
  getFirestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
const auth: Auth | null = app ? getAuth(app) : null;
const db: Firestore | null = app ? getFirestore(app) : null;
const forecastDb: Firestore | null = app ? getFirestore(app, "nycdata") : null;
const provider = auth ? new GoogleAuthProvider() : null;

export function listenAuth(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => undefined;
  }

  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<void> {
  if (!auth || !provider) {
    throw new Error("Firebase auth is not configured in this environment");
  }

  await signInWithPopup(auth, provider);
}

export async function signOutUser(): Promise<void> {
  if (!auth) {
    return;
  }

  await signOut(auth);
}

export async function getBearerTokenOrDevToken(): Promise<string> {
  if (!auth) {
    return "anonymous-local-user";
  }

  const user = auth.currentUser;
  if (!user) {
    return "anonymous-local-user";
  }

  return user.getIdToken();
}

export function getDb(): Firestore | null {
  return db;
}

export function getForecastDb(): Firestore | null {
  return forecastDb;
}

export function isFirebaseConfigured(): boolean {
  return firebaseEnabled;
}
