import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useAppStore } from './store'

// Disable browser default right-click context menu globally
document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
})


const root = createRoot(document.getElementById('root')!)

let appRendered = false
function renderApp() {
  if (appRendered) return
  appRendered = true
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// 首帧渲染前等待 persist 水合完成：
// 持久化设置（自动重连/铃声/复制粘贴等）从 localStorage 恢复若晚于首帧渲染，
// 界面会先按默认值呈现、水合落地后再翻转——表现为「重启后首次打开设置，
// 自动重连开关从开启闪变为关闭，之后就正常」。等水合完成再渲染可根除这类闪变。
// 正常环境下水合在 store 创建时即同步/极快完成，此处立即渲染，无感知开销。
// 兜底：localStorage 数据损坏等异常路径不会触发 onFinishHydration，
// 2 秒后强制渲染，保证应用永远不会卡在白屏。
if (useAppStore.persist.hasHydrated()) {
  renderApp()
} else {
  useAppStore.persist.onFinishHydration(renderApp)
  setTimeout(renderApp, 2000)
}
