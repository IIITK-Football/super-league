// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../ConfirmDialog';
import { ConfirmProvider } from '../ConfirmProvider';
import { useConfirm } from '../useConfirm';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../Menu';

afterEach(cleanup);

function renderDialog(props = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Remove player"
      description="They leave the roster."
      confirmLabel="Remove"
      tone="danger"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onOpenChange, onConfirm };
}

describe('ConfirmDialog', () => {
  it('confirms, then closes', async () => {
    const { onOpenChange, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancel closes without confirming', () => {
    const { onOpenChange, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape closes without confirming', async () => {
    const { onOpenChange, onConfirm } = renderDialog();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps open and shows the rejection inline', async () => {
    const { onOpenChange } = renderDialog({ onConfirm: vi.fn().mockRejectedValue(new Error('Could not remove this player')) });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Could not remove this player')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

function Asker({ onAnswer }) {
  const confirm = useConfirm();
  return <button onClick={async () => onAnswer(await confirm({ title: 'Delete team', confirmLabel: 'Delete', tone: 'danger' }))}>Ask</button>;
}

describe('useConfirm', () => {
  it('resolves true when confirmed', async () => {
    const onAnswer = vi.fn();
    render(<ConfirmProvider><Asker onAnswer={onAnswer} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  });

  it('resolves false when cancelled', async () => {
    const onAnswer = vi.fn();
    render(<ConfirmProvider><Asker onAnswer={onAnswer} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });
});

describe('Menu', () => {
  it('opens from the keyboard and selects an item', async () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onEdit}>Edit</MenuItem>
          <MenuSeparator />
          <MenuItem tone="danger" onSelect={onSelect}>Remove</MenuItem>
        </MenuContent>
      </Menu>,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const remove = await screen.findByRole('menuitem', { name: 'Remove' });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(remove.className).toContain('text-live');
  });
});
