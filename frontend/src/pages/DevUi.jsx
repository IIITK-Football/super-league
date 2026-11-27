import { useState } from 'react';
import { Button, Card, ConfirmDialog, Crest, EmptyState, ErrorState, Field, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Notice, Pill, Popover, PopoverContent, PopoverTrigger, Scoreline, Sheet, Skeleton, Table, Tabs, useConfirm } from '../components/ui';

// Developer-only: every UI primitive in both themes. Mounted at /dev/ui in development builds only.
function Specimens() {
  const [tab, setTab] = useState('matches');
  const [sheet, setSheet] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const confirm = useConfirm();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Buttons and pills</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button size="lg" disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill>Scheduled</Pill>
          <Pill tone="acc">Next</Pill>
          <Pill tone="win">Won</Pill>
          <Pill tone="live">Live</Pill>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Scores</h2>
        <Card className="flex flex-wrap items-center gap-6">
          <Scoreline home={2} away={1} size="lg" />
          <Scoreline home={0} away={null} live />
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Crests</h2>
        <div className="flex items-center gap-3">
          <Crest name="Super League" color="var(--div)" size="lg" />
          <Crest name="Kottayam Strikers" size="md" />
          <Crest name="No Image" src="/missing.png" size="sm" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Tabs, fields and notices</h2>
        <Tabs label="Sections" value={tab} onChange={setTab} tabs={[{ id: 'matches', label: 'Matches' }, { id: 'table', label: 'Table' }]} />
        <Field label="Team name" hint="As it appears on the table" />
        <Field label="Position" as="select" error="Choose a position">
          <option value="">Choose</option>
          <option value="gk">Goalkeeper</option>
        </Field>
        <Notice tone="success">Saved</Notice>
        <Notice tone="error">Could not save</Notice>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Table</h2>
        <Table caption="Standings">
          <thead><tr><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            <tr><td>Kottayam Strikers</td><td>6</td><td>+9</td><td>15</td></tr>
            <tr><td>Lions FC</td><td>6</td><td>+2</td><td>11</td></tr>
          </tbody>
        </Table>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">States</h2>
        <Skeleton className="h-6 w-48" />
        <EmptyState title="No fixtures yet">Checked the schedule for this season.</EmptyState>
        <ErrorState message="You appear to be offline." onRetry={() => {}} />
        <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <Sheet open={sheet} title="More" onClose={() => setSheet(false)}>
          <p className="text-ink">Sheet content. Escape closes it.</p>
        </Sheet>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-bold text-ink">Confirm, menu and popover</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" onClick={() => confirm({ title: 'Remove this team?', description: 'Its fixtures stay in the record.', confirmLabel: 'Remove', tone: 'danger' })}>Ask with useConfirm</Button>
          <Button variant="secondary" onClick={() => setAskDelete(true)}>Open dialog</Button>
          <ConfirmDialog open={askDelete} onOpenChange={setAskDelete} title="Delete this season?" description="Matches move to the archive." confirmLabel="Delete" tone="danger" onConfirm={() => new Promise((_, reject) => setTimeout(() => reject(new Error('Could not delete. Try again.')), 600))} />
          <Menu>
            <MenuTrigger>Actions</MenuTrigger>
            <MenuContent aria-label="Actions">
              <MenuItem>Edit details</MenuItem>
              <MenuItem>Copy link</MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger">Remove</MenuItem>
            </MenuContent>
          </Menu>
          <Popover>
            <PopoverTrigger>Info</PopoverTrigger>
            <PopoverContent>Popovers hold short, non-critical detail. Escape closes them.</PopoverContent>
          </Popover>
        </div>
      </section>
    </div>
  );
}

export default function DevUi() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <h1 className="font-display text-4xl font-extrabold text-ink">UI primitives</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        {['dark', 'light'].map((theme) => (
          <div key={theme} data-theme={theme} className="rounded-card border border-line bg-bg p-4 sm:p-6">
            <p className="mb-6 text-sm font-semibold text-mut">{theme} theme</p>
            <Specimens />
          </div>
        ))}
      </div>
    </div>
  );
}
