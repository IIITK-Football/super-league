import { cn } from '../../utils/cn';

// A tile with a soft light that follows the pointer (see .spotlight in index.css). Renders as any element or Link.
export function Spotlight({ as: Tag = 'div', className, onPointerMove, ...props }) {
  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
    onPointerMove?.(event);
  };
  return <Tag className={cn('spotlight', className)} onPointerMove={move} {...props} />;
}
