import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Save, Trash2, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import './TeamBuilder.css';

const emptyMember = { name: '', email: '', position: '' };

export function TeamBuilder() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [teamName, setTeamName] = useState('');
    const [division, setDivision] = useState('mens');
    const [members, setMembers] = useState([{ ...emptyMember }]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        const loadTeam = async () => {
            const { data } = await supabase.from('team_registrations').select('id, team_name, division, team_members(name, email, position)').eq('captain_id', user.id).maybeSingle();
            if (data) {
                setTeamName(data.team_name || '');
                setDivision(data.division || 'mens');
                setMembers(data.team_members?.length ? data.team_members.map(({ name, email, position }) => ({ name: name || '', email: email || '', position: position || '' })) : [{ ...emptyMember }]);
            }
            setLoading(false);
        };
        loadTeam();
    }, [user.id]);

    const updateMember = (index, field, value) => {
        setMembers((current) => current.map((member, memberIndex) => memberIndex === index ? { ...member, [field]: value } : member));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        const validMembers = members.filter((member) => member.name.trim());
        if (!teamName.trim() || validMembers.length === 0) {
            setError('Add a team name and at least one teammate.');
            return;
        }
        setSaving(true);
        setError('');
        setSuccess('');

        const { data: registration, error: registrationError } = await supabase.from('team_registrations').upsert({ captain_id: user.id, team_name: teamName.trim(), division }, { onConflict: 'captain_id' }).select('id').single();
        if (registrationError) {
            setError(registrationError.message);
            setSaving(false);
            return;
        }

        const { error: deleteError } = await supabase.from('team_members').delete().eq('registration_id', registration.id);
        if (deleteError) {
            setError(deleteError.message);
            setSaving(false);
            return;
        }

        const { error: membersError } = await supabase.from('team_members').insert(validMembers.map((member) => ({ registration_id: registration.id, name: member.name.trim(), email: member.email.trim() || null, position: member.position.trim() || null })));
        if (membersError) setError(membersError.message);
        else setSuccess('Team saved. Your roster is ready.');
        setSaving(false);
    };

    if (loading) return <div className="min-h-screen bg-black" />;

    return (
        <main className="team-builder">
            <Link to="/" className="team-builder-back"><ArrowLeft size={16} /> Back to tournaments</Link>
            <div className="team-builder-shell">
                <div className="team-builder-heading"><Users size={28} /><p>Captain workspace</p><h1>Form your<br /><em>team.</em></h1><span>Bring your teammates into the league.</span></div>
                <form onSubmit={handleSubmit} className="team-builder-form">
                    <label>Team name<input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="e.g. The Rovers" maxLength={60} required /></label>
                    <label>Division<select value={division} onChange={(event) => setDivision(event.target.value)}><option value="mens">Super League</option><option value="womens">WSL</option><option value="freshers">Freshers Tournament</option></select></label>
                    <div className="team-builder-members"><div className="team-builder-members-head"><div><p>Roster</p><span>Add each teammate's details</span></div><button type="button" onClick={() => setMembers((current) => [...current, { ...emptyMember }])} aria-label="Add teammate"><Plus size={18} /></button></div>
                        {members.map((member, index) => <div className="team-builder-member" key={index}><span className="team-builder-number">{String(index + 1).padStart(2, '0')}</span><input value={member.name} onChange={(event) => updateMember(index, 'name', event.target.value)} placeholder="Full name" required={index === 0} /><input type="email" value={member.email} onChange={(event) => updateMember(index, 'email', event.target.value)} placeholder="Email (optional)" /><input value={member.position} onChange={(event) => updateMember(index, 'position', event.target.value)} placeholder="Position" /><button type="button" onClick={() => setMembers((current) => current.length === 1 ? current : current.filter((_, memberIndex) => memberIndex !== index))} aria-label={`Remove teammate ${index + 1}`}><Trash2 size={16} /></button></div>)}
                    </div>
                    {(error || success) && <p className={error ? 'team-builder-error' : 'team-builder-success'}>{error || success}</p>}
                    <button className="team-builder-submit" type="submit" disabled={saving}>{saving ? 'Saving roster...' : <><Save size={18} /> Save team</>}</button>
                </form>
            </div>
        </main>
    );
}