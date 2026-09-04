// 自动更新配置模板。复制为 updater-config.ts 并填入真实值（updater-config.ts 已被 gitignore）。
// Gitee 通道必填令牌（私密/公开仓库运行时 API 都需要）；GitHub 仓库公开时令牌可留空。
export const UPDATE_CONFIG = {
  gitee: {
    owner: '你的Gitee用户名',
    repo: 'worklog',
    token: '你的Gitee私人令牌'
  },
  github: {
    owner: '你的GitHub用户名',
    repo: 'WorkLog',
    token: '' // GitHub 公开仓库运行时免令牌
  }
}
