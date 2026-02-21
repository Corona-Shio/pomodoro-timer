import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  assignLanes,
  calcMinuteHandAngle,
  clampMinutes,
  formatRemaining,
  minutesFromStartOfDay,
  toDateKey
} from './lib/timer';
import {
  loadLogs,
  loadSetMinutes,
  loadSoundType,
  loadSoundVolume,
  saveLogs,
  saveSetMinutes,
  saveSoundType,
  saveSoundVolume
} from './lib/storage';
import type { CompletionSound, TimeLog, TimerStatus } from './lib/types';

const DAY_MINUTES = 24 * 60;
const PIXELS_PER_MINUTE = 1.2;
const TIMELINE_EDGE_PADDING = 14;
const TIMELINE_LABEL_GUTTER = 72;
const TIMELINE_BODY_HEIGHT = DAY_MINUTES * PIXELS_PER_MINUTE;
const TIMELINE_TOTAL_HEIGHT = TIMELINE_BODY_HEIGHT + TIMELINE_EDGE_PADDING * 2;
const COMPACT_THRESHOLD_MINUTES = 30;

type SessionMeta = {
  startedAt: Date;
  plannedMinutes: number;
  task: string;
};

type TimerMode = 'work' | 'break';

const nowClock = (): string =>
  new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

const toMeridiemTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ja-JP', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

const toDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

const toDateTimeInputValue = (value: string | Date): string => {
  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
};

const clampDurationMinutes = (minutes: number): number => Math.max(1, Math.round(minutes));
const calcDurationMinutes = (startedAt: string, endedAt: string): number => {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 1;
  }
  return clampDurationMinutes((endMs - startMs) / 60000);
};

const toBreakSeconds = (plannedMinutes: number): number => Math.max(1, Math.round(plannedMinutes * 60 * 0.2));

const requestNotificationPermission = (): void => {
  if (typeof Notification === 'undefined') {
    return;
  }
  if (Notification.permission !== 'default') {
    return;
  }
  void Notification.requestPermission().catch(() => undefined);
};

const notifyCompletion = (task: string, plannedMinutes: number): void => {
  if (typeof Notification === 'undefined') {
    return;
  }
  if (Notification.permission !== 'granted') {
    return;
  }
  new Notification('Pomodoro 完了', {
    body: `${task} (${plannedMinutes}分) が完了しました。`
  });
};

const clampVolume = (volume: number): number => Math.min(200, Math.max(0, Math.round(volume)));
const clampRepeatCount = (count: number): number => Math.min(5, Math.max(1, Math.round(count)));
const FIXED_SOUND_REPEAT_COUNT = 4;
const sortLogsByEndTime = (entries: TimeLog[]): TimeLog[] =>
  [...entries].sort((a, b) => new Date(a.endedAt).getTime() - new Date(b.endedAt).getTime());
const isCompletionSound = (value: string): value is CompletionSound =>
  value === 'chime' || value === 'bell' || value === 'beep' || value === 'silent';

const playCompletionSound = (soundType: CompletionSound, volume: number, repeatCount: number): void => {
  if (soundType === 'silent') {
    return;
  }

  const audioContextCtor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!audioContextCtor) {
    return;
  }

  const ctx = new audioContextCtor();
  const startAt = ctx.currentTime;
  const gainPeak = Math.min(0.95, 0.38 * (clampVolume(volume) / 100));
  const repeat = clampRepeatCount(repeatCount);
  const playNote = (freq: number, offset: number, duration: number, waveType: OscillatorType): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const noteStart = startAt + offset;
    const noteEnd = noteStart + duration;

    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainPeak), noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(noteStart);
    osc.stop(noteEnd);
  };

  let totalDuration = 0.4;
  for (let cycle = 0; cycle < repeat; cycle += 1) {
    if (soundType === 'chime') {
      const base = cycle * 0.5;
      playNote(880, base, 0.14, 'sine');
      playNote(660, base + 0.18, 0.14, 'sine');
      totalDuration = base + 0.32;
    } else if (soundType === 'bell') {
      const base = cycle * 0.56;
      playNote(1046, base, 0.12, 'triangle');
      playNote(1318, base + 0.12, 0.12, 'triangle');
      playNote(1568, base + 0.24, 0.12, 'triangle');
      totalDuration = base + 0.36;
    } else {
      const base = cycle * 0.42;
      playNote(880, base, 0.2, 'square');
      totalDuration = base + 0.2;
    }
  }

  void ctx.resume().catch(() => undefined);
  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, Math.ceil((totalDuration + 0.2) * 1000));
};

