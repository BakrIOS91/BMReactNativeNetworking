const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// The example consumes the package straight from the repo root (no install step),
// so edits to ../src show up with fast refresh.
const packageRoot = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The package's devDependencies carry their own react / react-native; hide them so the app has exactly one copy.
const duplicated = ['react', 'react-native', 'react-test-renderer', '@types/react'];
const blocked = duplicated.map((m) => new RegExp(`^${escape(path.join(packageRoot, 'node_modules', m))}[/\\\\].*$`));

config.watchFolders = [packageRoot];
config.resolver.blockList = [...[].concat(config.resolver.blockList ?? []), ...blocked];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(packageRoot, 'node_modules')];
config.resolver.extraNodeModules = { 'bm-react-native-networking': packageRoot };

module.exports = config;
