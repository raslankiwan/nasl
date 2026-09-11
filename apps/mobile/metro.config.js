const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro must watch the whole workspace, not just this app, or a change in packages/ is invisible.
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Without this, a nested copy of react-native can be resolved and the app renders two Reacts.
config.resolver.disableHierarchicalLookup = true;

/**
 * Resolve the workspace packages to their source, matching what the admin console does.
 * Reading a built `dist` means a change to a translation needs a rebuild before it appears here,
 * and a forgotten rebuild looks like a missing translation rather than a stale build.
 */
config.resolver.extraNodeModules = {
  '@nasl/shared': path.resolve(workspaceRoot, 'packages/shared/src'),
  '@nasl/i18n': path.resolve(workspaceRoot, 'packages/i18n/src'),
};

module.exports = config;
