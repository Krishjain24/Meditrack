import { Component, type ErrorInfo, type ReactNode } from "react";
import { FIRESTORE_DATABASE_ID, FIREBASE_PROJECT_ID } from "../firebase";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  isQuotaError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: "",
    isQuotaError: false,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const msg = error?.message || "Unexpected application error";
    const isQuota = msg.toLowerCase().includes("quota exceeded");
    return {
      hasError: true,
      errorMessage: msg,
      isQuotaError: isQuota,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("MediTrack ErrorBoundary caught error:", error, info);
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const upgradeUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-lg w-full bg-white border border-rose-200 rounded-xl p-6 space-y-4 shadow-sm"
        >
          <h1 className="text-lg font-bold text-slate-900">
            {this.state.isQuotaError
              ? "Firestore Daily Quota Reached"
              : "Database Sync Error"}
          </h1>
          <p className="text-sm text-slate-600">
            {this.state.isQuotaError
              ? "Free daily Firestore read/write units were exceeded. Quota resets tomorrow, or you can upgrade the project database plan."
              : "An unexpected error occurred while synchronizing with the cloud database."}
          </p>
          {this.state.isQuotaError && (
            <p className="text-xs">
              <a
                href={upgradeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline font-medium"
              >
                Open Firestore Database Billing &amp; Quota Details
              </a>
            </p>
          )}
          <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-700 overflow-x-auto max-h-40">
            {this.state.errorMessage}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
          >
            Reload Application
          </button>
        </div>
      </div>
    );
  }
}
