// electron-builder hook. Folders synced by iCloud Drive (Desktop / Documents) tag app bundles with
// Finder metadata, and codesign refuses to sign a bundle that carries it. Strip it before signing.
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  try {
    execFileSync('xattr', ['-cr', context.appOutDir]);
  } catch (err) {
    console.warn('after-pack: could not clear extended attributes:', err.message);
  }
};
