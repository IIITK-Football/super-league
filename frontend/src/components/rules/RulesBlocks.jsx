import { AlertTriangle, Info, UserCheck } from 'lucide-react';

// The visitor presentation of rules blocks, shared by the public page, the dictator's preview and version history.
const card = 'rounded-2xl border border-white/10 bg-white/5 p-6 sm:p-8';
const heading = 'mb-5 border-b border-white/10 pb-3 text-xl font-black uppercase tracking-widest text-white';
const TONES = {
  eligibility: { Icon: UserCheck, className: 'border-[#E8C881]/40 bg-[#E8C881]/10', icon: 'text-[#E8C881]' },
  info: { Icon: Info, className: 'border-white/15 bg-white/5', icon: 'text-zinc-300' },
  warning: { Icon: AlertTriangle, className: 'border-red-500/30 bg-red-500/10', icon: 'text-red-300' },
};

// "Label: text" items keep a bold label.
function Item({ text }) {
  const [label, ...rest] = String(text).split(':');
  return rest.length ? <><span className="font-bold text-white">{label}:</span>{rest.join(':')}</> : text;
}

function Note({ tone, title, body }) {
  const { Icon, className, icon } = TONES[tone] || TONES.info;
  return <div role="note" className={`flex gap-4 rounded-2xl border p-5 sm:p-6 ${className}`}>
    <Icon size={22} className={`mt-0.5 shrink-0 ${icon}`} />
    <div className="space-y-1 text-sm leading-relaxed text-zinc-300 sm:text-base">
      {title && <h2 className="font-black uppercase tracking-widest text-white">{title}</h2>}
      <p className="whitespace-pre-line">{body}</p>
    </div>
  </div>;
}

function Block({ block }) {
  switch (block.type) {
    case 'section': return <section className={card}>
      <h2 className={heading}>{block.title}</h2>
      {block.body && <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300 sm:text-base">{block.body}</p>}
      {block.items?.length > 0 && <ul className="mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-zinc-300 sm:text-base">
        {block.items.map((item, i) => <li key={i}><Item text={item} /></li>)}
      </ul>}
    </section>;
    case 'steps': return <section className={card}>
      {block.title && <h2 className={heading}>{block.title}</h2>}
      <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-zinc-300 sm:text-base">
        {(block.items || []).map((item, i) => <li key={i}><Item text={item} /></li>)}
      </ol>
    </section>;
    case 'table': return <section className={card}>
      {block.title && <h2 className={heading}>{block.title}</h2>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-zinc-300">
          <thead><tr>{(block.columns || []).map((column, i) => <th key={i} scope="col" className="border-b border-white/15 px-3 py-2 font-black uppercase tracking-wider text-white">{column}</th>)}</tr></thead>
          <tbody>{(block.rows || []).map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className="border-b border-white/5 px-3 py-2">{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>;
    case 'callout':
    case 'notice': return <Note tone={block.tone} title={block.title} body={block.body} />;
    default: return null;
  }
}

export function RulesBlocks({ blocks }) {
  return <div className="space-y-6">{blocks.filter((block) => !block.hidden).map((block) => <Block key={block.id} block={block} />)}</div>;
}
