import { Loader2 } from 'lucide-react';

export function Loader({ text = 'Loading...', fullScreen = false, className = '' }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center text-mut ${fullScreen ? 'min-h-[60vh]' : 'p-8 w-full h-full'} ${className}`}>
      <Loader2 aria-hidden="true" className="w-8 h-8 md:w-12 md:h-12 mb-4 animate-spin motion-reduce:animate-none" />
      {text && <span className="text-xs sm:text-sm">{text}</span>}
    </div>
  );
}
