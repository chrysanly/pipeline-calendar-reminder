// Phone number → country (and city, for UAE and Saudi landlines). Pure.
// Numbers without a country code are read as `defaultCountry` (UAE).

/** Calling code → [ISO code, country name]. Longest matching prefix wins. */
export const CALLING_CODES = {
  971: ['AE', 'United Arab Emirates'],
  966: ['SA', 'Saudi Arabia'],
  974: ['QA', 'Qatar'],
  973: ['BH', 'Bahrain'],
  968: ['OM', 'Oman'],
  965: ['KW', 'Kuwait'],
  964: ['IQ', 'Iraq'],
  963: ['SY', 'Syria'],
  967: ['YE', 'Yemen'],
  962: ['JO', 'Jordan'],
  961: ['LB', 'Lebanon'],
  98: ['IR', 'Iran'],
  90: ['TR', 'Turkey'],
  20: ['EG', 'Egypt'],
  212: ['MA', 'Morocco'],
  213: ['DZ', 'Algeria'],
  216: ['TN', 'Tunisia'],
  249: ['SD', 'Sudan'],
  251: ['ET', 'Ethiopia'],
  254: ['KE', 'Kenya'],
  234: ['NG', 'Nigeria'],
  27: ['ZA', 'South Africa'],
  91: ['IN', 'India'],
  92: ['PK', 'Pakistan'],
  880: ['BD', 'Bangladesh'],
  94: ['LK', 'Sri Lanka'],
  977: ['NP', 'Nepal'],
  63: ['PH', 'Philippines'],
  60: ['MY', 'Malaysia'],
  65: ['SG', 'Singapore'],
  62: ['ID', 'Indonesia'],
  86: ['CN', 'China'],
  81: ['JP', 'Japan'],
  82: ['KR', 'South Korea'],
  61: ['AU', 'Australia'],
  44: ['GB', 'United Kingdom'],
  33: ['FR', 'France'],
  49: ['DE', 'Germany'],
  39: ['IT', 'Italy'],
  34: ['ES', 'Spain'],
  31: ['NL', 'Netherlands'],
  41: ['CH', 'Switzerland'],
  7: ['RU', 'Russia'],
  1: ['US', 'United States']
};

/** Country names for the form's country picker, A–Z. */
export const COUNTRY_NAMES = [...new Set(Object.values(CALLING_CODES).map(([, name]) => name))].sort();

const ISO_TO_CODE = Object.fromEntries(Object.entries(CALLING_CODES).map(([code, [iso]]) => [iso, code]));

// Landline area codes (the digits after the country code / trunk 0).
const AREA_CODES = {
  AE: { 2: 'Abu Dhabi', 3: 'Al Ain', 4: 'Dubai', 6: 'Sharjah / Ajman / Umm Al Quwain', 7: 'Ras Al Khaimah', 9: 'Fujairah' },
  SA: { 11: 'Riyadh', 12: 'Jeddah / Makkah', 13: 'Dammam / Khobar', 14: 'Madinah', 16: 'Qassim', 17: 'Abha' }
};

// National number lengths (without trunk 0): [mobile prefix, mobile length, landline length].
const NATIONAL = {
  AE: { mobile: '5', mobileLength: 9, landlineLength: 8 },
  SA: { mobile: '5', mobileLength: 9, landlineLength: 9 }
};

/** The calling code `digits` starts with, longest first; null if none. */
export function matchCallingCode(digits, codes = CALLING_CODES) {
  const keys = Object.keys(codes).sort((a, b) => b.length - a.length);
  const code = keys.find(k => digits.startsWith(k));
  return code ? { code, iso: codes[code][0], country: codes[code][1] } : null;
}

/** City for a national number in countries we know area codes for. */
function cityFor(iso, national) {
  const rules = NATIONAL[iso];
  const areas = AREA_CODES[iso];
  if (!rules || !areas) return '';
  if (national.startsWith(rules.mobile)) return ''; // mobiles carry no city
  if (national.length !== rules.landlineLength) return '';
  const area = Object.keys(areas).sort((a, b) => b.length - a.length).find(a => national.startsWith(a));
  return area ? areas[area] : '';
}

/** Plausible length for a national number of `iso` (unknown countries: 6–12). */
function plausibleNational(iso, national) {
  const rules = NATIONAL[iso];
  if (!rules) return national.length >= 6 && national.length <= 12;
  if (national.startsWith(rules.mobile)) return national.length === rules.mobileLength;
  if (national.startsWith('800')) return national.length >= 6 && national.length <= 10; // toll-free
  return national.length === rules.landlineLength;
}

function phoneResult(iso, country, national) {
  return { country, city: cityFor(iso, national), countryCode: iso, callingCode: `+${ISO_TO_CODE[iso]}` };
}

/**
 * Country and city from a phone number, or null if it isn't one.
 * "+971 4 123 4567" → {country: 'United Arab Emirates', city: 'Dubai', countryCode: 'AE'}
 * "0501234567" → UAE, no city. "00966 11 234 5678" → Saudi Arabia, Riyadh.
 */
export function locationFromPhone(raw, defaultCountry = 'AE') {
  if (raw === null || raw === undefined) return null;
  const input = String(raw).trim();
  if (!input) return null;
  // Only digits, spaces, + - . ( ); anything else (letters, "/") is not a phone.
  if (!/^\+?[\d\s().-]+$/.test(input)) return null;
  // Dates: 2026-09-27, 27-09-2026, 27.09.26
  if (/^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/.test(input) || /^\d{1,2}[-.]\d{1,2}[-.]\d{2,4}$/.test(input)) return null;

  let digits = input.replace(/[^\d]/g, '');
  let international = input.startsWith('+');
  if (!international && digits.startsWith('00')) {
    international = true;
    digits = digits.slice(2);
  }
  if (digits.length < 7 || digits.length > 15) return null;

  if (international) {
    const match = matchCallingCode(digits);
    if (!match) return null;
    const national = digits.slice(match.code.length);
    return plausibleNational(match.iso, national) ? phoneResult(match.iso, match.country, national) : null;
  }

  const [iso, country] = Object.values(CALLING_CODES).find(([code]) => code === defaultCountry) || [];
  if (!iso) return null;

  // Trunk 0: "04 123 4567", "050 123 4567".
  if (digits.startsWith('0')) {
    const national = digits.slice(1);
    return plausibleNational(iso, national) ? phoneResult(iso, country, national) : null;
  }
  // A national number that lost its 0 (Excel stores 0501234567 as 501234567).
  if (plausibleNational(iso, digits)) return phoneResult(iso, country, digits);
  // Country code without + or 00, as Excel exports often have: 971501234567.
  const match = matchCallingCode(digits);
  if (match && digits.length >= 10) {
    const national = digits.slice(match.code.length);
    if (plausibleNational(match.iso, national)) return phoneResult(match.iso, match.country, national);
  }
  return null;
}
