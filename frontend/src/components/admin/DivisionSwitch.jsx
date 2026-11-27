import { useDivisions } from '../../hooks/useDivisions';
import { Notice, Tabs } from '../ui';

// Division picker for the workspace tools, built from the divisions table.
export function DivisionSwitch({ value, onChange }) {
  const { divisions, loading, error } = useDivisions();
  if (error) return <Notice tone="error">Could not load divisions: {error}</Notice>;
  if (loading) return <p className="text-sm text-mut">Loading divisions...</p>;
  if (!divisions.length) return <p className="text-sm text-mut">No divisions yet.</p>;
  const tabs = divisions.map((d) => ({ id: d.slug, label: d.name }));
  return <Tabs tabs={tabs} value={value} onChange={onChange} label="Division" />;
}
