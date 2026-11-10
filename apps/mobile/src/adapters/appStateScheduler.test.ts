import { AppState } from 'react-native';
import { appStateScheduler } from './appStateScheduler';

describe('appStateScheduler', () => {
  it('runs the task at once and on every return to the foreground, and stops when asked', async () => {
    let listener: ((s: string) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, l: (s: string) => void) => {
      listener = l;
      return { remove };
    }) as never);
    const task = jest.fn();
    const stop = appStateScheduler.onStartOrResume(task);
    await Promise.resolve();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    listener!('background');
    listener!('active');
    await Promise.resolve();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
    stop();
    expect(remove).toHaveBeenCalled();
  });
});
