// Checked and empty: say what was checked and what to do next. Never a placeholder that looks like data.
export function EmptyState({ title, children, action, className = '' }) {
  return (
    <div className={`flex flex-col items-start gap-3 rounded-card border border-dashed border-line p-6 ${className}`}>
      <p className="font-display text-xl font-bold text-ink">{title}</p>
      {children && <div className="text-mut">{children}</div>}
      {action}
    </div>
  );
}
