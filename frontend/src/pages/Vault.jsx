import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { NewsArticle } from '../components/NewsArticle';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';

const CATEGORIES = ['Latest News', 'Official Editorial', 'Match Reports', 'Satire', 'Features'];

// The news list. Changing the category reloads only the list: the page header and the filter keep their place and focus.
export function Vault() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const { data, error, loading, retry } = useApi(`/news?category=${encodeURIComponent(category)}`);
  const articles = data?.data || [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold text-ink sm:text-5xl">News</h1>
          <p className="mt-1 text-mut">Match reports, features and official notices.</p>
        </div>
        <label className="grid gap-1 text-sm font-semibold text-mut">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="min-h-11 rounded-ctl border border-line bg-surf px-3 text-base text-ink"
          >
            {CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </header>

      {error ? (
        <ErrorState title="News could not load" message={error.message} onRetry={retry} />
      ) : loading ? (
        <ul aria-busy="true" aria-label="Loading news" className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <li key={i}><Skeleton className="h-64 rounded-card" /></li>)}
        </ul>
      ) : articles.length === 0 ? (
        <EmptyState title="No articles in this category">
          Checked the {category.toLowerCase()} list. New articles appear here when they are published.
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {articles.map((article) => (
            <li key={article.id}>
              <Link to={`/article/${article.id}`} className="block rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc">
                <NewsArticle article={article} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
