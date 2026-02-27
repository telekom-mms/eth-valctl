import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(import.meta.dir, '..', '..');
const NODE_MODULES = join(PROJECT_ROOT, 'node_modules');

interface PatchDefinition {
  filePath: string;
  description: string;
  isPatched: (content: string) => boolean;
  apply: (content: string) => string;
}

const patches: PatchDefinition[] = [
  {
    filePath: join(NODE_MODULES, 'node-hid', 'nodehid.js'),
    description: 'node-hid: replace pkg-prebuilds with static requires',
    isPatched: (content) => !content.includes('pkg-prebuilds/bindings'),
    apply: (content) =>
      content.replace(
        [
          'function loadBinding() {',
          '    if (!binding) {',
          "        const options = require('./binding-options');",
          '        if (process.platform === "linux" && (!driverType || driverType === "hidraw")) {',
          "            options.name = 'HID_hidraw';",
          '        }',
          '        binding = require("pkg-prebuilds/bindings")(__dirname, options);',
          '    }',
          '}'
        ].join('\n'),
        [
          'function loadBinding() {',
          '    if (!binding) {',
          "        if (process.platform === 'win32') {",
          "            binding = require('./prebuilds/HID-win32-x64/node-napi-v4.node');",
          "        } else if (process.platform === 'darwin' && process.arch === 'arm64') {",
          "            binding = require('./prebuilds/HID-darwin-arm64/node-napi-v4.node');",
          "        } else if (process.platform === 'darwin') {",
          "            binding = require('./prebuilds/HID-darwin-x64/node-napi-v4.node');",
          "        } else if (process.platform === 'linux' && process.arch === 'arm64') {",
          "            binding = require('./prebuilds/HID_hidraw-linux-arm64/node-napi-v4.node');",
          '        } else {',
          "            binding = require('./prebuilds/HID_hidraw-linux-x64/node-napi-v4.node');",
          '        }',
          '    }',
          '}'
        ].join('\n')
      )
  },
  {
    filePath: join(NODE_MODULES, 'usb', 'dist', 'usb', 'bindings.js'),
    description: 'usb: replace node-gyp-build with static requires',
    isPatched: (content) => !content.includes("require('node-gyp-build')"),
    apply: () =>
      [
        '"use strict";',
        'Object.defineProperty(exports, "__esModule", { value: true });',
        'var usb;',
        "if (process.platform === 'win32') {",
        "  usb = require('../../prebuilds/win32-x64/node.napi.node');",
        "} else if (process.platform === 'darwin') {",
        "  usb = require('../../prebuilds/darwin-x64+arm64/node.napi.node');",
        "} else if (process.platform === 'linux' && process.arch === 'arm64') {",
        "  usb = require('../../prebuilds/linux-arm64/node.napi.armv8.node');",
        '} else {',
        "  usb = require('../../prebuilds/linux-x64/node.napi.glibc.node');",
        '}',
        'module.exports = usb;',
        ''
      ].join('\n')
  },
  {
    filePath: join(NODE_MODULES, 'keccak', 'bindings.js'),
    description: 'keccak: replace node-gyp-build with static requires',
    isPatched: (content) =>
      !content.includes("require('node-gyp-build')") && content.includes('addon.node'),
    apply: () =>
      [
        'var nativeAddon;',
        "if (process.platform === 'win32') {",
        "  nativeAddon = require('./prebuilds/win32-x64/node.napi.node');",
        "} else if (process.platform === 'darwin' && process.arch === 'arm64') {",
        "  nativeAddon = require('./build/Release/addon.node');",
        "} else if (process.platform === 'darwin') {",
        "  nativeAddon = require('./prebuilds/darwin-x64/node.napi.node');",
        "} else if (process.platform === 'linux' && process.arch === 'arm64') {",
        "  nativeAddon = require('./build/Release/addon.node');",
        '} else {',
        "  nativeAddon = require('./prebuilds/linux-x64/node.napi.glibc.node');",
        '}',
        "if (typeof nativeAddon !== 'function') {",
        "  throw new Error('Native add-on failed to load');",
        '}',
        "module.exports = require('./lib/api')(nativeAddon);",
        ''
      ].join('\n')
  }
];

let patchedCount = 0;

for (const patch of patches) {
  if (!existsSync(patch.filePath)) {
    console.log(`⏭ ${patch.description} — file not found, skipping`);
    continue;
  }

  const content = readFileSync(patch.filePath, 'utf-8');

  if (patch.isPatched(content)) {
    console.log(`✓ ${patch.description} — already patched`);
    continue;
  }

  const patched = patch.apply(content);
  writeFileSync(patch.filePath, patched, 'utf-8');
  console.log(`✓ ${patch.description} — patched`);
  patchedCount++;
}

console.log(
  patchedCount > 0
    ? `\n✓ Patched ${patchedCount} native module(s) for static require`
    : '\n✓ All native modules already patched'
);
