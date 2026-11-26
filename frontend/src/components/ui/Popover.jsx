import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '../../utils/cn';
import { buttonClasses } from './buttonClasses';

// Small non-modal panel anchored to a trigger. Escape and outside click close it.
export function Popover(props) {
  return <PopoverPrimitive.Root {...props} />;
}

export function PopoverTrigger({ variant = 'secondary', size = 'md', className, ...props }) {
  return <PopoverPrimitive.Trigger className={buttonClasses(variant, size, className)} {...props} />;
}

export function PopoverContent({ align = 'start', className, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 w-72 rounded-card border border-line bg-surf p-4 text-sm text-ink motion-safe:animate-fade-in', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
