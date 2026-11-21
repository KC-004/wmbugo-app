/**
 * @format
 */

import 'react-native-get-random-values'; // crypto.getRandomValues for the database key
import { AppRegistry } from 'react-native';
import App from './App';
import { installCrashCapture } from './src/adapters/startApp';
import { name as appName } from './app.json';

installCrashCapture();
AppRegistry.registerComponent(appName, () => App);
