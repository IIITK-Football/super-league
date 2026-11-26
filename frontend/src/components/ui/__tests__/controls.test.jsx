// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, buttonClasses } from '../Button';
import { Pill } from '../Pill';
import { Card } from '../Card';
import { Notice } from '../Notice';
import { Skeleton } from '../Skeleton';

afterEach(cleanup);

describe('Button', () => {
  it('defaults to type button, fires onClick, and carries the variant class', () => {
    const onClick = vi.fn();
    render(<Button variant="danger" onClick={onClick}>Remove</Button>);
    const button = screen.getByRole('button', { name: 'Remove' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('bg-live');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps every size at least 44px tall', () => {
    for (const size of ['sm', 'md', 'lg']) expect(buttonClasses('primary', size)).toMatch(/min-h-1[12]/);
  });
});

describe('Pill', () => {
  it('shows a pulsing dot only for the live tone', () => {
    const { container, rerender } = render(<Pill tone="live">Live</Pill>);
    expect(container.querySelector('[class*="animate-pulse-dot"]')).not.toBeNull();
    rerender(<Pill>Scheduled</Pill>);
    expect(container.querySelector('[class*="animate-pulse-dot"]')).toBeNull();
  });
});

describe('Card', () => {
  it('renders the chosen element with the surface classes', () => {
    render(<Card as="section" data-testid="card">Body</Card>);
    const card = screen.getByTestId('card');
    expect(card.tagName).toBe('SECTION');
    expect(card.className).toContain('bg-surf');
  });
});

describe('Notice', () => {
  it('announces inline status with role status', () => {
    render(<Notice tone="success">Saved</Notice>);
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });
});

describe('Skeleton', () => {
  it('is decorative and motion-safe', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    const bar = container.firstChild;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.className).toContain('motion-safe:animate-pulse');
  });
});
