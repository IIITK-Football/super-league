import React, { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { UserPlus, Trash2, Copy, Check, UploadCloud } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { API_BASE_URL } from '../../lib/api';
const API_URL = API_BASE_URL;

// 1. MASSIVELY SIMPLIFIED STATE: Only the exact fields the Profile Card uses!
const initialFormState = { 
  first_name: '', last_name: '', team_id: '', position: '', jersey_number: '', overall_rating: 50, 
  preferredFoot: 'Right',
  play_style_name: '', play_style_desc: '',
  stats: { pace: 50, shooting: 50, passing: 50, dribbling: 50, defending: 50, physicality: 50 }
};

export default function ManagePlayers() {
  const { data: playersResp, refetch: refetchPlayers } = useApi('/players'); 
  const { data: teamsResp } = useApi('/teams?all=true'); 
  
  const players = playersResp?.data || [];
  const teams = teamsResp?.data || [];

  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [activeFormTab, setActiveFormTab] = useState('basic');
  const [imageFile, setImageFile] = useState(null);
  const [playStyleImageFile, setPlayStyleImageFile] = useState(null);
  const [form, setForm] = useState(initialFormState);

  const handleCopy = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleStatChange = (category, value) => {
    setForm(prev => ({
      ...prev,
      stats: { ...prev.stats, [category]: parseInt(value) || 0 }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      let finalImageUrl = null;
      let finalPlayStyleUrl = null;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('player-images').upload(fileName, imageFile);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('player-images').getPublicUrl(fileName);
        finalImageUrl = publicUrl;
      }

      if (playStyleImageFile) {
        const fileExt = playStyleImageFile.name.split('.').pop();
        const fileName = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
        const { error: psUploadError } = await supabase.storage.from('player-images').upload(fileName, playStyleImageFile);
        if (psUploadError) throw psUploadError;
        const { data: { publicUrl } } = supabase.storage.from('player-images').getPublicUrl(fileName);
        finalPlayStyleUrl = publicUrl;
      }

      const playStylesArray = [];
      if (form.play_style_name) {
        playStylesArray.push({
          name: form.play_style_name.trim(),
          description: form.play_style_desc.trim(),
          icon_url: finalPlayStyleUrl
        });
      }

      // 2. SIMPLIFIED PAYLOAD: Sends only exactly what is needed
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        team_id: form.team_id,
        position: form.position.toUpperCase(),
        jersey_number: parseInt(form.jersey_number) || null,
        image_url: finalImageUrl, 
        overall_rating: parseInt(form.overall_rating) || 50,
        attributes: {
          bio: { preferredFoot: form.preferredFoot },
          playStyles: playStylesArray,
          stats: {
            Pace: { total: form.stats.pace },
            Shooting: { total: form.stats.shooting },
            Passing: { total: form.stats.passing },
            Dribbling: { total: form.stats.dribbling },
            Defending: { total: form.stats.defending },
            Physicality: { total: form.stats.physicality }
          }
        }
      };

      const res = await fetch(`${API_URL}/admin/players`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        alert("Player added to Database!");
        refetchPlayers();
        setImageFile(null);
        setPlayStyleImageFile(null);
        setForm(initialFormState);
        setActiveFormTab('basic');
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.message}`);
      }
    } catch (err) {
      alert("Failed to add player.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this player?")) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/admin/players?id=${id}`, { 
        method: 'DELETE', credentials: 'include', headers: { 'Authorization': `Bearer ${session?.access_token}` }
      });
      refetchPlayers();
    } catch (err) {
      alert("Failed to delete.");
    }
  };

  const statKeys = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality'];

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-500">
      
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-black/40">
          <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300 flex items-center gap-2">
            <UserPlus size={16} className="text-[#E8C881]" /> Create EA FC Player
          </h3>
          <div className="flex bg-black rounded-lg border border-white/10 overflow-hidden">
            <button type="button" onClick={() => setActiveFormTab('basic')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest ${activeFormTab === 'basic' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Basic</button>
            <button type="button" onClick={() => setActiveFormTab('bio')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest ${activeFormTab === 'bio' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Bio & PlayStyles</button>
            <button type="button" onClick={() => setActiveFormTab('stats')} className={`px-4 py-2 text-xs font-bold uppercase tracking-widest ${activeFormTab === 'stats' ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>Attributes</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* TAB 1: BASIC INFO */}
          {activeFormTab === 'basic' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-in slide-in-from-left-4">
              <input type="text" placeholder="First Name" required value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} className="col-span-1 md:col-span-2 bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
              <input type="text" placeholder="Last Name" required value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} className="col-span-1 md:col-span-2 bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
              <select required value={form.team_id} onChange={e => setForm({...form, team_id: e.target.value})} className="col-span-1 md:col-span-2 bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 appearance-none">
                <option value="" disabled>Select Team...</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input type="text" placeholder="Position (e.g. ST)" required value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
              <input type="number" placeholder="Jersey No." required value={form.jersey_number} onChange={e => setForm({...form, jersey_number: e.target.value})} className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
              
              <div className="col-span-1 md:col-span-3 bg-black/50 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
                <UploadCloud size={20} className="text-zinc-500" />
                <input type="file" accept="image/*" onChange={e => setImageFile(e.target.files[0])} className="w-full text-sm text-zinc-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-white/10 file:text-white hover:file:bg-white/20" />
              </div>
              <input type="number" placeholder="OVR (1-99)" min="1" max="99" required value={form.overall_rating} onChange={e => setForm({...form, overall_rating: e.target.value})} className="bg-[#E8C881]/20 text-[#E8C881] placeholder:text-[#E8C881]/50 font-black border border-[#E8C881]/30 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]" />
            </div>
          )}

          {/* TAB 2: BIO & PLAYSTYLES (Simplified) */}
          {activeFormTab === 'bio' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-left-4">
              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500 border-b border-white/10 pb-2">Basic Bio</h4>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Preferred Foot</label>
                  <select value={form.preferredFoot} onChange={e => setForm({...form, preferredFoot: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 appearance-none">
                    <option value="Right">Right</option><option value="Left">Left</option><option value="Both">Both</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-xs font-black uppercase tracking-widest text-[#E8C881] border-b border-[#E8C881]/20 pb-2">Signature PlayStyle (Optional)</h4>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">PlayStyle Name</label>
                  <input type="text" placeholder="e.g. Finesse Shot+" value={form.play_style_name} onChange={e => setForm({...form, play_style_name: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Description</label>
                  <textarea placeholder="e.g. Faster finesse shots with max curve and accuracy" value={form.play_style_desc} onChange={e => setForm({...form, play_style_desc: e.target.value})} className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#E8C881]/50 h-20 resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">PlayStyle Icon Image</label>
                  <div className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 flex items-center gap-3">
                    <UploadCloud size={20} className="text-zinc-500" />
                    <input type="file" accept="image/*" onChange={e => setPlayStyleImageFile(e.target.files[0])} className="w-full text-sm text-zinc-400 file:mr-4 file:py-1 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-[#E8C881]/10 file:text-[#E8C881] hover:file:bg-[#E8C881]/20 cursor-pointer" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ATTRIBUTES (Simplified to just the 6 main stats) */}
          {activeFormTab === 'stats' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 animate-in slide-in-from-left-4">
              {statKeys.map(key => (
                <div key={key} className="bg-black/50 border border-white/10 rounded-xl p-4 flex items-center justify-between">
                  <h4 className="font-black uppercase tracking-widest text-[#E8C881] text-sm">{key}</h4>
                  <input type="number" min="1" max="99" value={form.stats[key]} onChange={e => handleStatChange(key, e.target.value)} className="w-16 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-center font-black text-xl outline-none focus:border-[#E8C881]" />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-4 border-t border-white/5">
            <button type="submit" disabled={loading} className="w-full md:w-auto px-8 bg-[#E8C881] text-black font-black uppercase tracking-widest py-3 rounded-xl hover:bg-[#F9D992] transition-colors">
              {loading ? "Processing..." : "Publish Player"}
            </button>
          </div>
        </form>
      </div>

      {/* PLAYER ROSTER TABLE */}
      <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_2fr_1fr] gap-4 p-4 border-b border-white/10 text-[10px] font-black tracking-widest text-zinc-500 uppercase bg-black/60">
          <div>Name</div><div>Team</div><div>OVR / Pos</div><div>No.</div><div>UUID</div><div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
          {players.map(p => (
            <div key={p.id} className="grid grid-cols-[2fr_1.5fr_1fr_1fr_2fr_1fr] gap-4 p-4 items-center hover:bg-white/5 transition-colors text-sm">
              <div className="font-bold flex items-center gap-2">
                {p.image_url ? <img src={p.image_url} className="w-6 h-6 rounded-full object-cover" /> : <div className="w-6 h-6 rounded-full bg-white/10" />}
                {p.first_name} {p.last_name}
              </div>
              <div className="text-zinc-400">{teams.find(t => t.id === p.team_id)?.name || 'Free Agent'}</div>
              <div className="font-mono flex items-center gap-2">
                <span className="text-[#E8C881] font-black">{p.overall_rating || 50}</span> 
                <span className="text-zinc-500 text-xs">{p.position}</span>
              </div>
              <div className="font-mono text-zinc-300">{p.jersey_number || '-'}</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-zinc-500 truncate w-24">{p.id}</span>
                <button onClick={() => handleCopy(p.id)} className="text-zinc-400 hover:text-white" title="Copy ID">
                  {copiedId === p.id ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => handleDelete(p.id)} className="text-red-500/50 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
