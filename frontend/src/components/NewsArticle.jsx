/* eslint-disable react/prop-types -- this codebase does not use prop-types */
import { formatNewsDate } from '../lib/newsDate';

// A news card: image, headline and date. Wrap it in a link; it does not navigate by itself.
export function NewsArticle({ article }) {
  const headline = article.headline || article.title || 'Untitled article';
  const imgUrl = article.imgUrl || article.image_url;
  const date = formatNewsDate(article.date);

  return (
    <article className="glass lift group flex h-full flex-col overflow-hidden rounded-card">
      {imgUrl && (
        <div className="overflow-hidden">
          {/* Black and white at rest, full colour on hover: the original site's photo treatment. */}
          <img src={imgUrl} alt="" className="aspect-[16/10] w-full object-cover grayscale transition duration-500 group-hover:scale-[1.03] group-hover:grayscale-0" />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
        {(article.category || date) && (
          <p className="eyebrow flex gap-2">
            {article.category && <span>{article.category}</span>}
            {date && <time dateTime={article.date}>{date}</time>}
          </p>
        )}
        <h3 className="font-display text-xl leading-tight text-ink sm:text-2xl">{headline}</h3>
      </div>
    </article>
  );
}
