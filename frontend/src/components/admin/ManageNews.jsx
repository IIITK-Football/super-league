import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { ImagePlus, Newspaper, Pencil, Pilcrow, Quote, Trash2 } from 'lucide-react';
import { Button, Field, Notice, Select, Skeleton, toast, useConfirm } from '../ui';

const API_URL = API_BASE_URL;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // Mirrors the API cap in app/api/admin/newsletter/image.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const CATEGORIES = ['Official Editorial', 'Match Report', 'Transfer News', 'Satire', 'News', 'Announcement'];
const newId = () => Math.random().toString(36).slice(2);

const blankBlock = (type) => ({ id: newId(), type, value: '', author: '', url: '', alt: '', file: null });
const blankForm = { title: '', summary: '', category: CATEGORIES[0] };

// The server's message when it gives one, else the fallback. A non-JSON error page must not throw.
async function errorMessage(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return body.message || body.error || fallback;
}

function fileProblem(file) {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPEG, WebP or GIF image.';
  if (file.size > MAX_IMAGE_BYTES) return 'Images must be 10 MB or smaller.';
  return null;
}

function useFilePreview(file) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) { setUrl(null); return undefined; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

// A file input with a thumbnail of what will be uploaded, or of the image the article already has.
function ImageInput({ label, file, currentUrl, error, onFile }) {
  const preview = useFilePreview(file);
  const src = preview || currentUrl;
  return (
    <div className="flex flex-col gap-3">
      <Field
        label={label}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        hint="PNG, JPEG, WebP or GIF, up to 10 MB"
        error={error}
        onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
      />
      {src && <img src={src} alt={`${label} preview`} className="h-32 w-full rounded-ctl object-cover sm:w-56" />}
    </div>
  );
}

export default function ManageNews() {
  const { roles } = useAuth();
  const canDelete = Boolean(roles?.includes('dictator'));
  const confirm = useConfirm();
  const { data: newsResp, loading: loadingNews, error: newsError, retry: refetchNews } = useApi('/news');
  const articles = newsResp?.data || [];

  const [form, setForm] = useState(blankForm);
  const [heroFile, setHeroFile] = useState(null);
  const [blocks, setBlocks] = useState([blankBlock('paragraph')]);
  const [editing, setEditing] = useState(null); // the article being edited, or null for a new one
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const resetForm = () => {
    setForm(blankForm);
    setHeroFile(null);
    setBlocks([blankBlock('paragraph')]);
    setEditing(null);
    setErrors({});
  };

  const startEdit = (article) => {
    setEditing(article);
    setForm({ title: article.title || '', summary: article.summary || '', category: article.category || CATEGORIES[0] });
    setHeroFile(null);
    setErrors({});
    setNotice(null);
    document.getElementById('write-news')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setBlocks((article.content || []).map((b) => ({
      ...blankBlock(b.type),
      value: b.value || '',
      author: b.author || '',
      url: b.url || '',
      alt: b.alt || '',
    })));
  };

  const updateBlock = (id, field, value) => {
    setBlocks((list) => list.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  };

  // A new file is checked here, so a bad one is refused before any upload starts.
  const chooseFile = (key, file, apply) => {
    const problem = file ? fileProblem(file) : null;
    setErrors((e) => ({ ...e, [key]: problem ?? undefined }));
    if (!problem) apply(file);
  };

  // Uploads one image through the API, which stores it in the news bucket and returns its public URL.
  const uploadImage = async (file) => {
    const { data: { session } } = await supabase.auth.getSession();
    const body = new FormData();
    body.append('image', file);
    const res = await fetch(`${API_URL}/admin/newsletter/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
      body,
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not upload the image.'));
    const result = await res.json().catch(() => ({}));
    if (!result.publicUrl) throw new Error('Could not upload the image.');
    return result.publicUrl;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNotice(null);
    if (blocks.some((b) => b.type === 'image' && !b.file && !b.url)) {
      setNotice({ tone: 'error', text: 'Choose an image for every image block, or remove the block.' });
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const heroUrl = heroFile ? await uploadImage(heroFile) : (editing?.image_url ?? null);
      const content = [];
      for (const block of blocks) {
        if (block.type === 'paragraph') content.push({ type: 'paragraph', value: block.value });
        else if (block.type === 'quote') content.push({ type: 'quote', value: block.value, author: block.author });
        else content.push({ type: 'image', url: block.file ? await uploadImage(block.file) : block.url, alt: block.alt });
      }
      const res = await fetch(editing ? `${API_URL}/admin/newsletter?id=${editing.id}` : `${API_URL}/admin/newsletter`, {
        method: editing ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ title: form.title, summary: form.summary, category: form.category, image_url: heroUrl, content }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Could not save the article.'));
      toast({ tone: 'success', title: editing ? 'Changes saved.' : 'Article published.' });
      resetForm();
      refetchNews();
    } catch (err) {
      setNotice({ tone: 'error', text: err.message || 'Could not save the article.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (article) => {
    const ok = await confirm({
      title: `Delete "${article.title}"?`,
      description: 'The article is removed from News for everyone. This cannot be undone.',
      confirmLabel: 'Delete article',
      tone: 'danger',
    });
    if (!ok) return;
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_URL}/admin/newsletter?id=${article.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) throw new Error(await errorMessage(res, 'Could not delete the article.'));
      if (editing?.id === article.id) resetForm();
      toast({ tone: 'success', title: 'Article deleted.' });
      refetchNews();
    } catch (err) {
      setNotice({ tone: 'error', text: err.message || 'Could not delete the article.' });
    }
  };

  const heroCurrent = heroFile ? null : editing?.image_url;

  const BLOCKS = [{ type: 'paragraph', label: 'Add paragraph', icon: Pilcrow }, { type: 'quote', label: 'Add quote', icon: Quote }, { type: 'image', label: 'Add image', icon: ImagePlus }];
  const blockIcon = { paragraph: Pilcrow, quote: Quote, image: ImagePlus };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
      <form id="write-news" onSubmit={handleSubmit} className="glass scroll-mt-28 space-y-6 rounded-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-ink">{editing ? `Edit "${editing.title}"` : 'New article'}</h2>
          {editing && <Button variant="quiet" size="sm" onClick={resetForm}>Cancel editing</Button>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Field label="Category">{(p) => <Select {...p} value={form.category} onChange={(category) => setForm({ ...form, category })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />}</Field>
          <Field className="sm:col-span-2" label="Summary" as="textarea" rows={2} required value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} hint="Shown under the title in News." />
          <div className="sm:col-span-2">
            <ImageInput label="Hero image" file={heroFile} currentUrl={heroCurrent} error={errors.hero} onFile={(file) => chooseFile('hero', file, setHeroFile)} />
          </div>
        </div>

        <section className="space-y-4 border-t border-line pt-6">
          <h3 className="eyebrow">Article content</h3>
          {blocks.map((block, index) => {
            const Icon = blockIcon[block.type];
            return (
              <div key={block.id} className="space-y-3 rounded-ctl border border-line p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold capitalize text-mut"><Icon size={16} aria-hidden="true" />{block.type}</span>
                  <Button variant="quiet" size="sm" aria-label={`Remove ${block.type} ${index + 1}`} onClick={() => setBlocks((list) => list.filter((b) => b.id !== block.id))}><Trash2 size={15} aria-hidden="true" />Remove</Button>
                </div>

                {block.type === 'paragraph' && (
                  <Field label="Text" as="textarea" rows={4} required value={block.value} onChange={(e) => updateBlock(block.id, 'value', e.target.value)} />
                )}

                {block.type === 'quote' && (
                  <div className="space-y-3">
                    <Field label="Quote" as="textarea" rows={2} required value={block.value} onChange={(e) => updateBlock(block.id, 'value', e.target.value)} />
                    <Field label="Speaker" required value={block.author} onChange={(e) => updateBlock(block.id, 'author', e.target.value)} />
                  </div>
                )}

                {block.type === 'image' && (
                  <div className="space-y-3">
                    <ImageInput label="Image" file={block.file} currentUrl={block.url} error={errors[block.id]} onFile={(file) => chooseFile(block.id, file, (f) => updateBlock(block.id, 'file', f))} />
                    <Field label="Alt text" required value={block.alt} onChange={(e) => updateBlock(block.id, 'alt', e.target.value)} hint="Describes the image for screen readers." />
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            {BLOCKS.map(({ type, label, icon: Icon }) => (
              <Button key={type} variant="secondary" size="sm" onClick={() => setBlocks((list) => [...list, blankBlock(type)])}><Icon size={15} aria-hidden="true" />{label}</Button>
            ))}
          </div>
        </section>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Publish article'}
          </Button>
        </div>
      </form>

      <section aria-labelledby="news-published" className="space-y-3">
        <h2 id="news-published" className="eyebrow">Published articles</h2>
        {loadingNews && !newsResp && <Skeleton className="h-20 w-full" />}
        {newsError && <Notice tone="error">Could not load the articles. <Button variant="quiet" size="sm" onClick={refetchNews}>Try again</Button></Notice>}
        {!loadingNews && !newsError && articles.length === 0 && <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-6 text-sm text-mut">
          <Newspaper size={26} aria-hidden="true" />
          <p className="font-semibold text-ink">No articles yet</p>
          Write the first one and it appears in News as soon as it is saved.
        </div>}
        {articles.length > 0 && <ul className="glass divide-y divide-line/70 rounded-card px-2">
          {articles.map((article) => (
            <li key={article.id} className="group flex items-center gap-3 p-2.5">
              {article.image_url
                ? <img src={article.image_url} alt="" className="h-12 w-16 shrink-0 rounded-[10px] object-cover grayscale transition duration-300 group-hover:grayscale-0" />
                : <div aria-hidden="true" className="flex h-12 w-16 shrink-0 items-center justify-center rounded-[10px] bg-raise text-mut"><Newspaper size={18} /></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{article.title}</p>
                <p className="truncate text-xs text-mut">{article.category} · {new Date(article.date).toLocaleDateString()}</p>
              </div>
              <div className="flex shrink-0">
                <Button variant="quiet" size="sm" className="px-3" aria-label={`Edit ${article.title}`} onClick={() => startEdit(article)}><Pencil size={15} aria-hidden="true" /></Button>
                {canDelete && <Button variant="quiet" size="sm" className="px-3 text-live" aria-label={`Delete ${article.title}`} onClick={() => handleDelete(article)}><Trash2 size={15} aria-hidden="true" /></Button>}
              </div>
            </li>
          ))}
        </ul>}
      </section>
    </div>
  );
}
