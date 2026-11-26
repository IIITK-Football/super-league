import { forwardRef } from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { TextInput } from './TextInput';

// Native date and time pickers (reliable on every phone) in the glass well, with a matching icon.
export const DateTimeField = forwardRef(function DateTimeField({ type = 'date', ...props }, ref) {
  return <TextInput ref={ref} type={type} className="relative" icon={type === 'time' ? Clock : CalendarDays} inputClassName="tabular-nums" {...props} />;
});
