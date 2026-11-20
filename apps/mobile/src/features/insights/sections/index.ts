import { registerInsightsSection } from '../sectionRegistry';
import { whereDidItGo } from './WhereDidItGo';

/** Registers every question section that exists, in their own order. The app calls it once at start; tests register what they need. */
export function registerInsightsSections(): void {
  registerInsightsSection(whereDidItGo);
}
