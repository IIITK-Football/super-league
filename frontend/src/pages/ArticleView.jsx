import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Newspaper, Share2, Check } from 'lucide-react';
import { Loader } from '../components/Loader';
import { API_BASE_URL } from '../lib/api';

const API_URL = API_BASE_URL;

export function ArticleView() {
  const { id } = useParams(); // Grab the ID directly from the URL
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Fetch the specific article when the ID changes
  useEffect(() => {
    if (!id) return;
    
    setLoading(true);
    fetch(`${API_URL}/news`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const foundArticle = data.data.find(a => a.id === id);
          setArticle(foundArticle || null);
        }
      })
      .catch(err => {
        console.error("Failed to load article", err);
        setArticle(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleShare = () => {
    if (!id) return;
    const shareLink = `${window.location.origin}/article/${id}`;
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <Loader text="Loading Article..." />;
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-zinc-500 space-y-4">
        <p className="text-lg">Article not found.</p>
        <button onClick={() => navigate('/vault')} className="text-[#E8C881] hover:underline font-bold">Back to Newsletter</button>
      </div>
    );
  }

  // Safely extract fields
  const title = article.title || article.headline || 'Untitled Article';
  const summary = article.summary || article.snippet || '';
  const imageUrl = article.image_url || article.imgUrl;
  const date = article.date || new Date().toISOString();
  const author = article.author || 'Super League Media';
  const category = article.category || 'Official Editorial';

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* Top Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button 
          onClick={() => navigate('/vault')}
          className="group flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest">Back to Newsletter</span>
        </button>

        <button 
          onClick={handleShare}
          className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-[10px] sm:text-xs font-bold uppercase tracking-widest text-white border border-white/5"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Share2 size={14} />}
          <span className="hidden sm:inline">{copied ? 'Link Copied!' : 'Share Article'}</span>
          <span className="sm:hidden">{copied ? 'Copied!' : 'Share'}</span>
        </button>
      </div>

      {/* Hero Header */}
      {imageUrl ? (
        <div className="relative w-full h-[30vh] sm:h-[50vh] rounded-3xl overflow-hidden mb-10 border border-white/10 bg-black">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="relative w-full h-48 rounded-3xl overflow-hidden mb-10 border border-white/10 bg-zinc-900 flex items-center justify-center">
          <Newspaper size={48} className="text-zinc-700" />
        </div>
      )}

      {/* Article Content */}
      <div className="max-w-3xl mx-auto px-2 sm:px-6">
        
        <div className="mb-8 border-b border-white/10 pb-8 space-y-6">
          <div className="flex items-center gap-4">
            <span className="px-3 py-1 bg-white border border-white/20 text-black text-[10px] sm:text-xs font-black uppercase tracking-widest rounded-full">
              {category}
            </span>
            <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
              <Calendar size={14} />
              {new Date(date).toLocaleDateString()}
            </div>
          </div>
          
          <h1 className="text-3xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400 tracking-tighter leading-tight drop-shadow-sm">
            {title}
          </h1>

          <div className="flex items-center gap-3 pt-2">
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/20 flex items-center justify-center font-black text-white">
              SL
            </div>
            <div>
              <p className="text-sm font-bold text-white tracking-wide">{author}</p>
              <p className="text-xs text-zinc-500 font-mono">{category}</p>
            </div>
          </div>
        </div>

        <div className="prose prose-invert prose-lg max-w-none font-serif text-zinc-300">
          {summary && <p className="text-xl font-medium text-[#E8C881] leading-relaxed mb-8">{summary}</p>}

          {Array.isArray(article.content) && article.content.length > 0 ? (
            article.content.map((block, i) => {
              if (block.type === 'paragraph') return <p key={i} className="mb-6 leading-relaxed">{block.value}</p>;
              
              if (block.type === 'image') return (
                <figure key={i} className="my-10">
                  <img src={block.url} alt={block.alt || 'News image'} className="w-full rounded-xl border border-white/10" />
                  {block.alt && <figcaption className="text-center text-xs text-zinc-500 mt-2 uppercase tracking-widest">{block.alt}</figcaption>}
                </figure>
              );
              
              if (block.type === 'quote') return (
                <blockquote key={i} className="my-10 p-6 sm:p-8 bg-zinc-900 border-l-4 border-[#E8C881] rounded-r-xl">
                  <p className="text-xl sm:text-2xl font-bold italic text-white leading-snug">"{block.value}"</p>
                  {block.author && <footer className="text-[#E8C881] mt-4 font-black uppercase text-xs tracking-widest">— {block.author}</footer>}
                </blockquote>
              );
              
              return null;
            })
          ) : typeof article.content === 'string' && article.content.trim() !== '' ? (
            article.content.split('\n').map((paragraph, i) => (
              paragraph.trim() ? <p key={i} className="mb-6 leading-relaxed">{paragraph}</p> : null
            ))
          ) : (
            <p className="italic text-zinc-500">No additional content available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
