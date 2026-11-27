import { useState } from 'react';
import { Mail, Search, Shirt } from 'lucide-react';
import {
  Button, Checkbox, Combobox, Crest, DateTimeField, Field, NumberField, SegmentedControl, Select, Switch, Tabs, TextArea, TextInput, useToast,
} from '../components/ui';

// Developer-only review page for the input controls, with every state. Mounted at /ui-gallery in development builds only.
const crest = (name) => <Crest name={name} size="sm" className="size-7 text-[0.6rem]" />;
const TEAMS = [
  { value: 'lions', label: 'Lions FC', description: 'Block A, 3rd year', icon: crest('Lions FC') },
  { value: 'titans', label: 'Titans', description: 'Block B', icon: crest('Titans') },
  { value: 'wolves', label: 'Wolves United', description: 'Hostel 2', icon: crest('Wolves United') },
  { value: 'falcons', label: 'Falcons', description: 'Withdrawn', icon: crest('Falcons'), disabled: true },
  { value: 'rovers', label: 'Rovers', description: 'Block C', icon: crest('Rovers') },
];
const PLAYERS = ['Arjun Nair', 'Rahul Menon', 'Nikhil Das', 'Sreehari K', 'Aditya Varma', 'Joel Thomas', 'Kevin George', 'Fahad Ali', 'Vishnu Prasad', 'Ashwin Raj']
  .map((name, index) => ({ value: `p${index}`, label: name, description: `#${index + 2} · ${['GK', 'DEF', 'MID', 'FWD'][index % 4]}` }));
const STATUS = [{ value: 'scheduled', label: 'Scheduled' }, { value: 'live', label: 'Live' }, { value: 'final', label: 'Full time' }];

function Section({ title, children }) {
  return (
    <section className="glass space-y-5 rounded-card p-5 sm:p-6">
      <h2 className="font-display text-2xl text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function UiGallery() {
  const { toast } = useToast();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const [team, setTeam] = useState('lions');
  const [player, setPlayer] = useState();
  const [status, setStatus] = useState();
  const [card, setCard] = useState('yellow');
  const [side, setSide] = useState('home');
  const [tab, setTab] = useState('events');
  const [minute, setMinute] = useState(67);
  const [home, setHome] = useState(2);
  const [away, setAway] = useState(1);
  const [live, setLive] = useState(true);
  const [notify, setNotify] = useState(false);
  const [agree, setAgree] = useState(true);
  const [kick, setKick] = useState('2026-12-01T18:30');

  const flipTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Dev only</p>
          <h1 className="font-display text-4xl text-ink sm:text-6xl">Inputs</h1>
        </div>
        <Button variant="secondary" onClick={flipTheme}>{theme === 'dark' ? 'Light' : 'Dark'} theme</Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Text">
          <Field label="Team name" hint="As it appears on the table.">{(p) => <TextInput {...p} placeholder="Lions FC" />}</Field>
          <Field label="College email">{(p) => <TextInput {...p} icon={Mail} type="email" defaultValue="arjun@" />}</Field>
          <Field label="Short name" error="Use 2 to 4 letters.">{(p) => <TextInput {...p} defaultValue="LIONSS" />}</Field>
          <Field label="Search">{(p) => <TextInput {...p} icon={Search} size="lg" placeholder="Players, teams" />}</Field>
          <Field label="Disabled">{(p) => <TextInput {...p} disabled defaultValue="Locked" />}</Field>
          <Field label="Match notes">{(p) => <TextArea {...p} rows={3} placeholder="Anything the scorer should know" />}</Field>
        </Section>

        <Section title="Choose">
          <Field label="Team" hint="Crest, name and a description per option.">
            {(p) => <Select {...p} options={TEAMS} value={team} onChange={setTeam} />}
          </Field>
          <Field label="Scorer" hint="Search filters by name and position.">
            {(p) => <Combobox {...p} options={PLAYERS} value={player} onChange={setPlayer} placeholder="Find a player" />}
          </Field>
          <Field label="Status" error="Pick a status.">{(p) => <Select {...p} options={STATUS} value={status} onChange={setStatus} />}</Field>
          <Field label="Disabled">{(p) => <Select {...p} options={STATUS} value="final" onChange={() => {}} disabled />}</Field>
        </Section>

        <Section title="Toggle">
          <Field label="Card">
            {(p) => (
              <SegmentedControl
                aria-labelledby={p['aria-labelledby']}
                options={[{ value: 'yellow', label: 'Yellow' }, { value: 'second', label: 'Second yellow' }, { value: 'red', label: 'Red' }]}
                value={card}
                onChange={setCard}
              />
            )}
          </Field>
          <Field label="Team">
            {(p) => (
              <SegmentedControl
                aria-labelledby={p['aria-labelledby']}
                options={[{ value: 'home', label: 'Home', icon: <Shirt size={16} /> }, { value: 'away', label: 'Away', icon: <Shirt size={16} /> }]}
                value={side}
                onChange={setSide}
              />
            )}
          </Field>
          <Tabs label="Match views" value={tab} onChange={setTab} tabs={[{ id: 'events', label: 'Events' }, { id: 'lineups', label: 'Lineups' }, { id: 'stats', label: 'Stats' }]} />
          <div className="divide-y divide-line/70">
            <Switch label="Live scoring" description="Show the clock on the match page." checked={live} onChange={setLive} />
            <Switch label="Email me results" checked={notify} onChange={setNotify} />
            <Switch label="Disabled" checked disabled />
          </div>
          <div>
            <Checkbox label="Count towards the table" checked={agree} onChange={setAgree} />
            <Checkbox label="Played at a neutral ground" description="Neither side is at home." checked={false} onChange={() => {}} />
            <Checkbox label="Disabled" checked disabled />
          </div>
        </Section>

        <Section title="Numbers and time">
          <Field label="Minute" hint="Hold + or - to run. Arrow keys step, Page keys step by ten.">
            {(p) => <NumberField {...p} min={0} max={130} value={minute} onChange={setMinute} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Home">{(p) => <NumberField {...p} size="lg" min={0} max={99} value={home} onChange={setHome} />}</Field>
            <Field label="Away">{(p) => <NumberField {...p} size="lg" min={0} max={99} value={away} onChange={setAway} />}</Field>
          </div>
          <Field label="Kick-off">{(p) => <DateTimeField {...p} type="datetime-local" value={kick} onChange={(e) => setKick(e.target.value)} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">{(p) => <DateTimeField {...p} type="date" defaultValue="2026-12-01" />}</Field>
            <Field label="Time" error="Before kick-off.">{(p) => <DateTimeField {...p} type="time" defaultValue="18:00" />}</Field>
          </div>
          <Field label="Disabled">{(p) => <NumberField {...p} value={0} onChange={() => {}} disabled />}</Field>
        </Section>

        <Section title="Toasts">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast({ tone: 'success', title: 'Goal saved', description: 'Arjun Nair, 67′' })}>Success</Button>
            <Button variant="secondary" onClick={() => toast({ tone: 'error', title: 'Could not save', description: 'Check your connection and try again.' })}>Error</Button>
            <Button variant="quiet" onClick={() => toast({ title: 'Lineup published' })}>Info</Button>
          </div>
        </Section>

        <Section title="Native field (unchanged API)">
          <Field label="Visibility" as="select" defaultValue="public"><option value="public">Public</option><option value="hidden">Hidden</option></Field>
          <Field label="Summary" as="textarea" rows={2} placeholder="Shown under the title" />
        </Section>
      </div>
    </main>
  );
}
