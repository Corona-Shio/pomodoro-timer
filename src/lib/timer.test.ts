import { assignLanes, calcHourCapRatio, calcMinuteHandAngle, calcRedRatio, clampMinutes } from './timer';
import type { TimeLog } from './types';
import { describe, expect, it } from 'vitest';

describe('timer helpers', () => {
  it('clamps minutes into allowed range', () => {
    expect(clampMinutes(-5)).toBe(1);
    expect(clampMinutes(999)).toBe(180);
    expect(clampMinutes(24.2)).toBe(24);
  });

  it('calculates red ratio in [0,1]', () => {
    expect(calcRedRatio(30, 60)).toBe(0.5);
    expect(calcRedRatio(90, 60)).toBe(1);
    expect(calcRedRatio(-1, 60)).toBe(0);
    expect(calcRedRatio(10, 0)).toBe(0);
  });

  it('caps red fill ratio to one hour', () => {
    expect(calcHourCapRatio(60 * 60)).toBe(1);
    expect(calcHourCapRatio(75 * 60)).toBe(1);
    expect(calcHourCapRatio(15 * 60)).toBe(0.25);
    expect(calcHourCapRatio(0)).toBe(0);
  });

  it('maps minute hand angle on a 60-minute dial', () => {
    expect(calcMinuteHandAngle(15 * 60)).toBe(90);
    expect(calcMinuteHandAngle(30 * 60)).toBe(180);
    expect(calcMinuteHandAngle(60 * 60)).toBe(360);
    expect(calcMinuteHandAngle(75 * 60)).toBe(90);
    expect(calcMinuteHandAngle(0)).toBe(0);
  });

  it('assigns different lanes for overlap', () => {
    const logs: TimeLog[] = [
      {
        id: 'a',
        task: 'A',
        plannedMinutes: 25,
        actualSeconds: 1500,
        startedAt: '2026-02-15T09:00:00.000Z',
        endedAt: '2026-02-15T09:30:00.000Z',
        dateKey: '2026-02-15'
      },
      {
        id: 'b',
        task: 'B',
        plannedMinutes: 20,
        actualSeconds: 1200,
        startedAt: '2026-02-15T09:10:00.000Z',
        endedAt: '2026-02-15T09:20:00.000Z',
        dateKey: '2026-02-15'
      }
    ];

    const result = assignLanes(logs);
    expect(result.laneCount).toBe(2);
    expect(result.logs[0].lane).not.toBe(result.logs[1].lane);
  });
});
