import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/ui';

// Any address the app does not know, including a division that does not exist.
export function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-16">
      <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">Page not found</h1>
      <p className="text-mut">
        This address does not match a page or a division. Check the link, or go back to the home page.
      </p>
      <Link to="/" className={buttonClasses('primary', 'lg')}>Back to home</Link>
    </section>
  );
}
