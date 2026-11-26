import { useEffect, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cn } from '../../utils/cn';
import { Button } from './Button';
import { buttonClasses } from './buttonClasses';
import { Notice } from './Notice';

// Bottom sheet on phones, centred card from md up. Escape and Cancel close it; focus starts on Cancel.
// onConfirm may return a promise: the dialog stays open, shows busy, and shows a rejection inline.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  children,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const close = (next) => {
    if (!busy) onOpenChange?.(next);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm?.();
      onOpenChange?.(false);
    } catch (err) {
      setError(err?.message || 'Could not complete this action. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={close}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-bg/70 motion-safe:animate-fade-in" />
        <AlertDialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-[80] flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-card border-t border-line bg-surf p-5 motion-safe:animate-sheet-up',
            'md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:border md:motion-safe:animate-fade-in',
          )}
        >
          <div className="space-y-2">
            <AlertDialog.Title className="font-display text-2xl font-bold text-ink">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-mut">{description}</AlertDialog.Description>
          </div>
          {children}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel disabled={busy} className={buttonClasses('secondary')}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={busy} onClick={confirm}>
              {busy ? 'Working...' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
