import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Freshers.css';

export function Freshers() {
    return (
        <section className="freshers-page">
            <Link to="/" className="freshers-back"><ArrowLeft size={16} /> Back to tournaments</Link>
            <div className="freshers-content">
                <p className="freshers-kicker">Super League / 2026</p>
                <h1>Freshers<br /><em>Tournament</em></h1>
                <p className="freshers-copy">A new season begins here. Fixtures, squads and match updates are coming soon.</p>
                <Link to="/team-builder" className="freshers-meta"><CalendarDays size={18} /> Build a Freshers team <ArrowRight size={18} /></Link>
            </div>
        </section>
    );
}