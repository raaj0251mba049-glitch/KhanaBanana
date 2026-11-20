import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  override componentDidCatch(error: Error) {
    console.error('Uncaught application error:', error);
  }

  override render() {
    if (this.state.hasError) {
      let friendlyMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendlyMsg = `Database error (${parsed.operationType}): ${parsed.error}`;
        }
      } catch {
        // Keep plain message
      }

      return (
        <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#E6E0D3] rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#E06D2B]/10 text-[#E06D2B] flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="font-display text-xl font-semibold text-[#1A2421] mb-2">
              Kitchen hiccup!
            </h1>
            <p className="text-sm text-[#576560] mb-6 break-words">{friendlyMsg}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1B4D3E] text-white text-sm font-medium hover:bg-[#13382D] transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              Reload KhanaBanana
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
