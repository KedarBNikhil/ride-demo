import { supabase } from '../lib/supabase';

export type DailyEarnings = { date: Date; earnings: number };

export type CaptainEarningsOverview = {
  daily: DailyEarnings[];
  rideEarnings: number;
  tips: number;
  bonuses: number;
  totalEarnings: number;
  rideMinutes: number;
  /** Online availability is currently a current-state record, not a session log. */
  onlineMinutes: null;
  tripCount: number;
};

type CompletedRideRow = {
  completed_at: string;
  started_at: string | null;
  final_fare: number | string | null;
  estimated_fare: number | string;
};

const requireClient = () => {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
};

const amount = (value: number | string | null | undefined) => Number(value ?? 0);

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function isSameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

async function completedRidesOverlapping(start: Date, end: Date): Promise<CompletedRideRow[]> {
  const client = requireClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) throw new Error('AUTHENTICATION_REQUIRED');

  // RLS already limits this to the current captain's assigned rides. The
  // explicit captain_id predicate also makes the ownership requirement clear
  // at the query boundary and keeps the range query selective.
  const { data, error } = await client
    .from('rides')
    .select('completed_at, started_at, final_fare, estimated_fare')
    .eq('captain_id', session.user.id)
    .eq('status', 'completed')
    .lt('started_at', end.toISOString())
    .gt('completed_at', start.toISOString());
  if (error) throw error;
  return (data ?? []) as CompletedRideRow[];
}

function buildOverview(rows: CompletedRideRow[], start: Date, end: Date, dailyDates: Date[]): CaptainEarningsOverview {
  const earningsByDay = new Map(dailyDates.map((date) => [date.getDate(), 0]));
  let rideEarnings = 0;
  let tripCount = 0;
  let rideMinutes = 0;

  for (const ride of rows) {
    const completedAt = new Date(ride.completed_at);
    if (completedAt >= start && completedAt < end) {
      const key = completedAt.getDate();
      earningsByDay.set(key, (earningsByDay.get(key) ?? 0) + amount(ride.final_fare ?? ride.estimated_fare));
      rideEarnings += amount(ride.final_fare ?? ride.estimated_fare);
      tripCount += 1;
    }

    // A trip that crosses a month boundary contributes only the time actually
    // spent within the selected local period.
    if (ride.started_at) {
      const overlapStart = Math.max(new Date(ride.started_at).getTime(), start.getTime());
      const overlapEnd = Math.min(completedAt.getTime(), end.getTime());
      rideMinutes += Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
    }
  }

  const tips = 0;
  const bonuses = 0;
  return {
    daily: dailyDates.map((date) => ({ date, earnings: earningsByDay.get(date.getDate()) ?? 0 })),
    rideEarnings,
    tips,
    bonuses,
    totalEarnings: rideEarnings + tips + bonuses,
    rideMinutes,
    onlineMinutes: null,
    tripCount,
  };
}

export const captainEarningsService = {
  async getMonth(reference = new Date()): Promise<CaptainEarningsOverview> {
    const start = startOfMonth(reference);
    const end = nextMonth(reference);
    const dailyDates = Array.from(
      { length: new Date(end.getTime() - 1).getDate() },
      (_, index) => new Date(start.getFullYear(), start.getMonth(), index + 1),
    );
    return buildOverview(await completedRidesOverlapping(start, end), start, end, dailyDates);
  },

  async getToday(reference = new Date()): Promise<CaptainEarningsOverview> {
    const start = startOfDay(reference);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return buildOverview(await completedRidesOverlapping(start, end), start, end, [start]);
  },
};

export function formatDuration(totalMinutes: number | null) {
  if (totalMinutes == null) return '—';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function isToday(date: Date) {
  return isSameLocalDay(date, new Date());
}
