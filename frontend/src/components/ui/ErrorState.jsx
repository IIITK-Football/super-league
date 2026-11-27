import { Button } from './Button';

// A failed load: the message and a retry. onRetry is optional; without it only the message shows.
export function ErrorState({ title = 'Could not load this', message, onRetry, className = '' }) {
  return (
    <div role="alert" className={`flex flex-col items-start gap-3 rounded-card border border-live/40 bg-surf p-6 ${className}`}>
      <p className="font-display text-xl font-bold text-ink">{title}</p>
      {message && <p className="text-mut">{message}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
