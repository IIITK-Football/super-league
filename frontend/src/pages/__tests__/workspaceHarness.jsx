// Test harness for the staff workspace: the real RoleWorkspace and sidebar, with every tool replaced by a labelled
// panel. Import it after mocking AuthContext.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

export const PANELS = ['LiveController', 'ScheduleMatches', 'ManageNews', 'GradePredictions', 'ManageCaptains', 'ManageScorers', 'ManageRoles', 'ManageDivisions', 'ManageRosters', 'AuditHistory'];

export function mockTools() {
  for (const name of PANELS) vi.doMock(`../../components/admin/${name}`, () => ({ default: () => <p>{name} panel</p> }));
  vi.doMock('../TeamBuilder', () => ({ TeamBuilder: () => <p>TeamBuilder panel</p> }));
  vi.doMock('../workspace/Overview', () => ({ Overview: () => <p>overview panel</p> }));
}

export async function renderWorkspace(path) {
  const { RoleWorkspace } = await import('../RoleWorkspace');
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/dictator" element={<RoleWorkspace requiredRole="dictator" />} />
    <Route path="/dictator/:tool" element={<RoleWorkspace requiredRole="dictator" />} />
    <Route path="/editor" element={<RoleWorkspace requiredRole="editor" />} />
    <Route path="/team-builder" element={<RoleWorkspace requiredRole="captain" />} />
    <Route path="/" element={<p>home</p>} />
  </Routes></MemoryRouter>);
}

// The tool names in the first workspace sidebar, in order.
export const navNames = () => {
  const nav = screen.queryAllByRole('navigation', { name: 'Workspace tools' })[0];
  return nav ? [...nav.querySelectorAll('a')].map((a) => a.textContent.trim().toLowerCase()) : [];
};
