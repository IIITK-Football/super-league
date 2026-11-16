import { useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise = null;

// Public site key (not a secret). Read at call time so it can be set per build or test.
export function turnstileSiteKey() {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC; // Cloudflare requires loading its script from its own origin
      script.async = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Turnstile script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Cloudflare Turnstile. Renders nothing when no site key is configured (verification off).
 * `onToken(token)` gets a single-use token, or null when it expires or fails. Change `resetKey`
 * after each attempt to get a fresh token. Supabase Auth verifies the token server-side.
 */
export function TurnstileWidget({ siteKey = turnstileSiteKey(), onToken, resetKey = 0 }) {
  const container = useRef(null);
  const widgetId = useRef(null);
  const lastReset = useRef(resetKey);
  const onTokenRef = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return;
        widgetId.current = turnstile.render(container.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => {
            setFailed(false);
            onTokenRef.current?.(token);
          },
          'expired-callback': () => onTokenRef.current?.(null),
          'error-callback': () => {
            setFailed(true);
            onTokenRef.current?.(null);
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onTokenRef.current?.(null);
      });
    return () => {
      cancelled = true;
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === lastReset.current) return;
    lastReset.current = resetKey;
    if (widgetId.current !== null && window.turnstile) window.turnstile.reset(widgetId.current);
    onTokenRef.current?.(null);
  }, [resetKey]);

  if (!siteKey) return null;
  return (
    <div>
      <div ref={container} data-testid="turnstile" />
      {failed && (
        <p role="alert" className="mt-2 text-xs font-bold text-red-400">
          The verification could not load. Check your connection and reload the page.
        </p>
      )}
    </div>
  );
}
