import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Counts up to a whole number once when it first scrolls into view (shows the number at once under reduced motion,
// in tests and when it is not a number).
export function NumberTicker({ value, duration = 900, className }) {
  const target = Number(value);
  const valid = Number.isFinite(target) && Number.isInteger(target);
  const [shown, setShown] = useState(valid && !reduced() && typeof IntersectionObserver !== 'undefined' ? 0 : value);
  const ref = useRef(null);

  useEffect(() => {
    if (!valid || reduced() || typeof IntersectionObserver === 'undefined') { setShown(value); return undefined; }
    let frame;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        setShown(Math.round(target * (1 - (1 - t) ** 3)));
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [target, valid, value, duration]);

  return <span ref={ref} className={className}>{shown}</span>;
}
