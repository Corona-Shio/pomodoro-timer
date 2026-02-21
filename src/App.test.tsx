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

  it('shows complete button only while running or paused', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument();
  });

  it('saves one log when completed manually while running', async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('作業内容'), { target: { value: '手動完了テスト' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: '完了' }));

    const raw = localStorage.getItem(storageKeys.logs);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<{ task: string; actualSeconds: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].task).toBe('手動完了テスト');
    expect(parsed[0].actualSeconds).toBe(30);
  });

  it('saves one log when completed manually while paused', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    fireEvent.click(screen.getByRole('button', { name: '完了' }));

    const raw = localStorage.getItem(storageKeys.logs);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Array<{ actualSeconds: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].actualSeconds).toBeGreaterThanOrEqual(1);
  });

  it('toggles main controls across start pause and resume states', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'タイマー開始' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '一時停止' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再開' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再開' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    expect(screen.queryByRole('button', { name: '一時停止' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再開' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '再開' }));
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再開' })).not.toBeInTheDocument();
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

  it('appends newly completed task to the bottom of history', async () => {
    localStorage.setItem(
      storageKeys.logs,
      JSON.stringify([
        {
          id: 'old',
          task: '既存タスク',
          plannedMinutes: 10,
          actualSeconds: 600,
          startedAt: '2026-02-16T09:00:00.000Z',
          endedAt: '2026-02-16T09:10:00.000Z',
          dateKey: '2026-02-16'
        }
      ])
    );

    render(<App />);

    fireEvent.change(screen.getByLabelText('分'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('作業内容'), { target: { value: '新規タスク' } });
    fireEvent.click(screen.getByRole('button', { name: 'タイマー開始' }));

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    const parsed = JSON.parse(localStorage.getItem(storageKeys.logs) as string) as Array<{ task: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].task).toBe('既存タスク');
    expect(parsed[1].task).toBe('新規タスク');
  });

  it('updates and deletes completed tasks from history table', () => {
    localStorage.setItem(
      storageKeys.logs,
      JSON.stringify([
        {
          id: 'edit-target',
          task: '編集前',
          plannedMinutes: 20,
          actualSeconds: 1200,
          startedAt: '2026-02-17T09:00:00.000Z',
          endedAt: '2026-02-17T09:20:00.000Z',
          dateKey: '2026-02-17'
        }
      ])
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    fireEvent.change(screen.getByLabelText('タスク名編集-edit-target'), { target: { value: '編集後' } });
    fireEvent.change(screen.getByLabelText('作業時間編集-edit-target'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    let parsed = JSON.parse(localStorage.getItem(storageKeys.logs) as string) as Array<{
      task: string;
      actualSeconds: number;
      endedAt: string;
    }>;
    expect(parsed[0].task).toBe('編集後');
    expect(parsed[0].actualSeconds).toBe(600);
    expect(parsed[0].endedAt).toBe('2026-02-17T09:10:00.000Z');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();

    parsed = JSON.parse(localStorage.getItem(storageKeys.logs) as string) as Array<{ id: string }>;
    expect(parsed).toHaveLength(0);
  });

  it('does not delete task when delete confirmation is canceled', () => {
    localStorage.setItem(
      storageKeys.logs,
      JSON.stringify([
        {
          id: 'delete-cancel',
          task: '削除キャンセル',
          plannedMinutes: 20,
          actualSeconds: 1200,
          startedAt: '2026-02-17T09:00:00.000Z',
          endedAt: '2026-02-17T09:20:00.000Z',
          dateKey: '2026-02-17'
        }
      ])
    );

    render(<App />);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();

    const parsed = JSON.parse(localStorage.getItem(storageKeys.logs) as string) as Array<{ id: string }>;
    expect(parsed).toHaveLength(1);
  });

  it('keeps end time and duration synced while editing history', () => {
    localStorage.setItem(
      storageKeys.logs,
      JSON.stringify([
        {
          id: 'sync-target',
          task: '連動テスト',
          plannedMinutes: 20,
          actualSeconds: 1200,
          startedAt: '2026-02-17T09:00:00.000Z',
          endedAt: '2026-02-17T09:20:00.000Z',
          dateKey: '2026-02-17'
        }
      ])
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '編集' }));

    const durationInput = screen.getByLabelText('作業時間編集-sync-target');
    fireEvent.change(durationInput, { target: { value: '30' } });
    const formatLocalDateTime = (date: Date): string => {
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      const hours = `${date.getHours()}`.padStart(2, '0');
      const minutes = `${date.getMinutes()}`.padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    const expectedAfterDurationEdit = formatLocalDateTime(new Date('2026-02-17T09:30:00.000Z'));
    expect(screen.getByLabelText('終了時間編集-sync-target')).toHaveValue(expectedAfterDurationEdit);

    const expectedAfterEndEdit = formatLocalDateTime(new Date('2026-02-17T09:45:00.000Z'));
    fireEvent.change(screen.getByLabelText('終了時間編集-sync-target'), { target: { value: expectedAfterEndEdit } });
    expect(screen.getByLabelText('作業時間編集-sync-target')).toHaveValue(45);
  });

  it('changes duration while keeping end time fixed when start time is edited', () => {
    localStorage.setItem(
      storageKeys.logs,
      JSON.stringify([
        {
          id: 'start-edit-target',
          task: '開始編集テスト',
          plannedMinutes: 20,
          actualSeconds: 1200,
          startedAt: '2026-02-17T09:00:00.000Z',
          endedAt: '2026-02-17T09:20:00.000Z',
          dateKey: '2026-02-17'
        }
      ])
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '編集' }));

    const formatLocalDateTime = (date: Date): string => {
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      const hours = `${date.getHours()}`.padStart(2, '0');
      const minutes = `${date.getMinutes()}`.padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    const endInput = screen.getByLabelText('終了時間編集-start-edit-target');
    const expectedEnd = formatLocalDateTime(new Date('2026-02-17T09:20:00.000Z'));
    expect(endInput).toHaveValue(expectedEnd);

    const expectedStart = formatLocalDateTime(new Date('2026-02-17T09:10:00.000Z'));
    fireEvent.change(screen.getByLabelText('開始時間編集-start-edit-target'), { target: { value: expectedStart } });

    expect(screen.getByLabelText('終了時間編集-start-edit-target')).toHaveValue(expectedEnd);
    expect(screen.getByLabelText('作業時間編集-start-edit-target')).toHaveValue(10);
  });
});
