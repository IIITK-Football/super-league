import { fireEvent, screen } from '@testing-library/react';

// Radix positions popovers with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

// Drives the custom Select and Combobox: open the control by its label, then click the option.
export async function pick(label, option) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

// Drives NumberField: type a value and commit it with Enter.
export function setNumber(label, value) {
  const input = screen.getByRole('spinbutton', { name: label });
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
