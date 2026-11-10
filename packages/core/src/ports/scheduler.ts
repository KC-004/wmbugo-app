/**
 * Scheduler port (AD-16): something that asks for periodic work. The app implements it with app start and resume; a
 * background trigger can implement the same port later without changing the use cases it runs.
 */
export interface Scheduler {
  /** Runs `task` now and every time the app returns to the foreground. Returns a function that stops it. */
  onStartOrResume(task: () => void | Promise<void>): () => void;
}
