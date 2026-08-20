import { rideDispatchService } from './rideDispatch';

export type DailyEarnings = { date: Date; earnings: number; tripCount: number };
export type CaptainEarningsOverview = { daily: DailyEarnings[]; rideEarnings: number; tips: number | null; bonuses: number | null; adjustments: number | null; totalEarnings: number; rideMinutes: number; onlineMinutes: null; tripCount: number };
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function nextMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 1); }
const fare = (value: number | null | undefined) => Number(value ?? 0);

export const captainEarningsService = {
  async getMonth(reference = new Date()): Promise<CaptainEarningsOverview> {
    const start = startOfMonth(reference);
    const end = nextMonth(reference);
    const daily = Array.from({ length: new Date(end.getTime() - 1).getDate() }, (_, index) => ({ date: new Date(start.getFullYear(), start.getMonth(), index + 1), earnings: 0, tripCount: 0 }));
    const byDay = new Map(daily.map((item) => [item.date.getDate(), item]));
    let rideEarnings = 0; let rideMinutes = 0; let tripCount = 0;
    const rides = await rideDispatchService.getCaptainRideHistory(undefined, 50);
    for (const ride of rides) {
      if (ride.status !== 'completed' || !ride.completed_at) continue;
      const completedAt = new Date(ride.completed_at);
      if (completedAt < start || completedAt >= end) continue;
      const day = byDay.get(completedAt.getDate());
      const amount = fare(ride.final_fare ?? ride.estimated_fare);
      if (day) { day.earnings += amount; day.tripCount += 1; }
      rideEarnings += amount; tripCount += 1;
      if (ride.started_at) rideMinutes += Math.max(0, Math.round((completedAt.getTime() - new Date(ride.started_at).getTime()) / 60_000));
    }
    return { daily, rideEarnings, tips: null, bonuses: null, adjustments: null, totalEarnings: rideEarnings, rideMinutes, onlineMinutes: null, tripCount };
  },
  async getToday(reference = new Date()) { const overview = await this.getMonth(reference); const day = overview.daily.find((item) => item.date.toDateString() === reference.toDateString()); return { ...overview, daily: day ? [day] : [], rideEarnings: day?.earnings ?? 0, totalEarnings: day?.earnings ?? 0, tripCount: day?.tripCount ?? 0 }; },
};
export function formatDuration(minutes: number | null) { if (minutes == null) return '—'; return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
