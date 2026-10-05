// electron-builder config for the store builds (Microsoft Store MSIX, Mac App Store pkg).
// Used via `--config store/builder.store.js` by scripts/build-store.js. Everything not
// overridden here comes from the "build" block in package.json, so Windows/DMG/Linux
// releases keep their own settings (appId, ICQ name and icon) untouched.
const base = require('../package.json').build;

module.exports = {
  ...base,
  // Registered at Apple. The regular appId stays com.icqmessenger.app on purpose:
  // changing it would stop the Windows setup from recognising installed copies.
  appId: 'de.helleckes.retrogram',
  productName: 'Retrogram',
  directories: { ...base.directories, buildResources: 'store/res' },
  // No third-party or ICQ artwork in the package: public/ is replaced by store/brand/public.
  files: [
    ...base.files.filter((f) => f !== 'public/**/*'),
    { from: 'store/brand/public', to: 'public', filter: ['icon.png', 'icon.ico', 'icon.icns'] },
  ],
  extraMetadata: {
    ...base.extraMetadata,
    storeBuild: true,
    description: 'Retro-style multi-messenger',
  },
  // CFBundleVersion must grow with every upload to App Store Connect (CI passes the run number).
  ...(process.env.MAS_BUILD_VERSION ? { buildVersion: process.env.MAS_BUILD_VERSION } : {}),
  win: { ...base.win, icon: 'store/brand/public/icon.ico' },
  mas: {
    ...base.mas,
    icon: 'store/brand/public/icon.icns',
    ...(process.env.MAS_IDENTITY ? { identity: process.env.MAS_IDENTITY } : {}),
  },
};
