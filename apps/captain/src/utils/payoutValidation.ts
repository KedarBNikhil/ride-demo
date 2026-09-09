export type PayoutField = 'accountNumber' | 'confirmAccountNumber' | 'ifsc' | 'accountHolder' | 'upiId';
export function normalizeAccountNumber(value: string) { return value.replace(/\s+/g, ''); }
export function normalizeIfsc(value: string) { return value.replace(/\s+/g, '').toUpperCase(); }
export function normalizeAccountHolder(value: string) { return value.replace(/\s+/g, ' ').trim(); }
export function normalizeUpi(value: string) { return value.trim(); }
export function payoutFieldError(field: PayoutField, raw: string, accountNumber = ''): string | null {
  const value = field === 'accountNumber' || field === 'confirmAccountNumber' ? normalizeAccountNumber(raw) : field === 'ifsc' ? normalizeIfsc(raw) : field === 'accountHolder' ? normalizeAccountHolder(raw) : normalizeUpi(raw);
  if (field === 'accountNumber' && !/^\d{9,18}$/.test(value)) return 'Use 9–18 digits.';
  if (field === 'confirmAccountNumber' && (!/^\d{9,18}$/.test(value) || value !== normalizeAccountNumber(accountNumber))) return 'Account numbers do not match.';
  if (field === 'ifsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(value)) return 'Use an 11-character IFSC (for example, SBIN0001234).';
  if (field === 'accountHolder' && !/^[A-Za-z][A-Za-z .'-]*$/.test(value)) return 'Use letters, spaces, ., ’ or - only.';
  if (field === 'upiId' && !/^[^@\s]+@[^@\s]+$/.test(value)) return 'Enter a valid UPI ID such as name@handle.';
  return null;
}
export function payoutIsValid(method: 'bank' | 'upi', payout: { accountNumber?: string; confirmAccountNumber?: string; ifsc?: string; accountHolder?: string; upiId?: string }) {
  if (method === 'upi') return payoutFieldError('upiId', payout.upiId ?? '') === null;
  return (['accountNumber', 'confirmAccountNumber', 'ifsc', 'accountHolder'] as const).every((field) => payoutFieldError(field, payout[field] ?? '', payout.accountNumber ?? '') === null);
}
