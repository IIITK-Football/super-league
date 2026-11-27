// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Sheet } from '../Sheet';
import { Tabs } from '../Tabs';
import { Field } from '../Field';

afterEach(cleanup);

function SheetHarness({ onClose = () => {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>More</button>
      <Sheet open={open} title="More" onClose={() => { onClose(); setOpen(false); }}>
        <a href="/rules">Rules</a>
        <button>Sign out</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('renders nothing while closed and moves focus into the dialog when opened', () => {
    render(<SheetHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('closes on Escape and returns focus to the opener', () => {
    const onClose = vi.fn();
    render(<SheetHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'More' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', () => {
    render(<SheetHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = screen.getByRole('dialog', { name: 'More' });
    const last = within(dialog).getByRole('button', { name: 'Sign out' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  });
});

describe('Tabs', () => {
  it('selects with arrows and marks the selected tab', () => {
    const onChange = vi.fn();
    const tabs = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
    render(<Tabs tabs={tabs} value="a" onChange={onChange} label="Sections" />);
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Field', () => {
  it('links the label, hint and error to the control', () => {
    render(<Field label="Team name" hint="As it appears" error="Required" />);
    const input = screen.getByLabelText('Team name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toMatch(/hint.*error|-hint.*-error/);
    expect(screen.getByText('Required')).toBeTruthy();
  });
});
