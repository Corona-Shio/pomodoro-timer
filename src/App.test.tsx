import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { storageKeys } from './lib/storage';

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-17T09:00:00.000Z'));
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
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

  it('does not start when minutes is zero', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '0' } });
    const startButton = screen.getByRole('button', { name: 'タイマー開始' });
    expect(startButton).toBeDisabled();

    fireEvent.click(startButton);

    const raw = localStorage.getItem(storageKeys.logs);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<{ id: string }>;
    expect(parsed).toHaveLength(0);
  });

  it('renders timeline axis even when no logs exist', () => {
    render(<App />);

    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('24:00')).toBeInTheDocument();
    expect(screen.getByText('記録がまだありません。1セッション完了するとここに表示されます。')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-events')).toBeInTheDocument();
  });

  it('records planned end time even if callbacks are delayed', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));

    await act(async () => {
      vi.advanceTimersByTime(65_000);
      await Promise.resolve();
    });

    const raw = localStorage.getItem(storageKeys.logs);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<{
      startedAt: string;
      endedAt: string;
      actualSeconds: number;
    }>;

    expect(parsed).toHaveLength(1);
    const diffMs = new Date(parsed[0].endedAt).getTime() - new Date(parsed[0].startedAt).getTime();
    expect(diffMs).toBe(60_000);
    expect(parsed[0].actualSeconds).toBe(60);
  });

  it('persists sound volume setting', () => {
    const { unmount } = render(<App />);

    fireEvent.change(screen.getByLabelText('通知音量 (120%)'), { target: { value: '140' } });

    const raw = localStorage.getItem(storageKeys.settings);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ soundVolume: 140 });

    unmount();
    render(<App />);

    expect(screen.getByLabelText('通知音量 (140%)')).toHaveValue('140');
  });

  it('persists sound type setting', () => {
    const { unmount } = render(<App />);

    fireEvent.change(screen.getByLabelText('通知音タイプ'), { target: { value: 'bell' } });

    const raw = localStorage.getItem(storageKeys.settings);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({ soundType: 'bell' });

    unmount();
    render(<App />);

    expect(screen.getByLabelText('通知音タイプ')).toHaveValue('bell');
  });

  it('places sound type selector above test button', () => {
    render(<App />);

    expect(screen.queryByLabelText('繰り返し回数')).not.toBeInTheDocument();

    const soundTypeSelect = screen.getByLabelText('通知音タイプ');
    const testButton = screen.getByRole('button', { name: '通知音をテスト' });
    const position = soundTypeSelect.compareDocumentPosition(testButton);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('migrates legacy volume and boost settings to unified volume', () => {
    localStorage.setItem(storageKeys.settings, JSON.stringify({ soundVolume: 70, soundBoost: 150 }));

    render(<App />);

    expect(screen.getByLabelText('通知音量 (105%)')).toHaveValue('105');
  });

  it('uses compact block rendering for 25 minute sessions', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('作業内容'), { target: { value: '集中作業' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));

    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1000 + 1_000);
      await Promise.resolve();
    });

    const compactTaskLabel = screen.getByText(/^集中作業、/);
    expect(compactTaskLabel).toBeInTheDocument();
    expect(compactTaskLabel.closest('article')).toHaveClass('compact');
    expect(screen.queryByText('計画 25分 / 実績 25分')).not.toBeInTheDocument();
  });
});
