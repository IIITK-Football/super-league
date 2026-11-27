// Drives the Select and Combobox pickers in tests: open one by its label, read or click its options by name.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

// Radix positions the list with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// A closing list is still in the page while it fades, so the trigger is the first element with the label.
export const trigger = (label) => screen.getAllByLabelText(label)[0];
const optionName = (o) => [...o.children].filter((c) => !c.getAttribute('aria-hidden')).map((c) => c.textContent).join('');

export async function pick(label, name) {
  fireEvent.click(trigger(label));
  const list = await screen.findByRole('listbox');
  const option = within(list).getAllByRole('option').find((o) => (name instanceof RegExp ? name.test(optionName(o)) : optionName(o) === name));
  if (!option) throw new Error(`No option ${name} in ${label}: ${within(list).getAllByRole('option').map(optionName).join(', ')}`);
  fireEvent.click(option);
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

export async function optionsOf(label) {
  fireEvent.click(trigger(label));
  const list = await screen.findByRole('listbox');
  const names = within(list).queryAllByRole('option').map(optionName);
  fireEvent.keyDown(list, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  return names;
}
