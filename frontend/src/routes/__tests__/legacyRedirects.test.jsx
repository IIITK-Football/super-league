// @vitest-environment jsdom
// Group: frontend-components. /dictator is the dashboard's address; the legacy /admin address only redirects there (it
// renders no dashboard of its own, and admin is not a role).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LEGACY_REDIRECTS, LegacyRedirect } from '../legacyRedirects';

describe('legacy dashboard address', () => {
  it('sends /admin to /dictator', () => {
    render(<MemoryRouter initialEntries={['/admin']}>
      <Routes>
        {LEGACY_REDIRECTS.map(({ from, to }) => <Route key={from} path={from} element={<LegacyRedirect to={to} />} />)}
        <Route path="/dictator" element={<p>dictator workspace</p>} />
      </Routes>
    </MemoryRouter>);
    expect(screen.getByText('dictator workspace')).toBeTruthy();
  });

  it('the app wires the redirects and no route renders the dashboard at /admin', () => {
    const app = readFileSync(join(__dirname, '../../App.jsx'), 'utf8');
    expect(app).toMatch(/LEGACY_REDIRECTS\.map/);
    expect(app).not.toMatch(/path="\/admin"/);
    expect(app).toMatch(/path="\/dictator" element={<AppShell><RoleWorkspace requiredRole="dictator" \/><\/AppShell>}/);
    const login = readFileSync(join(__dirname, '../../pages/AdminLogin.jsx'), 'utf8');
    expect(login).not.toMatch(/['"]\/admin['"]/);
  });
});
