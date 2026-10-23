/**
 * 功能访问密匙。
 *
 * 「功能台账」（MomPro 表单/事务）是个人专用模块：默认从顶部导航里隐藏，
 * 只有在「设置 → 权限认证」里输入正确密匙后才会显示。
 *
 * 密匙按需求写死在程序里，主进程与渲染层共用这一份判定：
 * 渲染层负责藏导航 / 挡页面，主进程再挡一道 IPC（未解锁时读不出任何台账数据）。
 * 想换密匙，改下面的常量即可。
 */
export const MOMPRO_ACCESS_KEY = 'mompro'

/** 比对用户输入的密匙：忽略首尾空格与大小写，避免手输时被大小写卡住 */
export function matchAccessKey(input: string): boolean {
  return input.trim().toLowerCase() === MOMPRO_ACCESS_KEY
}
