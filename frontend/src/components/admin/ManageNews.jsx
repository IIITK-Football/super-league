import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, EmptyState, Field, Notice, Skeleton, useConfirm } from '../ui';

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
      setNotice({ tone: 'success', text: editing ? 'Changes saved.' : 'Article published.' });
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
      setNotice({ tone: 'success', text: 'Article deleted.' });
      refetchNews();
    } catch (err) {
      setNotice({ tone: 'error', text: err.message || 'Could not delete the article.' });
    }
  };

  const heroCurrent = heroFile ? null : editing?.image_url;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 bg-bg px-4 py-6 text-ink sm:px-6">
      <header className="space-y-1">
        <h1 className="font-display text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-6xl">News desk</h1>
        <p className="text-mut">Write, edit and publish articles. Each one appears in News as soon as it is saved.</p>
      </header>

      <Card as="form" onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-black uppercase tracking-tight">{editing ? `Edit "${editing.title}"` : 'New article'}</h2>
          {editing && <Button variant="quiet" size="sm" onClick={resetForm}>Cancel editing</Button>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Field label="Category" as="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Field>
          <Field className="sm:col-span-2" label="Summary" as="textarea" rows={2} required value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} hint="Shown under the title in News." />
          <div className="sm:col-span-2">
            <ImageInput label="Hero image" file={heroFile} currentUrl={heroCurrent} error={errors.hero} onFile={(file) => chooseFile('hero', file, setHeroFile)} />
          </div>
        </div>

        <section className="space-y-4 border-t border-line pt-6">
          <h3 className="font-display text-lg font-black uppercase tracking-tight">Article content</h3>
          {blocks.map((block, index) => (
            <div key={block.id} className="space-y-3 rounded-ctl border border-line p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold capitalize text-mut">{block.type}</span>
                <Button variant="quiet" size="sm" aria-label={`Remove ${block.type} ${index + 1}`} onClick={() => setBlocks((list) => list.filter((b) => b.id !== block.id))}>Remove</Button>
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
          ))}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBlocks((list) => [...list, blankBlock('paragraph')])}>Add paragraph</Button>
            <Button variant="secondary" size="sm" onClick={() => setBlocks((list) => [...list, blankBlock('quote')])}>Add quote</Button>
            <Button variant="secondary" size="sm" onClick={() => setBlocks((list) => [...list, blankBlock('image')])}>Add image</Button>
          </div>
        </section>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Publish article'}
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-black uppercase tracking-tight">Published articles</h2>
        {loadingNews && !newsResp && <Skeleton className="h-20 w-full" />}
        {newsError && <Notice tone="error">Could not load the articles. <Button variant="quiet" size="sm" onClick={refetchNews}>Try again</Button></Notice>}
        {!loadingNews && !newsError && articles.length === 0 && <EmptyState title="No articles yet">Write the first one above.</EmptyState>}
        {articles.map((article) => (
          <Card key={article.id} className="flex items-center gap-4 p-3 sm:p-4">
            {article.image_url
              ? <img src={article.image_url} alt="" className="h-14 w-20 shrink-0 rounded-ctl object-cover" />
              : <div aria-hidden="true" className="h-14 w-20 shrink-0 rounded-ctl bg-raise" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{article.title}</p>
              <p className="text-sm text-mut">{article.category} · {new Date(article.date).toLocaleDateString()}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="secondary" size="sm" aria-label={`Edit ${article.title}`} onClick={() => startEdit(article)}>Edit</Button>
              {canDelete && <Button variant="quiet" size="sm" aria-label={`Delete ${article.title}`} onClick={() => handleDelete(article)}>Delete</Button>}
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
