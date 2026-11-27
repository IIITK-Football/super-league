import { Loader2 } from 'lucide-react';

export function Loader({ text = 'Loading...', fullScreen = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center ${fullScreen ? 'min-h-[60vh]' : 'p-8 w-full h-full'} ${className}`}>
      <Loader2 className="w-8 h-8 md:w-12 md:h-12 mb-4 animate-spin text-white/20" />
      {text && (
        <span className="font-black tracking-[0.3em] uppercase animate-pulse text-xs sm:text-sm text-zinc-500">
          {text}
        </span>
      )}
    </div>
  );
}
