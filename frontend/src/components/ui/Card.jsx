import { cn } from '../../utils/cn';

export function Card({ as: Tag = 'div', className, ...props }) {
  return <Tag className={cn('rounded-card border border-line bg-surf p-4 sm:p-5', className)} {...props} />;
}
