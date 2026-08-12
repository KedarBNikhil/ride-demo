/**
 * Product rule: all ride numbers stay in Western (Latin) digits in every locale.
 * Use this for fares, distances, ETAs, OTPs, and any other customer-facing number.
 */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat('en-IN', { numberingSystem: 'latn', ...options }).format(value);
}

export function formatFare(rupees: number): string {
  return `₹${formatNumber(rupees, { maximumFractionDigits: 0 })}`;
}

export function formatOtp(otp: string | number): string {
  return String(otp).replace(/[\u0660-\u0669\u06F0-\u06F9\u0C66-\u0C6F]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero = code >= 0x0c66 ? 0x0c66 : code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - zero);
  });
}
