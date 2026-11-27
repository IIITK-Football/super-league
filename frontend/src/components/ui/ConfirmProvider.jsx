import { useCallback, useRef, useState } from 'react';
import { ConfirmContext } from './useConfirm';
import { ConfirmDialog } from './ConfirmDialog';

// Mount once near the top of the app. One confirmation at a time; a new request resolves the old one as false.
export function ConfirmProvider({ children }) {
  const [options, setOptions] = useState(null);
  const pending = useRef(null);

  const answer = useCallback((value) => {
    pending.current?.(value);
    pending.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback(
    (next) => new Promise((resolve) => {
      pending.current?.(false);
      pending.current = resolve;
      setOptions(next);
    }),
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={options !== null}
        onOpenChange={(open) => { if (!open) answer(false); }}
        title={options?.title}
        description={options?.description}
        confirmLabel={options?.confirmLabel}
        tone={options?.tone}
        onConfirm={() => answer(true)}
      />
    </ConfirmContext.Provider>
  );
}
