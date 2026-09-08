import { createRoot } from 'react-dom/client'
import App from './App'

// 界面字体 Inter（仅 latin 子集，拉丁/数字；汉字走系统字体），代码字体 JetBrains Mono
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-600.css'

import './assets/main.css'

createRoot(document.getElementById('root')!).render(<App />)