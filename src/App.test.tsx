import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { storageKeys } from './lib/storage';

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves one log after timer reaches zero', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('作業内容'), { target: { value: 'テスト作業' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    const raw = localStorage.getItem(storageKeys.logs);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<{ task: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].task).toBe('テスト作業');
  });
});
