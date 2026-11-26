import { createContext, useContext } from 'react';

// Shared by ConfirmProvider (which renders the dialog) and useConfirm (which asks it).
export const ConfirmContext = createContext(null);

// const ok = await confirm({ title, description, confirmLabel, tone }) resolves true or false.
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm needs <ConfirmProvider> above it');
  return confirm;
}
