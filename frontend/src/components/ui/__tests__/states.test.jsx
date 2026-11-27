// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('states what was checked with its title and optional action', () => {
    render(<EmptyState title="No matches yet" action={<a href="/teams">See clubs</a>}>Checked the schedule.</EmptyState>);
    expect(screen.getByText('No matches yet')).toBeTruthy();
    expect(screen.getByText('Checked the schedule.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See clubs' })).toBeTruthy();
  });
});

describe('ErrorState', () => {
  it('is an alert with the message and a retry that calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="You appear to be offline." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('You appear to be offline.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no retry button when there is nothing to retry', () => {
    render(<ErrorState message="Not found" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
