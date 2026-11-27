import { supabase } from '../lib/supabase';

export type DailyEarnings = { date: Date; earnings: number; tripCount: number; bonuses: number };
export type CaptainEarningsOverview = { daily: DailyEarnings[]; rideEarnings: number; heldEarnings: number; tips: number | null; bonuses: number | null; adjustments: number | null; totalEarnings: number; rideMinutes: number; onlineMinutes: null; tripCount: number };
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function nextMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth() + 1, 1); }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
const fare = (value: unknown) => Number(value ?? 0);

export const captainEarningsService = {
  async getDailyAnalytics(reference = new Date()) {
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const monthStart = `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}-01`;
    const { data, error } = await supabase.rpc('captain_daily_analytics', { p_month_start: monthStart });
    if (error) throw error;
    const key = localDateKey(reference);
    return ((data ?? []) as Array<{ day: string; completed_rides: number; total_earnings: number; ride_km: number; pickup_km: number; last_ride_earnings: number | null; last_ride_km: number | null }>).find((row) => row.day === key) ?? null;
  },
  async getMonth(reference = new Date()): Promise<CaptainEarningsOverview> {
    const start = startOfMonth(reference);
    const end = nextMonth(reference);
    const daily = Array.from({ length: new Date(end.getTime() - 1).getDate() }, (_, index) => ({ date: new Date(start.getFullYear(), start.getMonth(), index + 1), earnings: 0, tripCount: 0, bonuses: 0 }));
    const byDay = new Map(daily.map((item) => [item.date.getDate(), item]));
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const [ridesResult, bonusesResult] = await Promise.all([
      supabase.rpc('captain_compensation_monthly', { p_month_start: localDateKey(start) }),
      supabase.rpc('captain_wallet_bonus_daily', { p_month_start: localDateKey(start) }),
    ]);
    if (ridesResult.error) throw ridesResult.error;
    if (bonusesResult.error) throw bonusesResult.error;
    const data = ridesResult.data;
    let rideEarnings = 0; let heldEarnings = 0; let tripCount = 0;
    for (const row of data ?? []) {
      const date = new Date(`${row.day}T00:00:00`);
      const day = byDay.get(date.getDate());
      const amount = fare(row.net_earnings ?? row.ride_earnings);
      const count = Number(row.ride_count ?? 0);
      if (day) { day.earnings = amount; day.tripCount = count; }
      rideEarnings += fare(row.ride_earnings); heldEarnings += fare(row.held_earnings); tripCount += count;
    }
    let bonuses = 0;
    for (const row of bonusesResult.data ?? []) {
      const date = new Date(`${row.day}T00:00:00`);
      const day = byDay.get(date.getDate());
      const amount = fare(row.bonus_amount);
      if (day) { day.bonuses += amount; day.earnings += amount; }
      bonuses += amount;
    }
    const adjustments = ((data ?? []) as Array<{ dispute_deductions?: unknown }>).reduce((total: number, row) => total + fare(row.dispute_deductions), 0);
    return { daily, rideEarnings, heldEarnings, tips: null, bonuses, adjustments, totalEarnings: rideEarnings - adjustments + bonuses, rideMinutes: 0, onlineMinutes: null, tripCount };
  },
  async getToday(reference = new Date()) { const overview = await this.getMonth(reference); const day = overview.daily.find((item) => localDateKey(item.date) === localDateKey(reference)); return { ...overview, daily: day ? [day] : [], rideEarnings: (day?.earnings ?? 0) - (day?.bonuses ?? 0), bonuses: day?.bonuses ?? 0, totalEarnings: day?.earnings ?? 0, tripCount: day?.tripCount ?? 0 }; },
};
export function formatDuration(minutes: number | null) { if (minutes == null) return '—'; return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
