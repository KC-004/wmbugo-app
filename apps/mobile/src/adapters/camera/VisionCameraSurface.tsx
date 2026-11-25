import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, usePhotoOutput } from 'react-native-vision-camera';
import type { CameraSurfaceHandle, CameraSurfaceProps } from './cameraSurface';

/** A torch change still pending when the camera closed (a photo was taken, or the screen went away) is expected, not a failure. */
export const isExpectedCameraError = (error: { name?: string; message?: string }): boolean => /not active|OperationCanceled|cancell?ed/i.test(`${error.name} ${error.message}`);

/** The real camera surface (VisionCamera, Story 10.7): the back camera, a preview, and one still photo written to a temporary file. */
export const VisionCameraSurface = forwardRef<CameraSurfaceHandle, CameraSurfaceProps>(function VisionCameraSurface({ torch, active, onError }, ref) {
  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput();
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  useImperativeHandle(
    ref,
    () => ({
      async capture() {
        const file = await photoOutput.capturePhotoToFile({ enableShutterSound: true }, {});
        return file.filePath;
      },
    }),
    [photoOutput],
  );
  if (!device) return <View testID="camera-no-device" style={StyleSheet.absoluteFill} />;
  return <Camera style={StyleSheet.absoluteFill} device={device} isActive={active} outputs={outputs} torchMode={torch && device.hasTorch ? 'on' : 'off'} onError={(e) => { if (!isExpectedCameraError(e)) onError?.(); }} />;
});
