// Mapping of ISO 3166-1 alpha-2 country codes to country names
// (Partial list, add more as needed)
export const countryCodeToName: Record<string, string> = {
  'US': 'United States',
  'CA': 'Canada',
  'GB': 'United Kingdom',
  'FR': 'France',
  'DE': 'Germany',
  'IT': 'Italy',
  'ES': 'Spain',
  'RU': 'Russia',
  'CN': 'China',
  'JP': 'Japan',
  'IN': 'India',
  'AU': 'Australia',
  'BR': 'Brazil',
  'ZA': 'South Africa',
  // ... add more as needed
};

// Render an ISO 3166-1 alpha-2 country code as a flag emoji using the
// Unicode regional-indicator-symbol trick. Returns an empty string for
// anything that isn't a two-letter code so callers can render a fallback.
export const countryCodeToFlag = (countryCode: string | null | undefined): string => {
  if (!countryCode || countryCode.length !== 2) return ''
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(ch => 127397 + ch.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}
