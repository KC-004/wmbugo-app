import { setSaveTimingSink, startSaveTiming } from './saveTiming';

afterEach(() => setSaveTimingSink(null));

describe('save timing', () => {
  it('reports the kind and a duration to the sink when the toast is up', () => {
    const seen: { kind: string; durationMs: number }[] = [];
    setSaveTimingSink((e) => seen.push(e));
    const done = startSaveTiming('expense');
    done();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('expense');
    expect(seen[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does nothing without a sink', () => {
    expect(() => startSaveTiming('income')()).not.toThrow();
  });
});
