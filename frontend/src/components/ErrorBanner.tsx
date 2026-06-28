// Shared API-error banner with a retry action. Every tab surfaces fetch
// failures the same way; this is the single source of that markup so the
// styling and copy stay consistent.
export function ErrorBanner({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-6 flex items-center justify-between gap-4 rounded-md border border-border bg-surface px-5 py-3 text-sm"
    >
      <span className="text-muted">Couldn&apos;t reach the API - {error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-accent transition-opacity hover:opacity-80"
      >
        Retry
      </button>
    </div>
  );
}
