import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Share2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatNewsDate } from '../components/NewsArticle';
import { Button, EmptyState, ErrorState, Skeleton, buttonClasses } from '../components/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Loads one article. 'missing' is a checked answer (no such row); 'error' is a failed request.
function useArticle(id) {
  const [state, setState] = useState({ status: 'loading', article: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!UUID.test(id || '')) {
      setState({ status: 'missing', article: null });
      return undefined;
    }
    setState({ status: 'loading', article: null });
    supabase.from('newsletter').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) setState({ status: 'error', article: null });
      else if (!data) setState({ status: 'missing', article: null });
      else setState({ status: 'ready', article: data });
    });
    return () => { cancelled = true; };
  }, [id, attempt]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export function ArticleView() {
  const { id } = useParams();
  const { status, article, retry } = useArticle(id);
  const [copied, setCopied] = useState(false);

  const back = (
    <Link to="/vault" className={buttonClasses('quiet', 'sm', 'px-0')}>
      <ArrowLeft size={18} aria-hidden="true" />
      Back to news
    </Link>
  );

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading article" className="mx-auto max-w-3xl space-y-5">
        {back}
        <Skeleton className="aspect-[16/9] w-full rounded-card" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {back}
        <ErrorState title="This article could not load" message="Check your connection and try again." onRetry={retry} />
      </div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        {back}
        <EmptyState title="Article not found">
          This article does not exist or has been removed.
        </EmptyState>
      </div>
    );
  }

  const title = article.title || 'Untitled article';
  const date = formatNewsDate(article.date);
  const meta = [article.category, date, article.author].filter(Boolean);
  const blocks = Array.isArray(article.content) ? article.content : [];
  const paragraphs = typeof article.content === 'string' ? article.content.split('\n').filter((p) => p.trim()) : [];

  const share = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/article/${article.id}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => {});
  };

  return (
    <article className="mx-auto max-w-3xl space-y-6 pb-12">
      <div className="flex items-center justify-between gap-4">
        {back}
        <Button variant="secondary" size="sm" onClick={share}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>

      {article.image_url && (
        <img src={article.image_url} alt="" className="aspect-[16/9] w-full rounded-card border border-line object-cover" />
      )}

      <header className="space-y-3">
        {meta.length > 0 && <p className="text-sm text-mut">{meta.join(' · ')}</p>}
        <h1 className="font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">{title}</h1>
        {article.summary && <p className="text-lg text-mut">{article.summary}</p>}
      </header>

      <div className="max-w-[65ch] space-y-5 text-lg leading-relaxed text-ink">
        {blocks.map((block, i) => {
          if (block.type === 'paragraph') return <p key={i}>{block.value}</p>;
          if (block.type === 'image') {
            return (
              <figure key={i} className="my-8 space-y-2">
                <img src={block.url} alt={block.alt || ''} className="w-full rounded-card border border-line" />
                {block.alt && <figcaption className="text-center text-sm text-mut">{block.alt}</figcaption>}
              </figure>
            );
          }
          if (block.type === 'quote') {
            return (
              <blockquote key={i} className="border-l-4 border-acc pl-5">
                <p className="font-display text-2xl font-bold leading-snug">{block.value}</p>
                {block.author && <footer className="mt-2 text-sm text-mut">{block.author}</footer>}
              </blockquote>
            );
          }
          return null;
        })}
        {paragraphs.map((paragraph, i) => <p key={`p-${i}`}>{paragraph}</p>)}
        {blocks.length === 0 && paragraphs.length === 0 && <p className="text-mut">This article has no text yet.</p>}
      </div>
    </article>
  );
}