function App() {
  const defaultTitleRef = useRef<string>(document.title);
  const dialNumbers = useMemo(() => Array.from({ length: 12 }, (_, idx) => (idx === 0 ? 60 : idx * 5)), []);
  const initialSetMinutes = useMemo(() => loadSetMinutes(), []);
  const initialSoundVolume = useMemo(() => loadSoundVolume(), []);
  const initialSoundType = useMemo(() => loadSoundType(), []);
  const [setMinutes, setSetMinutes] = useState(initialSetMinutes);
  const [soundVolume, setSoundVolume] = useState(initialSoundVolume);
  const [soundType, setSoundType] = useState<CompletionSound>(initialSoundType);
  const [remainingSeconds, setRemainingSeconds] = useState(initialSetMinutes * 60);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [mode, setMode] = useState<TimerMode>('work');
  const [breakSuggestionSeconds, setBreakSuggestionSeconds] = useState(5 * 60);
  const [taskInput, setTaskInput] = useState('');
  const [logs, setLogs] = useState<TimeLog[]>(() => sortLogsByEndTime(loadLogs()));
  const [clock, setClock] = useState(nowClock());
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState('');
  const [editStartedAtInput, setEditStartedAtInput] = useState('');
  const [editEndedAtInput, setEditEndedAtInput] = useState('');
  const [editDurationMinutes, setEditDurationMinutes] = useState(25);
  const sessionRef = useRef<SessionMeta | null>(null);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(nowClock());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (status !== 'running') {
      return;
    }

    const syncRemaining = (): void => {
      if (deadlineRef.current === null) {
        return;
      }
      const diffMs = deadlineRef.current - Date.now();
      const next = Math.max(0, Math.ceil(diffMs / 1000));
      setRemainingSeconds((prev) => (prev === next ? prev : next));
    };

    syncRemaining();
    const timer = window.setInterval(() => {
      syncRemaining();
    }, 250);

    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    saveSetMinutes(setMinutes);
  }, [setMinutes]);

  useEffect(() => {
    saveSoundVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    saveSoundType(soundType);
  }, [soundType]);

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  useEffect(() => {
    const shouldShowCountdownTitle = mode === 'break' || (mode === 'work' && status !== 'idle' && status !== 'done');
    document.title = shouldShowCountdownTitle
      ? `${formatRemaining(remainingSeconds)} ${mode}`
      : defaultTitleRef.current;
  }, [mode, remainingSeconds, status]);

  useEffect(() => {
    return () => {
      document.title = defaultTitleRef.current;
    };
  }, []);

  const switchToBreak = useCallback((plannedMinutes: number): void => {
    const breakSeconds = toBreakSeconds(plannedMinutes);
    setMode('break');
    setStatus('idle');
    setBreakSuggestionSeconds(breakSeconds);
    setRemainingSeconds(breakSeconds);
    deadlineRef.current = null;
  }, []);

  const switchToWork = useCallback((): void => {
    setMode('work');
    setStatus('idle');
    setRemainingSeconds(setMinutes * 60);
    deadlineRef.current = null;
  }, [setMinutes]);

  const completeWorkSession = useCallback(
    (endedAtMs: number, actualSeconds: number, withNotification: boolean): void => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      const endedAt = new Date(endedAtMs);
      const plannedSeconds = session.plannedMinutes * 60;
      const safeActualSeconds = Math.max(1, Math.min(plannedSeconds, Math.round(actualSeconds)));

      const newLog: TimeLog = {
        id: crypto.randomUUID(),
        task: session.task,
        plannedMinutes: session.plannedMinutes,
        actualSeconds: safeActualSeconds,
        startedAt: session.startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        dateKey: toDateKey(session.startedAt)
      };

      setLogs((prev) => [...prev, newLog]);
      if (withNotification) {
        notifyCompletion(session.task, session.plannedMinutes);
        playCompletionSound(soundType, soundVolume, FIXED_SOUND_REPEAT_COUNT);
      }
      sessionRef.current = null;
      deadlineRef.current = null;
      switchToBreak(session.plannedMinutes);
    },
    [soundType, soundVolume, switchToBreak]
  );

  useEffect(() => {
    if (status !== 'running' || remainingSeconds !== 0) {
      return;
    }

    if (mode === 'work') {
      const endedAtMs = deadlineRef.current ?? Date.now();
      const plannedSeconds = (sessionRef.current?.plannedMinutes ?? 0) * 60;
      completeWorkSession(endedAtMs, plannedSeconds, true);
      return;
    }

    switchToWork();
  }, [completeWorkSession, mode, remainingSeconds, status, switchToWork]);

  const canEditSetting = mode === 'work' && (status === 'idle' || status === 'done');
  const handAngle = calcMinuteHandAngle(remainingSeconds);
  const redSectorAngle = remainingSeconds > 60 * 60 ? 360 : handAngle;
  const todayKey = toDateKey(new Date());
  const todaysLogs = useMemo(() => logs.filter((entry) => entry.dateKey === todayKey), [logs, todayKey]);
  const timeline = useMemo(() => assignLanes(todaysLogs), [todaysLogs]);
  const isBreakMode = mode === 'break';

  const applyMinutes = (nextMinutes: number): void => {
    const clamped = clampMinutes(nextMinutes);
    setSetMinutes(clamped);
    if (canEditSetting) {
      setRemainingSeconds(clamped * 60);
    }
  };

  const onSoundVolumeChange = (nextVolume: number): void => {
    setSoundVolume(clampVolume(nextVolume));
  };

  const onTestSound = (): void => {
    playCompletionSound(soundType, soundVolume, FIXED_SOUND_REPEAT_COUNT);
  };

  const onSoundTypeChange = (nextSoundType: string): void => {
    if (!isCompletionSound(nextSoundType)) {
      return;
    }
    setSoundType(nextSoundType);
  };

  const onStart = (): void => {
    if (status === 'running') {
      return;
    }

    if (mode === 'break') {
      if (remainingSeconds <= 0) {
        return;
      }
      if (status === 'idle' || status === 'done') {
        deadlineRef.current = Date.now() + remainingSeconds * 1000;
      }
      setStatus('running');
      return;
    }

    if (setMinutes <= 0) {
      return;
    }

    requestNotificationPermission();

    const now = new Date();
    const task = taskInput.trim() || '無題タスク';

    if (status === 'idle' || status === 'done') {
      const total = setMinutes * 60;
      sessionRef.current = {
        startedAt: now,
        plannedMinutes: setMinutes,
        task
      };
      setRemainingSeconds(total);
      deadlineRef.current = now.getTime() + total * 1000;
    }

    setStatus('running');
  };

  const onPause = (): void => {
    if (status === 'running') {
      if (deadlineRef.current !== null) {
        const diffMs = deadlineRef.current - Date.now();
        setRemainingSeconds(Math.max(0, Math.ceil(diffMs / 1000)));
      }
      deadlineRef.current = null;
      setStatus('paused');
    }
  };

  const onResume = (): void => {
    if (status === 'paused') {
      deadlineRef.current = Date.now() + remainingSeconds * 1000;
      setStatus('running');
    }
  };

  const onReset = (): void => {
    sessionRef.current = null;
    deadlineRef.current = null;
    setMode('work');
    setStatus('idle');
    setRemainingSeconds(setMinutes * 60);
  };

  const onSkipBreak = (): void => {
    switchToWork();
  };

  const onComplete = (): void => {
    if (status !== 'running' && status !== 'paused') {
      return;
    }

    if (mode !== 'work') {
      return;
    }

    const session = sessionRef.current;
    if (!session) {
      return;
    }

    const totalSeconds = session.plannedMinutes * 60;
    const elapsedSeconds = totalSeconds - remainingSeconds;
    completeWorkSession(Date.now(), elapsedSeconds, false);
  };

  const onStartEditingLog = (log: TimeLog): void => {
    setEditingLogId(log.id);
    setEditTask(log.task);
    setEditStartedAtInput(toDateTimeInputValue(log.startedAt));
    setEditEndedAtInput(toDateTimeInputValue(log.endedAt));
    setEditDurationMinutes(calcDurationMinutes(log.startedAt, log.endedAt));
  };

  const onCancelEditingLog = (): void => {
    setEditingLogId(null);
  };

  const onSaveLog = (): void => {
    if (!editingLogId) {
      return;
    }
    const nextTask = editTask.trim() || '無題タスク';

    setLogs((prev) =>
      prev.map((log) => {
        if (log.id !== editingLogId) {
          return log;
        }
        const originalStartMs = new Date(log.startedAt).getTime();
        const originalEndMs = new Date(log.endedAt).getTime();
        const parsedStartMs = new Date(editStartedAtInput).getTime();
        const parsedEndedAtMs = new Date(editEndedAtInput).getTime();
        const safeDurationMinutes = clampDurationMinutes(editDurationMinutes);
        const nextEndedAtMs = Number.isFinite(parsedEndedAtMs)
          ? parsedEndedAtMs
          : Number.isFinite(originalEndMs)
            ? originalEndMs
            : originalStartMs + safeDurationMinutes * 60_000;
        const draftStartedAtMs = Number.isFinite(parsedStartMs) ? parsedStartMs : originalStartMs;
        const nextStartedAtMs = Math.min(draftStartedAtMs, nextEndedAtMs - 60_000);
        const nextDurationMinutes = clampDurationMinutes((nextEndedAtMs - nextStartedAtMs) / 60_000);
        return {
          ...log,
          task: nextTask,
          startedAt: new Date(nextStartedAtMs).toISOString(),
          dateKey: toDateKey(new Date(nextStartedAtMs)),
          actualSeconds: nextDurationMinutes * 60,
          endedAt: new Date(nextEndedAtMs).toISOString()
        };
      })
    );
    setEditingLogId(null);
  };

  const onDeleteLog = (id: string): void => {
    if (!window.confirm('この完了タスクを削除しますか？')) {
      return;
    }
    setLogs((prev) => prev.filter((log) => log.id !== id));
    if (editingLogId === id) {
      setEditingLogId(null);
    }
  };

  const onEditStartedAtChange = (value: string): void => {
    setEditStartedAtInput(value);
    const startMs = new Date(value).getTime();
    const endMs = new Date(editEndedAtInput).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return;
    }
    const safeStartMs = Math.min(startMs, endMs - 60_000);
    if (safeStartMs !== startMs) {
      setEditStartedAtInput(toDateTimeInputValue(new Date(safeStartMs)));
    }
    setEditDurationMinutes(clampDurationMinutes((endMs - safeStartMs) / 60_000));
  };

  const onEditEndedAtChange = (value: string): void => {
    setEditEndedAtInput(value);
    const startMs = new Date(editStartedAtInput).getTime();
    const endMs = new Date(value).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return;
    }
    setEditDurationMinutes(clampDurationMinutes((endMs - startMs) / 60_000));
  };

  const onEditDurationChange = (nextDuration: number): void => {
    const startMs = new Date(editStartedAtInput).getTime();
    const safeDurationMinutes = clampDurationMinutes(nextDuration);
    setEditDurationMinutes(safeDurationMinutes);
    if (!Number.isFinite(startMs)) {
      return;
    }
    const nextEndedAtMs = startMs + safeDurationMinutes * 60_000;
    setEditEndedAtInput(toDateTimeInputValue(new Date(nextEndedAtMs)));
  };

  return (
    <main className={`app-shell ${isBreakMode ? 'is-break-mode' : ''}`}>
      <section className={`timer-card ${status === 'done' ? 'is-done' : ''}`}>
        <header className="timer-head">
          <div>
            <h1>Pomodoro Timer</h1>
            <p>{mode === 'work' ? 'ポモドーロタイマー' : '休憩タイマー'}</p>
          </div>
          <strong className="clock-pill" aria-label="現在時刻">
            {clock}
          </strong>
        </header>

        <div className="dial-wrap">
          <div className="dial" role="img" aria-label="アナログタイマー盤">
            <div className="ticks" aria-hidden="true">
              {Array.from({ length: 60 }).map((_, idx) => (
                <i
                  key={idx}
                  className={`tick ${idx % 5 === 0 ? 'major' : ''}`}
                  style={{ transform: `rotate(${idx * 6}deg)` }}
                />
              ))}
            </div>
            <div className="numerals" aria-hidden="true">
              {dialNumbers.map((value, idx) => (
                <i key={value} className="numeral" style={{ transform: `rotate(${idx * 30}deg) translateY(-45%)` }}>
                  <span style={{ transform: `rotate(${-idx * 30}deg)` }}>{value}</span>
                </i>
              ))}
            </div>
            <div className="red-mask" style={{ '--red-angle': `${redSectorAngle}deg` } as CSSProperties} />
            <div className="hand" style={{ transform: `translate(-50%, 0) rotate(${handAngle}deg)` }} />
            <div className="center-dot" />
          </div>
        </div>

        <div className="controls-grid">
          <section className="panel" aria-label="タイマー設定">
            <h2>タイマー設定</h2>
            <label htmlFor="minutes-input">分</label>
            <input
              id="minutes-input"
              type="number"
              min={0}
              max={180}
              step={1}
              value={setMinutes}
              onChange={(event) => applyMinutes(Number(event.target.value))}
              disabled={!canEditSetting}
            />
            <div className="quick-buttons">
              <button type="button" onClick={() => applyMinutes(setMinutes - 10)} disabled={!canEditSetting} aria-label="10分減らす">
                -10
              </button>
              <button type="button" onClick={() => applyMinutes(setMinutes - 5)} disabled={!canEditSetting} aria-label="5分減らす">
                -5
              </button>
              <button type="button" onClick={() => applyMinutes(setMinutes + 5)} disabled={!canEditSetting} aria-label="5分増やす">
                +5
              </button>
              <button type="button" onClick={() => applyMinutes(setMinutes + 10)} disabled={!canEditSetting} aria-label="10分増やす">
                +10
              </button>
            </div>
            <hr className="panel-divider" />
            <label htmlFor="sound-volume">通知音量 ({soundVolume}%)</label>
            <input
              id="sound-volume"
              type="range"
              min={0}
              max={200}
              step={5}
              value={soundVolume}
              onChange={(event) => onSoundVolumeChange(Number(event.target.value))}
            />
            <label htmlFor="sound-type">通知音タイプ</label>
            <select id="sound-type" value={soundType} onChange={(event) => onSoundTypeChange(event.target.value)}>
              <option value="chime">チャイム</option>
              <option value="bell">ベル</option>
              <option value="beep">ビープ</option>
              <option value="silent">無音（通知のみ）</option>
            </select>
            <button type="button" onClick={onTestSound} className="secondary" aria-label="通知音をテスト">
              通知音をテスト
            </button>
          </section>

          <section className="panel" aria-label="セッション操作">
            <h2>{mode === 'work' ? 'セッション' : '休憩'}</h2>
            <label htmlFor="task-input">作業内容</label>
            <input
              id="task-input"
              type="text"
              placeholder="例: 企画書の下書き"
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
              disabled={mode !== 'work'}
            />
            {mode === 'break' && (
              <p className="break-hint">休憩時間: {formatRemaining(breakSuggestionSeconds)}（設定時間の20%）</p>
            )}
            <div className="action-buttons">
              {(status === 'idle' || status === 'done') && (
                <button
                  type="button"
                  onClick={onStart}
                  disabled={mode === 'work' && setMinutes <= 0}
                  className="primary action-main action-main-full"
                  aria-label="タイマー開始"
                >
                  スタート
                </button>
              )}
              {status === 'running' && (
                <button type="button" onClick={onPause} className="primary action-main" aria-label="一時停止">
                  一時停止
                </button>
              )}
              {status === 'paused' && (
                <button type="button" onClick={onResume} className="primary action-main" aria-label="再開">
                  再開
                </button>
              )}
              {mode === 'work' && (status === 'running' || status === 'paused') && (
                <button type="button" onClick={onComplete} className="complete" aria-label="完了">
                  完了
                </button>
              )}
              {mode === 'break' && (status === 'running' || status === 'paused') && (
                <button type="button" onClick={onSkipBreak} className="complete" aria-label="スキップ">
                  スキップ
                </button>
              )}
              {mode === 'work' && (
                <button type="button" onClick={onReset} className="secondary action-reset" aria-label="リセット">
                  リセット
                </button>
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="timeline-card" aria-label="本日のタイムライン">
        <header className="timeline-head">
          <h2>今日のタイムライン</h2>
          <span>{todayKey}</span>
        </header>

        {timeline.logs.length === 0 && (
          <p className="empty">記録がまだありません。1セッション完了するとここに表示されます。</p>
        )}
        <div className="timeline-shell">
          <div className="timeline-axis" style={{ height: `${TIMELINE_TOTAL_HEIGHT}px` }}>
            <div
              className="timeline-grid"
              data-testid="timeline-grid"
              style={{ top: `${TIMELINE_EDGE_PADDING}px`, height: `${TIMELINE_BODY_HEIGHT}px` }}
            >
              {Array.from({ length: 25 }).map((_, hour) => (
                <div
                  className="hour-line"
                  key={hour}
                  style={{ top: `${(hour / 24) * 100}%` }}
                >
                  <span>{`${hour.toString().padStart(2, '0')}:00`}</span>
                </div>
              ))}
            </div>

            <div
              className="timeline-events"
              data-testid="timeline-events"
              style={{
                top: `${TIMELINE_EDGE_PADDING}px`,
                left: `${TIMELINE_LABEL_GUTTER}px`,
                height: `${TIMELINE_BODY_HEIGHT}px`
              }}
            >
              {timeline.logs.map((entry) => {
                const startMinute = minutesFromStartOfDay(entry.startedAt);
                const endMinute = minutesFromStartOfDay(entry.endedAt);
                const blockMinutes = Math.max(0, endMinute - startMinute);
                const isCompact = blockMinutes < COMPACT_THRESHOLD_MINUTES;
                const top = Math.max(0, (startMinute / DAY_MINUTES) * TIMELINE_BODY_HEIGHT);
                const height = Math.max(12, (blockMinutes / DAY_MINUTES) * TIMELINE_BODY_HEIGHT);
                const width = `calc(${100 / timeline.laneCount}% - 8px)`;
                const left = `calc(${(entry.lane * 100) / timeline.laneCount}% + 6px)`;
                const timeRange = `${toMeridiemTime(entry.startedAt)}~${toMeridiemTime(entry.endedAt)}`;
                const blockLabel = `${entry.task}、${timeRange}`;

                return (
                  <article
                    key={entry.id}
                    className={`time-block ${isCompact ? 'compact' : ''}`}
                    style={{ top: `${top}px`, height: `${height}px`, width, left }}
                    title={blockLabel}
                    aria-label={blockLabel}
                  >
                    <strong>{blockLabel}</strong>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <section className="history-shell" aria-label="完了タスク履歴">
          <header className="history-head">
            <h2>完了タスク履歴</h2>
            <span>新しい完了タスクは一番下に追加されます</span>
          </header>
          {logs.length === 0 && <p className="empty">完了履歴はまだありません。</p>}
          {logs.length > 0 && (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th scope="col" className="history-col-task">タスク</th>
                    <th scope="col" className="history-col-start">開始時間</th>
                    <th scope="col" className="history-col-end">終了時間</th>
                    <th scope="col" className="history-col-duration">作業時間</th>
                    <th scope="col" className="history-col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isEditing = editingLogId === log.id;
                    return (
                      <tr key={log.id}>
                        <td className="history-col-task">
                          {isEditing ? (
                            <input
                              aria-label={`タスク名編集-${log.id}`}
                              value={editTask}
                              onChange={(event) => setEditTask(event.target.value)}
                            />
                          ) : (
                            log.task
                          )}
                        </td>
                        <td className="history-col-start">
                          {isEditing ? (
                            <input
                              type="datetime-local"
                              aria-label={`開始時間編集-${log.id}`}
                              value={editStartedAtInput}
                              onChange={(event) => onEditStartedAtChange(event.target.value)}
                            />
                          ) : (
                            toDateTime(log.startedAt)
                          )}
                        </td>
                        <td className="history-col-end">
                          {isEditing ? (
                            <input
                              type="datetime-local"
                              aria-label={`終了時間編集-${log.id}`}
                              value={editEndedAtInput}
                              onChange={(event) => onEditEndedAtChange(event.target.value)}
                            />
                          ) : (
                            toDateTime(log.endedAt)
                          )}
                        </td>
                        <td className="history-col-duration">
                          {isEditing ? (
                            <input
                              type="number"
                              min={1}
                              max={1440}
                              aria-label={`作業時間編集-${log.id}`}
                              value={editDurationMinutes}
                              onChange={(event) => onEditDurationChange(Number(event.target.value))}
                            />
                          ) : (
                            `${calcDurationMinutes(log.startedAt, log.endedAt)}分`
                          )}
                        </td>
                        <td className="history-col-actions">
                          <div className="history-actions">
                            {isEditing ? (
                              <>
                                <button type="button" onClick={onSaveLog}>
                                  保存
                                </button>
                                <button type="button" className="secondary" onClick={onCancelEditingLog}>
                                  キャンセル
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => onStartEditingLog(log)}>
                                  編集
                                </button>
                                <button type="button" className="secondary" onClick={() => onDeleteLog(log.id)}>
                                  削除
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
