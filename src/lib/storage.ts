import { clampMinutes } from './timer';
import type { TimeLog } from './types';

const LOG_KEY = 'pomodoro.logs.v1';
const SETTINGS_KEY = 'pomodoro.settings.v1';

export const storageKeys = {
  logs: LOG_KEY,
  settings: SETTINGS_KEY
};

export const loadLogs = (): TimeLog[] => {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as TimeLog[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry) =>
        typeof entry.id === 'string' &&
        typeof entry.task === 'string' &&
        typeof entry.plannedMinutes === 'number' &&
        typeof entry.actualSeconds === 'number' &&
        typeof entry.startedAt === 'string' &&
        typeof entry.endedAt === 'string' &&
        typeof entry.dateKey === 'string'
    );
  } catch {
    return [];
  }
};

export const saveLogs = (logs: TimeLog[]): void => {
  localStorage.setItem(LOG_KEY, JSON.stringify(logs));
};

export const loadSetMinutes = (): number => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return 25;
    }
    const parsed = JSON.parse(raw) as { setMinutes?: number };
    return clampMinutes(parsed.setMinutes ?? 25);
  } catch {
    return 25;
  }
};

export const saveSetMinutes = (setMinutes: number): void => {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      setMinutes: clampMinutes(setMinutes)
    })
  );
};
