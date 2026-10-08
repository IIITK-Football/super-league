import { ArrowLeft, ArrowRight, CalendarDays, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Freshers.css';

export function Freshers() {
    return (
        <section className="freshers-page">
            <Link to="/" className="freshers-back"><ArrowLeft size={16} /> Back to tournaments</Link>
            <div className="freshers-content">
                <p className="freshers-kicker">Super League / 2026</p>
                <h1>Freshers<br /><em>Tournament</em></h1>
                <p className="freshers-copy">A knockout tournament across October 12 and 13. Follow every fixture from the quarter-finals through the final.</p>
                <Link to="/standings/freshers" className="freshers-meta"><Trophy size={18} /> View Road to Final <ArrowRight size={18} /></Link>
            </div>
        </section>
    );
}
