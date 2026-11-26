import { useEffect, useRef } from 'react';

// Closes a popover on Escape or a press outside it. The returned ref goes on the popover's wrapper element.
export function usePopover(open, onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') closeRef.current?.();
    };
    const onPress = (event) => {
      if (ref.current && !ref.current.contains(event.target)) closeRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  return ref;
}
