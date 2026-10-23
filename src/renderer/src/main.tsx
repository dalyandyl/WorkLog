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
// 1.5.5 玻璃主题：令牌层 + 外壳（必须在 main.css 之后，才能覆盖旧变量）
import './assets/theme.css'
import './assets/shell.css'
// 通用原子件与页面布局（新外壳用；与 main.css 无重名）
import './assets/ui.css'
import './assets/views.css'

createRoot(document.getElementById('root')!).render(<App />)