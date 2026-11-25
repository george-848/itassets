import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  details: string | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
    details: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let parsedMessage = error.message || 'An unexpected application error occurred.';
    let details: string | null = null;

    if (parsedMessage.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(parsedMessage) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error) {
          parsedMessage = parsed.error;
          details = [
            parsed.operationType ? `Operation: ${parsed.operationType}` : null,
            parsed.path ? `Path: ${parsed.path}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
        }
      } catch {
        // Keep raw error message
      }
    }

    return {
      hasError: true,
      errorMessage: parsedMessage,
      details,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught UI error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, errorMessage: '', details: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[var(--av-bg)] text-[var(--av-text)] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-7 shadow-xl">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 mb-4">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="font-display text-lg font-bold text-[var(--av-text)]">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-[var(--av-text-muted)] leading-relaxed">
            {this.state.errorMessage}
          </p>
          {this.state.details && (
            <p className="mt-2 rounded-lg bg-[var(--av-surface-muted)] px-3 py-2 font-mono text-xs text-[var(--av-text-subtle)]">
              {this.state.details}
            </p>
          )}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Reload Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }
}
