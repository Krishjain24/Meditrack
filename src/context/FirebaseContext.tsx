import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  auth,
  signInWithGoogleCloud,
  signOutGoogleCloud,
} from "../firebase";
import {
  ensureUserWorkspaceSeeded,
  subscribeToWorkspaceDashboard,
} from "../services/firestoreSync";
import type { DashboardPayload } from "../types/meditrack";

export interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  cloudActive: boolean;
  cloudBootstrapping: boolean;
  cloudError: string;
  cloudDashboard: DashboardPayload | null;
  signInWithGoogle: () => Promise<void>;
  signOutCloud: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [cloudBootstrapping, setCloudBootstrapping] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string>("");
  const [cloudDashboard, setCloudDashboard] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCloudDashboard(null);
        setCloudError("");
      }
    });
    return () => unsub();
  }, []);

  // Only attach onSnapshot listeners once authReady && authenticated & verified
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      return;
    }

    let cancelled = false;
    let unsubSnapshot: (() => void) | null = null;
    setCloudBootstrapping(true);
    setCloudError("");

    void ensureUserWorkspaceSeeded(user.uid)
      .then(() => {
        if (cancelled) return;
        unsubSnapshot = subscribeToWorkspaceDashboard(
          user.uid,
          (payload) => {
            if (!cancelled) {
              setCloudDashboard(payload);
              setCloudBootstrapping(false);
            }
          },
          (err) => {
            if (!cancelled) {
              setCloudError(err.message);
              setCloudBootstrapping(false);
            }
          }
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setCloudError(
            err instanceof Error ? err.message : "Failed to initialize Firestore workspace."
          );
          setCloudBootstrapping(false);
        }
      });

    return () => {
      cancelled = true;
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    setCloudError("");
    try {
      await signInWithGoogleCloud();
    } catch (err) {
      setCloudError(
        err instanceof Error ? err.message : "Google Sign-In failed or was cancelled."
      );
    }
  }, []);

  const signOutCloud = useCallback(async () => {
    setCloudError("");
    await signOutGoogleCloud();
  }, []);

  const cloudActive = Boolean(authReady && user && user.emailVerified);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        cloudActive,
        cloudBootstrapping,
        cloudError,
        cloudDashboard,
        signInWithGoogle,
        signOutCloud,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebaseCloud(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error("useFirebaseCloud must be used inside FirebaseProvider");
  }
  return ctx;
}
