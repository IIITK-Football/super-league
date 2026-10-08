import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { Newspaper, Trash2, Plus, Image as ImageIcon, Type, Quote, UploadCloud } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
const API_URL = API_BASE_URL;


export default function ManageNews() {
  const { data: newsResp, refetch: refetchNews } = useApi('/news'); 
  const newsList = newsResp?.data || [];

  const [loading, setLoading] = useState(false);
  const [heroImageFile, setHeroImageFile] = useState(null);
  const [form, setForm] = useState({ title: '', summary: '', category: 'Official Editorial' });
  
  // The Lego Blocks!
  const [contentBlocks, setContentBlocks] = useState([{ id: Date.now(), type: 'paragraph', value: '' }]);

  const addBlock = (type) => {
    setContentBlocks([...contentBlocks, { id: Date.now(), type, value: '', url: '', alt: '', author: '', file: null }]);
  };

  const updateBlock = (id, field, value) => {
    setContentBlocks(blocks => blocks.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const removeBlock = (id) => {
    setContentBlocks(blocks => blocks.filter(b => b.id !== id));
  };

  // --- NEW R2 UPLOAD LOGIC ---
  const uploadImage = async (file) => {
    if (!file) return null;

    try {
      // Grab the user session to prove to the backend we are an admin
      const { data: { session } } = await supabase.auth.getSession();

      // 1. Ask the backend for a secure Cloudflare R2 upload ticket
      const urlRes = await fetch(`${API_URL}/admin/newsletter/upload-url`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type
        })
      });

      const { signedUrl, publicUrl } = await urlRes.json();

      if (!signedUrl) throw new Error("Failed to get R2 upload URL");

      // 2. Upload the file DIRECTLY to Cloudflare R2
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadRes.ok) throw new Error("Failed to upload image to Cloudflare");

      // 3. Return the final, public CDN link
      return publicUrl;
      
    } catch (error) {
      console.error("R2 Upload Error:", error);
      throw error;
    }
  };
  // ---------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // 1. Upload Hero Image (Now goes to R2!)
      let finalHeroUrl = await uploadImage(heroImageFile);

      // 2. Upload any images embedded inside the content blocks! (Now goes to R2!)
      const processedBlocks = await Promise.all(contentBlocks.map(async (block) => {
        if (block.type === 'image' && block.file) {
          const blockImageUrl = await uploadImage(block.file);
          return { type: 'image', url: blockImageUrl, alt: block.alt };
        }
        // If it's a paragraph or quote, just return the text
        if (block.type === 'paragraph') return { type: 'paragraph', value: block.value };
        if (block.type === 'quote') return { type: 'quote', value: block.value, author: block.author };
        return block;
      }));

      // 3. Send to API
      const res = await fetch(`${API_URL}/admin/newsletter`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ 
          title: form.title, 
          summary: form.summary, 
          category: form.category,
          image_url: finalHeroUrl, 
          content: processedBlocks
        })
      });

      if (res.ok) {
        alert("Article Published!");
        refetchNews();
        setForm({ title: '', summary: '', category: 'Official Editorial' });
        setHeroImageFile(null);
        setContentBlocks([{ id: Date.now(), type: 'paragraph', value: '' }]);
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.message}`);
      }
    } catch (err) {
      alert("Failed to publish. Check console.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this article forever?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/admin/newsletter?id=${id}`, { 
        method: 'DELETE', 
        credentials: 'include', 
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      refetchNews();
    } catch (err) {
      alert("Failed to delete.");
    }
  };

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      
      {/* THE ARTICLE EDITOR */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 mb-6 flex items-center gap-2">
          <Newspaper size={16} className="text-[#E8C881]" /> Write Article
        </h3>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <input type="text" placeholder="Headline / Title" required value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-4 outline-none focus:border-[#E8C881]/50 text-xl font-black text-white" />
            <textarea placeholder="Short Summary (Subtitle)" required value={form.summary} onChange={e => setForm({...form, summary: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 text-sm text-zinc-300 h-20 resize-none" />
            <div className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest min-w-[100px]">Category</span>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full bg-transparent outline-none text-sm text-zinc-300 cursor-pointer [&>option]:bg-zinc-900 [&>option]:text-white">
                <option value="Official Editorial">Official Editorial</option>
                <option value="Match Report">Match Report</option>
                <option value="Transfer News">Transfer News</option>
                <option value="Satire">Satire</option>
                <option value="News">News</option>
                <option value="Announcement">Announcement</option>
              </select>
            </div>
            
            <div className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest min-w-[100px]">Hero Image</span>
              <UploadCloud size={16} className="text-zinc-500" />
              <input type="file" accept="image/*" onChange={e => setHeroImageFile(e.target.files[0])} className="w-full text-sm text-zinc-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-white hover:file:bg-white/20" />
            </div>
          </div>

          <div className="border-t border-white/10 pt-6 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">Article Content</h4>
            
            {contentBlocks.map((block, index) => (
              <div key={block.id} className="relative group bg-black/30 border border-white/5 rounded-xl p-4 transition-all hover:border-white/20">
                <button type="button" onClick={() => removeBlock(block.id)} className="absolute -right-2 -top-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={12} /></button>
                
                {block.type === 'paragraph' && (
                  <textarea placeholder="Write a paragraph..." required value={block.value} onChange={e => updateBlock(block.id, 'value', e.target.value)} className="w-full bg-transparent outline-none text-sm text-zinc-300 min-h-[100px] resize-none" />
                )}
                
                {block.type === 'quote' && (
                  <div className="space-y-2 border-l-4 border-[#E8C881] pl-4">
                    <textarea placeholder="Enter quote text..." required value={block.value} onChange={e => updateBlock(block.id, 'value', e.target.value)} className="w-full bg-transparent outline-none text-sm italic text-white min-h-[60px] resize-none" />
                    <input type="text" placeholder="Author / Speaker" required value={block.author} onChange={e => updateBlock(block.id, 'author', e.target.value)} className="w-full bg-transparent outline-none text-xs text-zinc-500 font-bold" />
                  </div>
                )}
                
                {block.type === 'image' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <ImageIcon size={16} className="text-zinc-500" />
                      <input type="file" accept="image/*" required onChange={e => updateBlock(block.id, 'file', e.target.files[0])} className="w-full text-sm text-zinc-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-white" />
                    </div>
                    <input type="text" placeholder="Image Caption / Alt Text" required value={block.alt} onChange={e => updateBlock(block.id, 'alt', e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 outline-none text-xs text-zinc-400" />
                  </div>
                )}
              </div>
            ))}

            {/* BLOCK CONTROLS */}
            <div className="flex gap-2">
              <button type="button" onClick={() => addBlock('paragraph')} className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"><Type size={14} /> Add Paragraph</button>
              <button type="button" onClick={() => addBlock('quote')} className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"><Quote size={14} /> Add Quote</button>
              <button type="button" onClick={() => addBlock('image')} className="flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"><ImageIcon size={14} /> Add Image</button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-[#E8C881] text-black font-black uppercase tracking-widest py-4 rounded-xl hover:bg-[#F9D992] transition-colors">
            {loading ? "Uploading Article & Images..." : "Publish Article"}
          </button>
        </form>
      </div>

      {/* PUBLISHED ARTICLES TABLE */}
      <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[3fr_1fr_1fr] gap-4 p-4 border-b border-white/10 text-[10px] font-black tracking-widest text-zinc-500 uppercase bg-black/60">
          <div>Headline</div><div>Date</div><div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
          {newsList.map(article => (
            <div key={article.id} className="grid grid-cols-[3fr_1fr_1fr] gap-4 p-4 items-center hover:bg-white/5 transition-colors text-sm">
              <div className="font-bold flex items-center gap-3 truncate">
                {article.image_url ? <img src={article.image_url} className="w-10 h-6 object-cover rounded" /> : <div className="w-10 h-6 bg-white/10 rounded flex items-center justify-center"><Newspaper size={12} className="text-zinc-500"/></div>}
                <span className="truncate">{article.title}</span>
              </div>
              <div className="text-zinc-500 text-xs font-mono">{new Date(article.date).toLocaleDateString()}</div>
              <div className="flex justify-end gap-3">
                <button onClick={() => handleDelete(article.id)} className="text-red-500/50 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
