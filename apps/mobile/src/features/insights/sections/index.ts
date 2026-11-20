import { registerInsightsSection } from '../sectionRegistry';
import { isItGoingUp } from './IsItGoingUp';
import { whereDidItGo } from './WhereDidItGo';
import { whoGotIt } from './WhoGotIt';

/** Registers every question section that exists, in their own order. The app calls it once at start; tests register what they need. */
export function registerInsightsSections(): void {
  registerInsightsSection(whereDidItGo);
  registerInsightsSection(isItGoingUp);
  registerInsightsSection(whoGotIt);
}
