import { forwardRef, useImperativeHandle, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice, usePhotoOutput } from 'react-native-vision-camera';
import type { CameraSurfaceHandle, CameraSurfaceProps } from './cameraSurface';

/**
 * Session errors are not shown: a torch change still pending when the camera closed is expected, and a real camera failure already reaches the
 * person through the shutter (`The camera could not take the photo`). The default handler would put a red box on screen in a debug build.
 */
function onCameraError(): void {}

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
