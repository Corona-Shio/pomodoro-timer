import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  assignLanes,
  calcMinuteHandAngle,
  clampMinutes,
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
  const dialNumbers = useMemo(() => Array.from({ length: 12 }, (_, idx) => (idx === 0 ? 60 : idx * 5)), []);
  const initialSetMinutes = useMemo(() => loadSetMinutes(), []);
  const initialSoundVolume = useMemo(() => loadSoundVolume(), []);
  const initialSoundType = useMemo(() => loadSoundType(), []);
  const [setMinutes, setSetMinutes] = useState(initialSetMinutes);
  const [soundVolume, setSoundVolume] = useState(initialSoundVolume);
  const [soundType, setSoundType] = useState<CompletionSound>(initialSoundType);
  const [remainingSeconds, setRemainingSeconds] = useState(initialSetMinutes * 60);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [taskInput, setTaskInput] = useState('');
  const [logs, setLogs] = useState<TimeLog[]>(() => loadLogs());
  const [clock, setClock] = useState(nowClock());
  const [isCompleteFlash, setIsCompleteFlash] = useState(false);
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
    if (status === 'running' && remainingSeconds === 0) {
      const session = sessionRef.current;
      if (session) {
        const endedAtMs = deadlineRef.current ?? Date.now();
        const endedAt = new Date(endedAtMs);
        const actualSeconds = Math.max(1, session.plannedMinutes * 60);

        const newLog: TimeLog = {
          id: crypto.randomUUID(),
          task: session.task,
          plannedMinutes: session.plannedMinutes,
          actualSeconds,
          startedAt: session.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          dateKey: toDateKey(session.startedAt)
        };

        setLogs((prev) => [newLog, ...prev]);
        notifyCompletion(session.task, session.plannedMinutes);
        playCompletionSound(soundType, soundVolume, FIXED_SOUND_REPEAT_COUNT);
        sessionRef.current = null;
        deadlineRef.current = null;
      }
      setStatus('done');
      setIsCompleteFlash(true);
    }
  }, [remainingSeconds, soundType, soundVolume, status]);

  const canEditSetting = status === 'idle' || status === 'done';
  const handAngle = calcMinuteHandAngle(remainingSeconds);
  const redSectorAngle = remainingSeconds > 60 * 60 ? 360 : handAngle;
  const todayKey = toDateKey(new Date());
  const todaysLogs = useMemo(() => logs.filter((entry) => entry.dateKey === todayKey), [logs, todayKey]);
  const timeline = useMemo(() => assignLanes(todaysLogs), [todaysLogs]);

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
    if (status === 'running' || setMinutes <= 0) {
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
      setIsCompleteFlash(false);
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
    setStatus('idle');
    setIsCompleteFlash(false);
    setRemainingSeconds(setMinutes * 60);
  };

  return (
    <main className="app-shell">
      <section className="timer-card">
        <header className="timer-head">
          <div>
            <h1>Pomodoro Timer</h1>
            <p>ポモドーロタイマー</p>
          </div>
          <strong className="clock-pill" aria-label="現在時刻">
            {clock}
          </strong>
        </header>

        <div className={`dial-wrap ${status === 'done' && isCompleteFlash ? 'done' : ''}`}>
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
            <h2>セッション</h2>
            <label htmlFor="task-input">作業内容</label>
            <input
              id="task-input"
              type="text"
              placeholder="例: 企画書の下書き"
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
            />
            <div className="action-buttons">
              {(status === 'idle' || status === 'done') && (
                <button type="button" onClick={onStart} disabled={setMinutes <= 0} aria-label="タイマー開始">
                  開始
                </button>
              )}
              {status === 'running' && (
                <button type="button" onClick={onPause} aria-label="一時停止">
                  一時停止
                </button>
              )}
              {status === 'paused' && (
                <button type="button" onClick={onResume} aria-label="再開">
                  再開
                </button>
              )}
              <button type="button" onClick={onReset} className="secondary" aria-label="リセット">
                リセット
              </button>
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
                const actualMin = Math.round(entry.actualSeconds / 60);
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
                    {!isCompact && <small>{`計画 ${entry.plannedMinutes}分 / 実績 ${actualMin}分`}</small>}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
