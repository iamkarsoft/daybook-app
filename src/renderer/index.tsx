import { createRoot } from 'react-dom/client'
import './style.css'
import { QuickWindow } from './Add.tsx'
import { App } from './App.tsx'
import { Panel } from './Panel.tsx'
import { boot } from './store.ts'
const which = location.hash.slice(1)
if (which) boot()
createRoot(document.getElementById('root')!).render(which === 'quick' ? <QuickWindow /> : which === 'panel' ? <Panel /> : <App />)
