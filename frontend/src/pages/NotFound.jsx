import { Link } from 'react-router-dom';

// Any address the app does not know, including a division that does not exist.
export function NotFound() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-start justify-center gap-6 py-16">
      <h1 className="font-display text-6xl text-ink sm:text-8xl">Not found</h1>
      <p className="text-lg text-mut">
        This address does not match a page or a division. Check the link, or go back to the home page.
      </p>
      <Link to="/" className="inline-flex min-h-11 items-center rounded-pill bg-ink px-6 text-sm font-black uppercase tracking-[0.2em] text-bg transition hover:opacity-85">
        Back to home
      </Link>
    </section>
  );
}
