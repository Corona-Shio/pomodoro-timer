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

  it('persists repeat count setting', () => {
    const { unmount } = render(<App />);

    fireEvent.change(screen.getByLabelText('繰り返し回数'), { target: { value: '3' } });

    const raw = localStorage.getItem(storageKeys.settings);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toMatchObject({
      soundRepeatCount: 3
    });

    unmount();
    render(<App />);

    expect(screen.getByLabelText('繰り返し回数')).toHaveValue('3');
  });

  it('migrates legacy volume and boost settings to unified volume', () => {
    localStorage.setItem(storageKeys.settings, JSON.stringify({ soundVolume: 70, soundBoost: 150 }));

    render(<App />);

    expect(screen.getByLabelText('通知音量 (105%)')).toHaveValue('105');
  });
});
