import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Plus, Save, Send, Trash2 } from 'lucide-react';
import { fetchApi } from '../../hooks/useApi';
import { RulesBlocks } from '../rules/RulesBlocks';
import { ghostButton, inputClass, labelClass, primaryButton } from './adminStyles';
import { BLOCK_TYPES, blockLabel, blockProblem, cleanBlock, newBlock, sameBlocks, visibleBlocks } from './rulesDraft';

const typeName = (type) => BLOCK_TYPES.find((t) => t.value === type)?.label || type;
const when = (value) => new Date(value).toLocaleString();

function Field({ label, value, onChange, rows }) {
  const Input = rows ? 'textarea' : 'input';
  return <label className={`block ${labelClass}`}>{label}
    <Input value={value || ''} rows={rows} onChange={(e) => onChange(e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`} />
  </label>;
}

function Lines({ label, value, onChange }) {
  return <Field label={`${label} (one per line)`} rows={6} value={(value || []).join('\n')} onChange={(text) => onChange(text.split('\n'))} />;
}

function TableEditor({ block, set }) {
  const { columns, rows } = block;
  const cell = (r, c, value) => set('rows', rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)));
  return <div className="space-y-3">
    <div className="overflow-x-auto">
      <table><thead><tr>{columns.map((column, c) => <th key={c} className="p-1">
        <input aria-label={`Column ${c + 1} heading`} value={column} onChange={(e) => set('columns', columns.map((v, i) => (i === c ? e.target.value : v)))} className={`${inputClass} font-bold`} />
        {columns.length > 1 && <button type="button" className={`${ghostButton} mt-1`} onClick={() => set(null, { columns: columns.filter((_, i) => i !== c), rows: rows.map((row) => row.filter((_, i) => i !== c)) })}>Remove column {c + 1}</button>}
      </th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.map((value, c) => <td key={c} className="p-1">
        <input aria-label={`Row ${r + 1}, column ${c + 1}`} value={value} onChange={(e) => cell(r, c, e.target.value)} className={inputClass} />
      </td>)}<td>{rows.length > 1 && <button type="button" aria-label={`Remove row ${r + 1}`} className={ghostButton} onClick={() => set('rows', rows.filter((_, i) => i !== r))}><Trash2 size={13} /></button>}</td></tr>)}</tbody></table>
    </div>
    <div className="flex gap-2">
      <button type="button" className={ghostButton} disabled={rows.length >= 100} onClick={() => set('rows', [...rows, columns.map(() => '')])}><Plus size={13} /> Row</button>
      <button type="button" className={ghostButton} disabled={columns.length >= 8} onClick={() => set(null, { columns: [...columns, `Column ${columns.length + 1}`], rows: rows.map((row) => [...row, '']) })}><Plus size={13} /> Column</button>
    </div>
  </div>;
}

function BlockEditor({ block, onChange }) {
  // set(field, value), or set(null, patch) to change several fields at once.
  const set = (field, value) => onChange({ ...block, ...(field ? { [field]: value } : value) });
  const tones = block.type === 'callout' ? ['eligibility', 'info'] : block.type === 'notice' ? ['info', 'warning'] : null;
  return <div aria-label="Block editor" role="group" className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
    <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300">{typeName(block.type)}</h4>
    {block.type !== 'notice' && <Field label="Title" value={block.title} onChange={(v) => set('title', v)} />}
    {tones && <label className={`block ${labelClass}`}>Tone<select value={block.tone} onChange={(e) => set('tone', e.target.value)} className={`${inputClass} mt-1 normal-case tracking-normal`}>{tones.map((tone) => <option key={tone} value={tone}>{tone}</option>)}</select></label>}
    {['section', 'callout', 'notice'].includes(block.type) && <Field label="Text" rows={4} value={block.body} onChange={(v) => set('body', v)} />}
    {block.type === 'section' && <Lines label="Points" value={block.items} onChange={(v) => set('items', v)} />}
    {block.type === 'steps' && <Lines label="Steps" value={block.items} onChange={(v) => set('items', v)} />}
    {block.type === 'table' && <TableEditor block={block} set={set} />}
  </div>;
}

export default function ManageRules({ season }) {
  const [blocks, setBlocks] = useState([]);
  const [saved, setSaved] = useState([]);
  const [versions, setVersions] = useState([]);
  const [published, setPublished] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [type, setType] = useState('section');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const base = `/admin/seasons/${season.id}/rules`;

  const load = useCallback(async () => {
    const { data } = await fetchApi(base);
    const latest = data.versions[0];
    const latestBlocks = latest ? (await fetchApi(`${base}/versions/${latest.version}`)).data.blocks : null;
    const draft = data.draft?.blocks || [];
    setBlocks(draft);
    setSaved(draft);
    setVersions(data.versions);
    setPublished(latestBlocks);
    setSelected((id) => (draft.some((b) => b.id === id) ? id : draft[0]?.id ?? null));
  }, [base]);

  const start = useCallback(() => {
    setLoading(true);
    setLoadFailed(false);
    setError('');
    load().catch((failure) => { setLoadFailed(true); setError(failure.message); }).finally(() => setLoading(false));
  }, [load]);
  useEffect(() => { start(); }, [start]);

  const run = async (action, success) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = !sameBlocks(blocks, saved);
  const latest = versions[0];
  const unpublished = !published || !sameBlocks(visibleBlocks(saved), published);
  const status = dirty ? 'Unsaved changes' : !latest ? (saved.length ? 'Draft saved, not published' : 'No rules yet')
    : unpublished ? 'Unpublished changes' : `Matches version ${latest.version}`;
  const index = blocks.findIndex((b) => b.id === selected);
  const current = blocks[index];

  const add = () => {
    const block = newBlock(type);
    setBlocks([...blocks, block]);
    setSelected(block.id);
  };
  const move = (from, offset) => {
    const next = [...blocks];
    [next[from], next[from + offset]] = [next[from + offset], next[from]];
    setBlocks(next);
  };
  const update = (block) => setBlocks(blocks.map((b) => (b.id === block.id ? block : b)));

  const save = () => {
    const bad = blocks.findIndex((b) => blockProblem(b));
    if (bad >= 0) {
      setSelected(blocks[bad].id);
      setMessage('');
      setError(`Block ${bad + 1} (${typeName(blocks[bad].type)}) ${blockProblem(blocks[bad])}.`);
      return;
    }
    run(async () => {
      await fetchApi(`${base}/draft`, { method: 'PUT', body: JSON.stringify({ blocks: blocks.map(cleanBlock) }) });
      await load();
    }, 'Draft saved. Visitors do not see it until you publish.');
  };

  const publish = () => {
    if (!window.confirm(`Publish these rules for ${season.name}? Visitors see them immediately.`)) return;
    run(async () => {
      await fetchApi(`${base}/publish`, { method: 'POST' });
      await load();
    }, 'Rules published.');
  };

  const view = (version) => run(async () => setViewing((await fetchApi(`${base}/versions/${version}`)).data), '');

  if (loading) return <p className="text-zinc-500">Loading rules...</p>;
  if (loadFailed) return <div role="alert" className="space-y-2 text-sm text-red-300"><p>{error}</p><button type="button" onClick={start} className={ghostButton}>Try again</button></div>;

  return <section aria-label={`Rules of ${season.name}`} className="space-y-4 rounded-2xl border border-white/10 bg-white/[.02] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-sm font-black uppercase tracking-wider text-zinc-300">Rules of {season.name}</h3>
      <span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">{status}</span>
    </div>
    {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}

    <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr_240px]">
      <div className="space-y-3">
        {!blocks.length ? <p className="text-sm text-zinc-500">No blocks yet. Add the first one below.</p>
          : <ol aria-label="Blocks" className="space-y-2">{blocks.map((b, i) => <li key={b.id} className={`space-y-2 rounded-xl border p-3 ${b.id === selected ? 'border-[#d9ff4a]/40' : 'border-white/10'} ${b.hidden ? 'opacity-60' : ''}`}>
            <button type="button" aria-current={b.id === selected} onClick={() => setSelected(b.id)} className="block w-full text-left">
              <span className={labelClass}>{i + 1}. {typeName(b.type)}{b.hidden && ' · hidden'}</span>
              <span className="block truncate text-sm font-bold text-white">{blockLabel(b)}</span>
            </button>
            <div className="flex flex-wrap gap-1">
              <button type="button" aria-label={`Move block ${i + 1} up`} className={ghostButton} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" aria-label={`Move block ${i + 1} down`} className={ghostButton} disabled={busy || i === blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" aria-label={`${b.hidden ? 'Show' : 'Hide'} block ${i + 1}`} className={ghostButton} disabled={busy} onClick={() => update({ ...b, hidden: !b.hidden })}>{b.hidden ? 'Show' : 'Hide'}</button>
              <button type="button" aria-label={`Delete block ${i + 1}`} className={ghostButton} disabled={busy} onClick={() => window.confirm('Delete this block from the draft? Hide it instead to keep it.') && setBlocks(blocks.filter((x) => x.id !== b.id))}><Trash2 size={13} /></button>
            </div>
          </li>)}</ol>}
        <div className="flex gap-2">
          <select aria-label="New block type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>{BLOCK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          <button type="button" onClick={add} disabled={busy || blocks.length >= 100} className={ghostButton}><Plus size={13} /> Add block</button>
        </div>
      </div>

      {current ? <BlockEditor block={current} onChange={update} /> : <p className="text-sm text-zinc-500">Select a block to edit it.</p>}

      <div className="space-y-2">
        <h4 className={labelClass}>Version history</h4>
        {!versions.length ? <p className="text-sm text-zinc-500">Nothing published yet.</p>
          : <ul aria-label="Versions" className="space-y-2">{versions.map((v) => <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 p-2 text-xs text-zinc-300">
            <span><b className="text-white">Version {v.version}</b><br />{when(v.published_at)}</span>
            <button type="button" aria-label={`View version ${v.version}`} disabled={busy} onClick={() => view(v.version)} className={ghostButton}>View</button>
          </li>)}</ul>}
      </div>
    </div>

    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={save} disabled={busy || !dirty} className={primaryButton}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save draft</button>
      <button type="button" onClick={() => setPreview(!preview)} className={ghostButton}><Eye size={13} /> {preview ? 'Close preview' : 'Preview'}</button>
      <button type="button" onClick={publish} disabled={busy || dirty || !unpublished || !visibleBlocks(saved).length} className={ghostButton}><Send size={13} /> Publish</button>
    </div>

    {preview && <section aria-label="Preview" className="space-y-4 rounded-2xl border border-dashed border-[#d9ff4a]/50 bg-black p-4">
      <p className="text-center text-xs font-black uppercase tracking-widest text-[#d9ff4a]">Preview — not published</p>
      <RulesBlocks blocks={visibleBlocks(blocks)} />
    </section>}

    {viewing && <section aria-label={`Version ${viewing.version}`} className="space-y-4 rounded-2xl border border-white/15 bg-black p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-zinc-400">Version {viewing.version} · {when(viewing.published_at)} · read only</p>
        <button type="button" onClick={() => setViewing(null)} className={ghostButton}>Close</button>
      </div>
      <RulesBlocks blocks={viewing.blocks} />
    </section>}
  </section>;
}
