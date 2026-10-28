import { Component, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';

const isArabic = () => document.documentElement.lang === 'ar';

/**
 * lazy() that survives deploys: if a page's code chunk is gone (a new version
 * was published while the app was open) or the network blipped, retry once,
 * then reload the page a single time to fetch the new bundle.
 */
export function lazyRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch {
      await new Promise((r) => setTimeout(r, 600));
      try {
        return await load();
      } catch (err) {
        const key = 'chunk-reload-at';
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(key) ?? 0);
          sessionStorage.setItem(key, String(Date.now()));
        } catch {
          /* storage blocked */
        }
        if (Date.now() - last > 30_000) {
          location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      }
    }
  });
}

export function PageSpinner() {
  return (
    <div className="grid h-64 place-items-center" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-current text-muted" />
    </div>
  );
}

/** Keeps one broken screen from blanking the whole app; offers a retry instead. */
export class ErrorBoundary extends Component<{ children: ReactNode; full?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen crashed', error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const ar = isArabic();
    return (
      <div className={this.props.full ? 'grid min-h-dvh place-items-center bg-bg p-6' : 'grid min-h-[50vh] place-items-center p-6'}>
        <div className="max-w-sm text-center">
          <p className="text-xl font-display">{ar ? 'صار خلل بعرض هالصفحة' : 'This screen hit a problem'}</p>
          <p className="mt-2 text-sm text-muted">{ar ? 'جرّب مرة ثانية. بياناتك بأمان.' : 'Try again — your data is safe.'}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-bg"
            >
              <RotateCcw className="h-4 w-4" /> {ar ? 'حاول مجددًا' : 'Try again'}
            </button>
            <button onClick={() => location.reload()} className="rounded-xl border border-line px-4 py-2.5 text-sm">
              {ar ? 'إعادة تحميل' : 'Reload'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
