import { forwardRef } from 'react';
import { cn } from '../../utils/cn';
import { CONTROL } from './controlClasses';

const SIZES = { md: 'min-h-11', lg: 'min-h-13 text-lg sm:text-base' };

// A text input in a glass well. `icon` is a lucide component drawn at the leading edge.
export const TextInput = forwardRef(function TextInput({ icon: Icon, size = 'md', className, inputClassName, ...props }, ref) {
  return (
    <div className={cn(CONTROL, SIZES[size], 'flex items-center gap-2.5 py-0', className)}>
      {Icon && <Icon size={18} aria-hidden="true" className="shrink-0 text-mut" />}
      <input ref={ref} className={cn('h-full min-h-[inherit] w-full min-w-0 bg-transparent outline-none placeholder:text-mut/80', inputClassName)} {...props} />
    </div>
  );
});

export const TextArea = forwardRef(function TextArea({ className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, 'resize-y py-3 leading-relaxed', className)} {...props} />;
});
