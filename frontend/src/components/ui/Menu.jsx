import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { cn } from '../../utils/cn';
import { buttonClasses } from './buttonClasses';

// Keyboard-first action menu. Arrow keys move, Enter selects, Escape closes and returns focus to the trigger.
export function Menu(props) {
  return <DropdownMenu.Root {...props} />;
}

export function MenuTrigger({ variant = 'secondary', size = 'md', className, ...props }) {
  return <DropdownMenu.Trigger className={buttonClasses(variant, size, className)} {...props} />;
}

export function MenuContent({ align = 'end', className, ...props }) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn('z-[80] min-w-48 rounded-ctl border border-line bg-surf p-1 motion-safe:animate-fade-in', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const TONES = {
  default: 'text-ink',
  danger: 'text-live',
};

export function MenuItem({ tone = 'default', className, ...props }) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex min-h-11 cursor-default select-none items-center gap-2 rounded-ctl px-3 text-sm outline-none',
        'data-[highlighted]:bg-raise data-[disabled]:pointer-events-none data-[disabled]:text-mut',
        TONES[tone] ?? TONES.default,
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }) {
  return <DropdownMenu.Separator className={cn('my-1 h-px bg-line', className)} {...props} />;
}
