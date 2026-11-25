// Puts the packaged app in /Applications so Spotlight, Launchpad and the Dock can find it.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
const { productName: name } = JSON.parse(readFileSync('package.json', 'utf8'))
const src = `dist/${name}-darwin-${process.arch}/${name}.app`, dest = `/Applications/${name}.app`, tmp = `/Applications/.${name}.new.app`
const id = (p) => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', `${p}/Contents/Info.plist`], { encoding: 'utf8' }).trim()
if (!existsSync(src)) throw new Error(`${src} is missing. Run npm run package first.`)
if (existsSync(dest)) {
  if (id(dest) !== id(src)) throw new Error(`${dest} belongs to a different app, so it was left alone.`)
  let running = true
  try { execFileSync('pgrep', ['-f', `${dest}/Contents/MacOS/`]) } catch { running = false }
  if (running) throw new Error(`Quit ${name} first, then run this again.`)
}
rmSync(tmp, { recursive: true, force: true })
execFileSync('ditto', [src, tmp])
execFileSync('codesign', ['--verify', '--deep', tmp])
rmSync(dest, { recursive: true, force: true })
renameSync(tmp, dest)
writeFileSync('dist/.metadata_never_index', '')
execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', dest])
execFileSync('mdimport', [dest])
console.log(`Installed ${dest}`)
