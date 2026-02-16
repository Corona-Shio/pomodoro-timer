import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  assignLanes,
  calcMinuteHandAngle,
  clampMinutes,
  formatRemaining,
  minutesFromStartOfDay,
  toDateKey,
  toLocalTime
} from './lib/timer';
import { loadLogs, loadSetMinutes, saveLogs, saveSetMinutes } from './lib/storage';
import type { TimeLog, TimerStatus } from './lib/types';

const DAY_MINUTES = 24 * 60;
const PIXELS_PER_MINUTE = 0.8;
const TIMELINE_HEIGHT = DAY_MINUTES * PIXELS_PER_MINUTE;

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

function App() {
  const initialSetMinutes = useMemo(() => loadSetMinutes(), []);
  const [setMinutes, setSetMinutes] = useState(initialSetMinutes);
  const [remainingSeconds, setRemainingSeconds] = useState(initialSetMinutes * 60);
  const [status, setStatus] = useState<TimerStatus>('idle');
  const [taskInput, setTaskInput] = useState('');
  const [logs, setLogs] = useState<TimeLog[]>(() => loadLogs());
  const [clock, setClock] = useState(nowClock());
  const [isCompleteFlash, setIsCompleteFlash] = useState(false);
  const sessionRef = useRef<SessionMeta | null>(null);

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

    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    saveSetMinutes(setMinutes);
  }, [setMinutes]);

  useEffect(() => {
    saveLogs(logs);
  }, [logs]);

  useEffect(() => {
    if (status === 'running' && remainingSeconds === 0) {
      const session = sessionRef.current;
      if (session) {
        const endedAt = new Date();
        const actualSeconds = Math.max(
          1,
          Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
        );

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
        sessionRef.current = null;
      }
      setStatus('done');
      setIsCompleteFlash(true);
    }
  }, [remainingSeconds, status]);

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

  const onStart = (): void => {
    if (status === 'running' || setMinutes <= 0) {
      return;
    }

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
      setIsCompleteFlash(false);
    }

    setStatus('running');
  };

  const onPause = (): void => {
    if (status === 'running') {
      setStatus('paused');
    }
  };

  const onResume = (): void => {
    if (status === 'paused') {
      setStatus('running');
    }
  };

  const onReset = (): void => {
    sessionRef.current = null;
    setStatus('idle');
    setIsCompleteFlash(false);
    setRemainingSeconds(setMinutes * 60);
  };

  return (
    <main className="app-shell">
      <section className="timer-card">
        <header className="timer-head">
          <div>
            <h1>Analog Pomodoro</h1>
            <p>タイムボクシング用ワークタイマー</p>
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
                  style={{ transform: `translateX(-50%) rotate(${idx * 6}deg)` }}
                />
              ))}
            </div>
            <div className="red-mask" style={{ '--red-angle': `${redSectorAngle}deg` } as CSSProperties} />
            <div className="hand" style={{ transform: `translate(-50%, 0) rotate(${handAngle}deg)` }} />
            <div className="center-dot" />
            <div className="digital">
              <span>{formatRemaining(remainingSeconds)}</span>
              <small>
                {status === 'done' ? '完了' : status === 'paused' ? '一時停止' : status === 'running' ? '計測中' : '待機中'}
              </small>
            </div>
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

      <section className="timeline-card" aria-label="本日のタイムボクシング">
        <header className="timeline-head">
          <h2>今日のタイムボクシング</h2>
          <span>{todayKey}</span>
        </header>

        {timeline.logs.length === 0 ? (
          <p className="empty">記録がまだありません。1セッション完了するとここに表示されます。</p>
        ) : (
          <div className="timeline-shell">
            <div className="timeline-axis" style={{ height: `${TIMELINE_HEIGHT}px` }}>
              {Array.from({ length: 25 }).map((_, hour) => (
                <div
                  className="hour-line"
                  key={hour}
                  style={{ top: `${(hour / 24) * 100}%` }}
                >
                  <span>{`${hour.toString().padStart(2, '0')}:00`}</span>
                </div>
              ))}

              {timeline.logs.map((entry) => {
                const startMinute = minutesFromStartOfDay(entry.startedAt);
                const endMinute = minutesFromStartOfDay(entry.endedAt);
                const top = Math.max(0, (startMinute / DAY_MINUTES) * TIMELINE_HEIGHT);
                const height = Math.max(12, ((endMinute - startMinute) / DAY_MINUTES) * TIMELINE_HEIGHT);
                const width = `calc(${100 / timeline.laneCount}% - 8px)`;
                const left = `calc(${(entry.lane * 100) / timeline.laneCount}% + 6px)`;
                const actualMin = Math.round(entry.actualSeconds / 60);

                return (
                  <article
                    key={entry.id}
                    className="time-block"
                    style={{ top: `${top}px`, height: `${height}px`, width, left }}
                  >
                    <strong>{entry.task}</strong>
                    <small>{`${toLocalTime(entry.startedAt)} - ${toLocalTime(entry.endedAt)}`}</small>
                    <small>{`計画 ${entry.plannedMinutes}分 / 実績 ${actualMin}分`}</small>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
