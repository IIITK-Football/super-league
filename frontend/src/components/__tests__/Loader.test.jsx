// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Loader } from '../Loader';

afterEach(cleanup);

it('shows a spinner with its text, and the spinner alone when the text is empty', () => {
  const view = render(<Loader text="Loading rules" />);
  expect(screen.getByText('Loading rules')).toBeTruthy();
  expect(view.container.querySelector('svg.animate-spin')).toBeTruthy();
  view.rerender(<Loader text="" fullScreen />);
  expect(view.container.querySelector('span')).toBeNull();
});
