import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { Shield, Trash2, UploadCloud } from 'lucide-react';
import { supabase } from '../../lib/supabase';
const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function ManageTeams() {
  const { data: teamsResp, refetch: refetchTeams } = useApi('/teams?all=true'); 
  const teams = teamsResp?.data || [];

  const [loading, setLoading] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [form, setForm] = useState({ name: '', short_name: '', division: 'mens' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let finalLogoUrl = null;

      // 1. UPLOAD LOGO TO SUPABASE BUCKET
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
          .from('team-logos') // The new bucket!
          .upload(fileName, imageFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('team-logos')
          .getPublicUrl(fileName);
          
        finalLogoUrl = publicUrl;
      }

      // 2. SEND TO BACKEND
      const res = await fetch(`${API_URL}/admin/teams`, {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}` 
        },
        body: JSON.stringify({ ...form, logo_url: finalLogoUrl })
      });
      
      if (res.ok) {
        alert("Team registered successfully!");
        refetchTeams();
        setImageFile(null);
        setForm({ name: '', short_name: '', division: 'mens' });
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.message}`);
      }
    } catch (err) {
      alert("Failed to add team.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure? This might break matches associated with this team!")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/admin/teams?id=${id}`, { 
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      refetchTeams();
    } catch (err) {
      alert("Failed to delete team.");
    }
  };

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      
      {/* ADD TEAM FORM */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 mb-6 flex items-center gap-2">
          <Shield size={16} className="text-[#E8C881]" /> Register Franchise
        </h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="text" placeholder="Team Name (e.g. Neon Strikers)" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
            <input type="text" placeholder="Short Name (e.g. NEO)" maxLength="4" required value={form.short_name} onChange={e => setForm({...form, short_name: e.target.value.toUpperCase()})} className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 uppercase" />
            <select required value={form.division} onChange={e => setForm({...form, division: e.target.value})} className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 appearance-none">
              <option value="mens">Men's Division</option>
              <option value="womens">Women's Division</option>
              <option value="freshers">Freshers</option>
            </select>
          </div>

          <div className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
            <UploadCloud size={20} className="text-zinc-500" />
            <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files[0])} className="w-full text-sm text-zinc-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-white hover:file:bg-white/20" />
          </div>

          <button type="submit" disabled={loading} className="w-full bg-[#E8C881] text-black font-black uppercase tracking-widest py-3 rounded-xl hover:bg-[#F9D992] transition-colors">
            {loading ? "Registering..." : "Publish Team to Database"}
          </button>
        </form>
      </div>

      {/* TEAMS TABLE */}
      <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[3fr_1fr_2fr_1fr] gap-4 p-4 border-b border-white/10 text-[10px] font-black tracking-widest text-zinc-500 uppercase bg-black/60">
          <div>Franchise</div>
          <div>Tag</div>
          <div>Division</div>
          <div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
          {teams.map(t => (
            <div key={t.id} className="grid grid-cols-[3fr_1fr_2fr_1fr] gap-4 p-4 items-center hover:bg-white/5 transition-colors text-sm">
              <div className="font-bold flex items-center gap-3">
                {t.logo_url ? <img src={t.logo_url} className="w-8 h-8 rounded-md object-contain bg-white/5 p-1" /> : <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center"><Shield size={14} className="text-zinc-500"/></div>}
                {t.name}
              </div>
              <div className="font-mono text-zinc-400 font-bold">{t.short_name}</div>
              <div className="text-zinc-500 uppercase text-xs font-black tracking-widest">{t.division}</div>
              <div className="flex justify-end gap-3">
                <button onClick={() => handleDelete(t.id)} className="text-red-500/50 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
