import type { CurrencyCode } from '../shared/currency';

/**
 * Phase 1 markets (PRD section 13.0a): one currency per region, English UI, number format
 * per region. A device region that is not listed here pre-selects nothing.
 */
export interface Region {
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** BCP-47 locale used for number formatting. */
  readonly locale: string;
}

export const REGIONS: readonly Region[] = [
  { code: 'IN', name: 'India', currency: 'INR', locale: 'en-IN' },
  { code: 'US', name: 'United States', currency: 'USD', locale: 'en-US' },
  { code: 'CA', name: 'Canada', currency: 'CAD', locale: 'en-CA' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', locale: 'en-IE' },
  { code: 'DE', name: 'Germany', currency: 'EUR', locale: 'de-DE' },
  { code: 'FR', name: 'France', currency: 'EUR', locale: 'fr-FR' },
  { code: 'ES', name: 'Spain', currency: 'EUR', locale: 'es-ES' },
  { code: 'IT', name: 'Italy', currency: 'EUR', locale: 'it-IT' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', locale: 'nl-NL' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', locale: 'nl-BE' },
  { code: 'AT', name: 'Austria', currency: 'EUR', locale: 'de-AT' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', locale: 'pt-PT' },
  { code: 'FI', name: 'Finland', currency: 'EUR', locale: 'fi-FI' },
  { code: 'GR', name: 'Greece', currency: 'EUR', locale: 'el-GR' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', locale: 'de-CH' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', locale: 'sv-SE' },
  { code: 'NO', name: 'Norway', currency: 'NOK', locale: 'nb-NO' },
  { code: 'DK', name: 'Denmark', currency: 'DKK', locale: 'da-DK' },
  { code: 'PL', name: 'Poland', currency: 'PLN', locale: 'pl-PL' },
  { code: 'CZ', name: 'Czechia', currency: 'CZK', locale: 'cs-CZ' },
  { code: 'HU', name: 'Hungary', currency: 'HUF', locale: 'hu-HU' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', locale: 'en-AE' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', locale: 'en-SA' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', locale: 'en-QA' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', locale: 'en-BH' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', locale: 'en-KW' },
  { code: 'OM', name: 'Oman', currency: 'OMR', locale: 'en-OM' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', locale: 'en-SG' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', locale: 'en-MY' },
  { code: 'TH', name: 'Thailand', currency: 'THB', locale: 'th-TH' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', locale: 'id-ID' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', locale: 'en-PH' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', locale: 'vi-VN' },
];

export function findRegion(code: string | null | undefined): Region | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return REGIONS.find((r) => r.code === upper) ?? null;
}

/** The region the device reports, if it is a Phase 1 market. */
export function detectRegion(deviceRegion: string | null | undefined): Region | null {
  return findRegion(deviceRegion);
}

/** Search by country name, country code or currency code; the detected region, if it matches, comes first. */
export function searchRegions(query: string, detected?: Region | null): Region[] {
  const q = query.trim().toLowerCase();
  const hits = q === '' ? [...REGIONS] : REGIONS.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase() === q || r.currency.toLowerCase().includes(q));
  const sorted = hits.sort((a, b) => a.name.localeCompare(b.name));
  if (detected) {
    const i = sorted.findIndex((r) => r.code === detected.code);
    if (i > 0) sorted.unshift(...sorted.splice(i, 1));
  }
  return sorted;
}
