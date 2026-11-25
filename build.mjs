import * as esbuild from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
const prod = process.argv.includes('--prod'), watch = process.argv.includes('--watch')
rmSync('out', { recursive: true, force: true }); mkdirSync('out')
const common = { bundle: true, logLevel: 'info', sourcemap: prod ? false : 'linked', minify: prod, define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' } }
const jobs = [
  { ...common, define: {}, entryPoints: { main: 'src/main/main.ts', preload: 'src/main/preload.ts' }, outdir: 'out', outExtension: { '.js': '.cjs' }, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] },
  { ...common, entryPoints: { renderer: 'src/renderer/index.tsx' }, outdir: 'out', platform: 'browser', format: 'iife', target: 'chrome140', jsx: 'automatic' },
]
const html = () => cpSync('src/renderer/index.html', 'out/index.html')
if (!watch) { await Promise.all(jobs.map((j) => esbuild.build(j))); html() }
else {
  await Promise.all(jobs.map(async (j) => { const c = await esbuild.context(j); await c.rebuild(); await c.watch() })); html()
  if (process.argv.includes('--run')) spawn('npx', ['electron', '.'], { stdio: 'inherit' }).on('exit', () => process.exit())
}
