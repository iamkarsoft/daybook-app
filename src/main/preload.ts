import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('daybook', {
  call: (method: string, args: unknown[]) => ipcRenderer.invoke('rpc', method, args),
  onPush: (fn: (a: unknown) => void) => {
    const h = (_: unknown, a: unknown) => fn(a)
    ipcRenderer.on('push', h)
    return () => { ipcRenderer.off('push', h) }
  },
})
