import type { TimeLog, LaneLog } from './types';

export const MIN_MINUTES = 0;
export const MAX_MINUTES = 180;

export const clampMinutes = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 25;
  }
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(value)));
};

export const calcRedRatio = (remainingSeconds: number, totalSeconds: number): number => {
  if (totalSeconds <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, remainingSeconds / totalSeconds));
};

export const calcHourCapRatio = (remainingSeconds: number): number => {
  const HOUR_SECONDS = 60 * 60;
  if (remainingSeconds <= 0) {
    return 0;
  }
  return Math.min(1, remainingSeconds / HOUR_SECONDS);
};

export const calcMinuteHandAngle = (remainingSeconds: number): number => {
  const HOUR_SECONDS = 60 * 60;
  if (remainingSeconds <= 0) {
    return 0;
  }
  const normalized = remainingSeconds % HOUR_SECONDS;
  if (normalized === 0) {
    return 360;
  }
  return (normalized / HOUR_SECONDS) * 360;
};

export const formatRemaining = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const secs = (safe % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

export const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const toLocalTime = (iso: string): string => {
  const date = new Date(iso);
  return date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

export const minutesFromStartOfDay = (iso: string): number => {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
};

export const assignLanes = (logs: TimeLog[]): { logs: LaneLog[]; laneCount: number } => {
  const sorted = [...logs].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );

  const laneEndTimes: number[] = [];
  const withLanes: LaneLog[] = sorted.map((log) => {
    const start = new Date(log.startedAt).getTime();
    const end = new Date(log.endedAt).getTime();
    let lane = laneEndTimes.findIndex((laneEnd) => laneEnd <= start);

    if (lane < 0) {
      lane = laneEndTimes.length;
      laneEndTimes.push(end);
    } else {
      laneEndTimes[lane] = end;
    }

    return {
      ...log,
      lane
    };
  });

  return {
    logs: withLanes,
    laneCount: Math.max(1, laneEndTimes.length)
  };
};
