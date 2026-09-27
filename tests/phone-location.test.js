import { test, assertEqual, assertDeepEqual } from './runner.js';
import { locationFromPhone, matchCallingCode, COUNTRY_NAMES } from '../js/phone-location.js';

const place = raw => {
  const r = locationFromPhone(raw);
  return r && [r.country, r.city];
};

test('UAE landlines give the city from the area code', () => {
  assertDeepEqual(place('+971 4 123 4567'), ['United Arab Emirates', 'Dubai']);
  assertDeepEqual(place('02 123 4567'), ['United Arab Emirates', 'Abu Dhabi']);
  assertDeepEqual(place('03-765-4321'), ['United Arab Emirates', 'Al Ain']);
  assertDeepEqual(place('(06) 555 1234'), ['United Arab Emirates', 'Sharjah / Ajman / Umm Al Quwain']);
  assertDeepEqual(place('009717 222 3333'), ['United Arab Emirates', 'Ras Al Khaimah']);
  assertDeepEqual(place('+971 9 222 3333'), ['United Arab Emirates', 'Fujairah']);
});

test('UAE mobiles give the country but no city (formats seen in real exports)', () => {
  assertDeepEqual(place('0501234567'), ['United Arab Emirates', '']);
  assertDeepEqual(place('+971 50 1234567'), ['United Arab Emirates', '']);
  assertDeepEqual(place('501234567'), ['United Arab Emirates', ''], 'Excel number cell that lost its 0');
  assertDeepEqual(place(501234567), ['United Arab Emirates', ''], 'a numeric cell');
  assertDeepEqual(place('971501234567'), ['United Arab Emirates', ''], 'country code without +');
});

test('00 works like + and Saudi area codes give the city', () => {
  assertDeepEqual(place('00966 11 234 5678'), ['Saudi Arabia', 'Riyadh']);
  assertDeepEqual(place('+966 12 345 6789'), ['Saudi Arabia', 'Jeddah / Makkah']);
  assertDeepEqual(place('+966 13 345 6789'), ['Saudi Arabia', 'Dammam / Khobar']);
  assertDeepEqual(place('+966 55 123 4567'), ['Saudi Arabia', '']);
});

test('other countries give the country only', () => {
  assertDeepEqual(place('+44 20 7946 0958'), ['United Kingdom', '']);
  assertDeepEqual(place('+1 212 555 0100'), ['United States', '']);
  assertDeepEqual(place('+91 98765 43210'), ['India', '']);
  assertDeepEqual(place('+63 917 123 4567'), ['Philippines', '']);
  assertDeepEqual(place('+880 1712 345678'), ['Bangladesh', '']);
  assertDeepEqual(place('+974 5512 3456'), ['Qatar', '']);
});

test('the result also carries the ISO and calling code', () => {
  const r = locationFromPhone('+971 4 123 4567');
  assertEqual(r.countryCode, 'AE');
  assertEqual(r.callingCode, '+971');
});

test('longest calling-code prefix wins', () => {
  const codes = { 1: ['A', 'Short'], 12: ['B', 'Longer'], 123: ['C', 'Longest'] };
  assertEqual(matchCallingCode('1239999', codes).country, 'Longest');
  assertEqual(matchCallingCode('1299999', codes).country, 'Longer');
  assertEqual(matchCallingCode('1999999', codes).country, 'Short');
  assertEqual(matchCallingCode('9999999', codes), null);
  // Real table: +971 is the UAE, never +97x or +9x.
  assertEqual(matchCallingCode('971501234567').country, 'United Arab Emirates');
  assertEqual(matchCallingCode('212612345678').country, 'Morocco');
  assertEqual(matchCallingCode('201001234567').country, 'Egypt');
});

test('junk, dates and short numbers are not phones', () => {
  for (const raw of [null, undefined, '', '   ', 'call me', 'someone@example.com', 'https://example.com',
    '12/03/2026', '2026-09-27', '27-09-2026', '27.09.26', '12345', '+999 123 4567', '04 123', '050 123 45']) {
    assertEqual(locationFromPhone(raw), null, `${JSON.stringify(raw)} should be null`);
  }
});

test('COUNTRY_NAMES is a sorted, de-duplicated list', () => {
  assertEqual(COUNTRY_NAMES.includes('United Arab Emirates'), true);
  assertDeepEqual(COUNTRY_NAMES.slice().sort(), COUNTRY_NAMES);
  assertEqual(new Set(COUNTRY_NAMES).size, COUNTRY_NAMES.length);
});
