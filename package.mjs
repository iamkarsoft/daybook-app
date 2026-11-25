import { packager } from '@electron/packager'
const [dir] = await packager({
  dir: '.', name: 'Daybook', out: 'dist', overwrite: true, platform: 'darwin', arch: process.arch, icon: 'assets/icon.icns', asar: true, prune: false,
  appBundleId: 'local.daybook.app', appCategoryType: 'public.app-category.productivity',
  // Everything is bundled into out/, so node_modules stays behind.
  ignore: (p) => !!p && !/^\/(out(\/|$)|package\.json$)/.test(p) || /\.map$|\.test\./.test(p),
  osxSign: { identity: '-', identityValidation: false, optionsForFile: () => ({ hardenedRuntime: false }) },
})
console.log(dir)
