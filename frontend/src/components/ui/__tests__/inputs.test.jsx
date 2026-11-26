// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Select, Combobox } from '../Select';
import { SegmentedControl } from '../SegmentedControl';
import { NumberField } from '../NumberField';
import { Field } from '../Field';

beforeAll(() => {
  // Radix positions the popover with ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(cleanup);

const TEAMS = [
  { value: 'lions', label: 'Lions', description: 'Block A' },
  { value: 'tigers', label: 'Tigers', disabled: true },
  { value: 'titans', label: 'Titans' },
  { value: 'wolves', label: 'Wolves' },
];

function Controlled({ as: Control = Select, initial, onChange = () => {}, ...props }) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Team">
      {(linked) => <Control {...linked} {...props} options={TEAMS} value={value} onChange={(v) => { setValue(v); onChange(v); }} />}
    </Field>
  );
}

describe('Select', () => {
  it('opens from the keyboard, skips disabled options, picks with Enter and shows the value', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: /Team/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = await screen.findByRole('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(list);
    expect(document.getElementById(list.getAttribute('aria-activedescendant')).textContent).toContain('Lions');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.getElementById(list.getAttribute('aria-activedescendant')).textContent).toBe('Titans');
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('titans');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger.textContent).toContain('Titans');
    expect(trigger.getAttribute('aria-labelledby')).toMatch(/-label .*-value/);
  });

  it('jumps by typed letters and closes on Escape without changing the value', async () => {
    const onChange = vi.fn();
    render(<Controlled initial="lions" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    const list = await screen.findByRole('listbox');
    expect(screen.getByRole('option', { name: /Lions/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'w' });
    expect(document.getElementById(list.getAttribute('aria-activedescendant')).textContent).toBe('Wolves');
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.getElementById(list.getAttribute('aria-activedescendant')).textContent).toBe('Wolves');
    fireEvent.keyDown(list, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks with a click and carries a hidden input for forms', async () => {
    const { container } = render(<Controlled name="team" />);
    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Wolves/ }));
    expect(container.querySelector('input[type="hidden"][name="team"]').value).toBe('wolves');
  });
});

describe('Combobox', () => {
  it('filters as you type, moves with arrows, picks with Enter, and shows an empty state', async () => {
    const onChange = vi.fn();
    render(<Controlled as={Combobox} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    const search = await screen.findByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.change(search, { target: { value: 'ti' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Tigers', 'Titans']);
    // The first enabled match is active straight away (Tigers is disabled).
    expect(document.getElementById(search.getAttribute('aria-activedescendant')).textContent).toBe('Titans');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('titans');

    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('matches on the description too', async () => {
    render(<Controlled as={Combobox} />);
    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'block a' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['LionsBlock A']);
  });
});

describe('SegmentedControl', () => {
  const CARDS = [{ value: 'yellow', label: 'Yellow' }, { value: 'second', label: 'Second yellow', disabled: true }, { value: 'red', label: 'Red' }];
  function Cards({ onChange }) {
    const [value, setValue] = useState('yellow');
    return <SegmentedControl aria-label="Card" options={CARDS} value={value} onChange={(v) => { setValue(v); onChange(v); }} />;
  }

  it('is a radio group with roving focus; arrows choose, skipping disabled, and wrap', () => {
    const onChange = vi.fn();
    render(<Cards onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Card' })).toBeTruthy();
    const yellow = screen.getByRole('radio', { name: 'Yellow' });
    expect(yellow.getAttribute('aria-checked')).toBe('true');
    expect(yellow.tabIndex).toBe(0);
    expect(screen.getByRole('radio', { name: 'Red' }).tabIndex).toBe(-1);
    fireEvent.keyDown(yellow, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('red');
    const red = screen.getByRole('radio', { name: 'Red' });
    expect(red.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(red);
    fireEvent.keyDown(red, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('yellow');
  });
});

describe('NumberField', () => {
  function Minute({ initial = 10, ...props }) {
    const [value, setValue] = useState(initial);
    return <NumberField aria-label="Minute" min={0} max={90} value={value} onChange={setValue} {...props} />;
  }

  it('steps with arrows and Page keys, clamps, and jumps with Home and End', () => {
    render(<Minute />);
    const input = screen.getByRole('spinbutton', { name: 'Minute' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('11');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('9');
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(input.value).toBe('19');
    fireEvent.keyDown(input, { key: 'End' });
    expect(input.value).toBe('90');
    expect(input.getAttribute('aria-valuenow')).toBe('90');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('90');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input.value).toBe('0');
  });

  it('clamps a typed value when committed with Enter or blur', () => {
    render(<Minute />);
    const input = screen.getByRole('spinbutton', { name: 'Minute' });
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('90');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(input.value).toBe('90');
  });

  it('repeats while + is held and stops on release', () => {
    vi.useFakeTimers();
    try {
      render(<Minute />);
      const input = screen.getByRole('spinbutton', { name: 'Minute' });
      const plus = screen.getByRole('button', { name: 'Increase' });
      fireEvent.pointerDown(plus, { button: 0 });
      expect(input.value).toBe('11');
      act(() => { vi.advanceTimersByTime(420 + 70 * 3); });
      expect(input.value).toBe('14');
      fireEvent.pointerUp(plus);
      fireEvent.click(plus);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(input.value).toBe('14');
      fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
      expect(input.value).toBe('13');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Combobox inside a Sheet', () => {
  it('Escape closes only the open list, not the sheet', async () => {
    const onClose = vi.fn();
    const { Sheet } = await import('../Sheet');
    render(<Sheet open title="Add goal" onClose={onClose}><Controlled as={Combobox} /></Sheet>);
    fireEvent.click(screen.getByRole('button', { name: /Team/ }));
    const search = await screen.findByRole('combobox');
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
