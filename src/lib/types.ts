export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';
export type CompletionSound = 'chime' | 'bell' | 'beep' | 'silent';

export type TimeLog = {
  id: string;
  task: string;
  plannedMinutes: number;
  actualSeconds: number;
  startedAt: string;
  endedAt: string;
  dateKey: string;
};

export type LaneLog = TimeLog & {
  lane: number;
};
