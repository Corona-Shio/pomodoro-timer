import { clampMinutes } from './timer';
import type { CompletionSound, TimeLog } from './types';

const LOG_KEY = 'pomodoro.logs.v1';
const SETTINGS_KEY = 'pomodoro.settings.v1';
const DEFAULT_SET_MINUTES = 25;
const DEFAULT_SOUND_VOLUME = 120;
const DEFAULT_SOUND_TYPE: CompletionSound = 'chime';
const DEFAULT_SOUND_REPEAT = 1;

export const storageKeys = {
  logs: LOG_KEY,
  settings: SETTINGS_KEY
};

type PersistedSettings = {
  setMinutes?: number;
  soundVolume?: number;
  soundType?: CompletionSound;
  // legacy field kept only for migration
  soundBoost?: number;
  soundRepeatCount?: number;
};

const clampSoundVolume = (volume: number): number => Math.min(200, Math.max(0, Math.round(volume)));
const clampSoundRepeatCount = (count: number): number => Math.min(5, Math.max(1, Math.round(count)));
const isCompletionSound = (value: unknown): value is CompletionSound =>
  value === 'chime' || value === 'bell' || value === 'beep' || value === 'silent';

const loadSettings = (): PersistedSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PersistedSettings;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const saveSettings = (next: PersistedSettings): void => {
  const current = loadSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...next }));
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
  const parsed = loadSettings();
  return clampMinutes(parsed.setMinutes ?? DEFAULT_SET_MINUTES);
};

export const saveSetMinutes = (setMinutes: number): void => {
  saveSettings({
    setMinutes: clampMinutes(setMinutes)
  });
};

export const loadSoundVolume = (): number => {
  const parsed = loadSettings();
  if (typeof parsed.soundVolume === 'number') {
    const normalized = parsed.soundVolume <= 100
      ? parsed.soundVolume * ((typeof parsed.soundBoost === 'number' ? parsed.soundBoost : 100) / 100)
      : parsed.soundVolume;
    return clampSoundVolume(normalized);
  }
  return DEFAULT_SOUND_VOLUME;
};

export const saveSoundVolume = (soundVolume: number): void => {
  saveSettings({
    soundVolume: clampSoundVolume(soundVolume)
  });
};

export const loadSoundType = (): CompletionSound => {
  const parsed = loadSettings();
  return isCompletionSound(parsed.soundType) ? parsed.soundType : DEFAULT_SOUND_TYPE;
};

export const saveSoundType = (soundType: CompletionSound): void => {
  saveSettings({
    soundType
  });
};

export const loadSoundRepeatCount = (): number => {
  const parsed = loadSettings();
  return clampSoundRepeatCount(parsed.soundRepeatCount ?? DEFAULT_SOUND_REPEAT);
};

export const saveSoundRepeatCount = (soundRepeatCount: number): void => {
  saveSettings({
    soundRepeatCount: clampSoundRepeatCount(soundRepeatCount)
  });
};
