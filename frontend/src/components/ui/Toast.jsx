import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { SPRING } from './springs';
import { dismissToast, readToasts, subscribe } from './toastStore';

const TONES = {
  success: { Icon: CircleCheck, className: 'text-acc2' },
  error: { Icon: CircleAlert, className: 'text-live' },
  info: { Icon: Info, className: 'text-ink' },
};

// Mount once near the root. Toasts rise from the bottom; errors are announced assertively.
export function Toaster() {
  const list = useSyncExternalStore(subscribe, readToasts, readToasts);
  return createPortal(
    <MotionConfig reducedMotion="user">
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <AnimatePresence initial={false}>
          {list.map((t) => {
            const { Icon, className } = TONES[t.tone] ?? TONES.info;
            return (
              <motion.div
                key={t.id}
                layout
                role={t.tone === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: 24, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
                transition={SPRING}
                className="float-glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card px-4 py-3"
              >
                <Icon size={20} aria-hidden="true" className={cn('mt-0.5 shrink-0', className)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-ink">{t.title}</p>
                  {t.description && <p className="text-sm text-mut">{t.description}</p>}
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => dismissToast(t.id)} className="-m-2 flex size-11 shrink-0 items-center justify-center rounded-pill text-mut hover:text-ink">
                  <X size={16} aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </MotionConfig>,
    document.body,
  );
}
