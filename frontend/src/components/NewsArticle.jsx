import { Card } from './ui';

// The date as a reader sees it, or '' when the article has none (never a made-up date).
export function formatNewsDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// A news card: image, headline and date. Wrap it in a link; it does not navigate by itself.
export function NewsArticle({ article }) {
  const headline = article.headline || article.title || 'Untitled article';
  const imgUrl = article.imgUrl || article.image_url;
  const date = formatNewsDate(article.date);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      {imgUrl && <img src={imgUrl} alt="" className="aspect-[16/9] w-full object-cover" />}
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        {date && <time dateTime={article.date} className="text-sm text-mut">{date}</time>}
        <h3 className="font-display text-xl font-bold leading-tight text-ink">{headline}</h3>
      </div>
    </Card>
  );
}
