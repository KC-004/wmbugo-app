import type { ForwardRefExoticComponent, RefAttributes } from 'react';

/** What the receipt camera screen needs from a camera, so the screen is tested without a native camera. */
export interface CameraSurfaceHandle {
  /** Takes one photo and resolves its temporary file path (not a `file://` URL). */
  capture(): Promise<string>;
}

export interface CameraSurfaceProps {
  torch: boolean;
  active: boolean;
}

export type CameraSurface = ForwardRefExoticComponent<CameraSurfaceProps & RefAttributes<CameraSurfaceHandle>>;
