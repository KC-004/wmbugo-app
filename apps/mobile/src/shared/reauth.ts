/**
 * The shared re-authentication guard for irreversible actions (Delete permanently). It asks the person to unlock only when
 * app lock is on; app lock arrives in Epic 8, so until then this lets the action through. Every irreversible action calls
 * it after its own confirm sheet and before it writes.
 */
export async function requireReauth(): Promise<boolean> {
  return true;
}
