import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, usePhotoOutput } from 'react-native-vision-camera';
import type { CameraSurfaceHandle, CameraSurfaceProps } from './cameraSurface';

/** A torch change that was still pending when the camera closed (a photo was taken, or the screen went away) is expected, not an error. */
function onCameraError(error: Error): void {
  if (/not active|OperationCanceled|cancell?ed/i.test(`${error.name} ${error.message}`)) return;
  console.warn(error);
}

/** The real camera surface (VisionCamera, Story 10.7): the back camera, a preview, and one still photo written to a temporary file. */
export const VisionCameraSurface = forwardRef<CameraSurfaceHandle, CameraSurfaceProps>(function VisionCameraSurface({ torch, active }, ref) {
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
  return <Camera style={StyleSheet.absoluteFill} device={device} isActive={active} outputs={outputs} torchMode={torch && device.hasTorch ? 'on' : 'off'} onError={onCameraError} />;
});
