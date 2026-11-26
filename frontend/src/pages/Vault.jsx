import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { NewsArticle } from '../components/NewsArticle';
import { EmptyState, ErrorState, Skeleton } from '../components/ui';
import { formatNewsDate } from '../lib/newsDate';
import { cn } from '../utils/cn';

const CATEGORIES = ['Latest News', 'Official Editorial', 'Match Reports', 'Satire', 'Features'];

// The lead story: a wide tile, photo on the left, headline set large.
function FeaturedStory({ article }) {
  const headline = article.headline || article.title || 'Untitled article';
  const imgUrl = article.imgUrl || article.image_url;
  const date = formatNewsDate(article.date);
  return (
    <Link to={`/article/${article.id}`} className="glass lift group grid overflow-hidden rounded-card md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc">
      {imgUrl && (
        <img src={imgUrl} alt="" className="aspect-[16/10] w-full object-cover grayscale transition duration-500 group-hover:grayscale-0 md:aspect-auto md:h-full" />
      )}
      <div className="flex flex-col justify-end gap-4 p-5 sm:p-8">
        {(article.category || date) && (
          <p className="eyebrow flex flex-wrap gap-2">
            {article.category && <span>{article.category}</span>}
            {date && <time dateTime={article.date}>{date}</time>}
          </p>
        )}
        <h2 className="font-display text-3xl leading-none text-ink sm:text-5xl">{headline}</h2>
      </div>
    </Link>
  );
}

// The news list. Changing the category reloads only the list: the page header and the filter keep their place and focus.
export function Vault() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const { data, error, loading, retry } = useApi(`/news?category=${encodeURIComponent(category)}`);
  const articles = data?.data || [];
  const [lead, ...rest] = articles;

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-12">
      <header className="space-y-6">
        <div className="space-y-3">
          <h1 className="font-display text-4xl text-ink sm:text-6xl">News</h1>
          <p className="text-mut">Match reports, features and official notices.</p>
        </div>
        <div role="group" aria-label="Category" className="glass inline-flex max-w-full gap-1 overflow-x-auto rounded-pill p-1 no-scrollbar">
          {CATEGORIES.map((name) => {
            const active = name === category;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(name)}
                className={cn('min-h-11 shrink-0 whitespace-nowrap rounded-pill px-4 text-xs font-bold uppercase tracking-wider transition-colors duration-300 sm:px-5 sm:text-sm', active ? 'bg-ink text-bg' : 'text-mut hover:text-ink')}
              >
                {name}
              </button>
            );
          })}
        </div>
      </header>

      {error ? (
        <ErrorState title="News could not load" message={error.message} onRetry={retry} />
      ) : loading ? (
        <ul aria-busy="true" aria-label="Loading news" className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          <li className="sm:col-span-2 xl:col-span-3"><Skeleton className="h-80 w-full rounded-card" /></li>
          {[0, 1, 2].map((i) => <li key={i}><Skeleton className="h-64 rounded-card" /></li>)}
        </ul>
      ) : articles.length === 0 ? (
        <EmptyState title="No articles in this category">
          Checked the {category.toLowerCase()} list. New articles appear here when they are published.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <FeaturedStory article={lead} />
          {rest.length > 0 && (
            <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {rest.map((article) => (
                <li key={article.id}>
                  <Link to={`/article/${article.id}`} className="block rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc">
                    <NewsArticle article={article} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
