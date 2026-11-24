import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let friendly = error?.message || 'An unexpected application error occurred.';
    try {
      const parsed = JSON.parse(friendly) as { error?: string; operationType?: string };
      if (parsed && typeof parsed.error === 'string') {
        friendly = `Cloud sync permission error (${parsed.operationType ?? 'operation'}): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: friendly };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('IND AGENT ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F8FAFD] dark:bg-[#131314] p-6 text-[#1F1F1F] dark:text-[#E3E3E3]">
          <div className="w-full max-w-md rounded-2xl border border-[#DDE3EA] dark:border-[#333537] bg-white dark:bg-[#1E1F20] p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2.5 text-[#D93025] dark:text-[#F28B82]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h1 className="text-base font-semibold">Something went wrong</h1>
            </div>
            <p className="text-xs leading-relaxed text-[#5F6368] dark:text-[#9AA0A6] break-words">
              {this.state.message}
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1A73E8] px-4 py-2 text-xs font-medium text-white hover:bg-[#1557B0] transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reload Workspace
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '' })}
                className="rounded-full border border-[#DDE3EA] dark:border-[#3C4043] px-4 py-2 text-xs font-medium text-[#444746] dark:text-[#C4C7C5] hover:bg-[#F0F4F9] dark:hover:bg-[#282A2C] transition-colors"
              >
                Try Recovering
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
