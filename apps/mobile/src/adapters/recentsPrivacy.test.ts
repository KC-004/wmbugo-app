import { NativeModules, Platform } from 'react-native';
import { applyHideForAppLock, applyHideInRecents, hidingBlocksScreenshots } from './recentsPrivacy';

describe('recents privacy adapter', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).WmbugoPrivacy;
    jest.restoreAllMocks();
  });

  it('passes the choice to the native module and keeps working when the module is absent or throws', async () => {
    const setHideInRecents = jest.fn(async () => undefined);
    const setHideForAppLock = jest.fn(async () => undefined);
    (NativeModules as Record<string, unknown>).WmbugoPrivacy = { setHideInRecents, setHideForAppLock };
    await applyHideInRecents(true);
    await applyHideForAppLock(true);
    expect(setHideInRecents).toHaveBeenCalledWith(true);
    expect(setHideForAppLock).toHaveBeenCalledWith(true);
    (NativeModules as Record<string, unknown>).WmbugoPrivacy = { setHideInRecents: async () => Promise.reject(new Error('x')), setHideForAppLock };
    await expect(applyHideInRecents(false)).resolves.toBeUndefined();
    delete (NativeModules as Record<string, unknown>).WmbugoPrivacy;
    await expect(applyHideInRecents(false)).resolves.toBeUndefined();
  });

  it('the screenshot caption applies below Android 13 only', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const version = jest.spyOn(Platform, 'Version', 'get');
    version.mockReturnValue(31 as never);
    expect(hidingBlocksScreenshots()).toBe(true);
    version.mockReturnValue(33 as never);
    expect(hidingBlocksScreenshots()).toBe(false);
  });
});
