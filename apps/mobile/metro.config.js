const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * pnpm runs with node-linker=hoisted, so dependencies live in the workspace
 * root node_modules (watched too). Metro watches packages/core so edits to the core package
 * are bundled without a publish step.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(workspaceRoot, 'packages/core'),
    path.resolve(workspaceRoot, 'node_modules'),
  ],
  resolver: {
    // .sql files are migrations; babel-plugin-inline-import inlines them.
    sourceExts: [...getDefaultConfig(projectRoot).resolver.sourceExts, 'sql'],
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
