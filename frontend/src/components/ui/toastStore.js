// One app-wide queue, so any component can raise a toast without a provider.
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());
export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// toast({ title, description, tone: 'success' | 'error' | 'info', duration }). Errors stay up longer.
export function toast({ title, description, tone = 'info', duration = tone === 'error' ? 8000 : 4000 }) {
  const id = nextId++;
  toasts = [...toasts.slice(-2), { id, title, description, tone }];
  emit();
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export function useToast() {
  return { toast, dismiss: dismissToast };
}

export const readToasts = () => toasts;
