# 测试报告

测试环境：Mac mini M4（16GB，macOS 26.7.2），Comfy Desktop v1.1.10，ComfyUI 0.45.3 / 前端 1.55.18。

## 2026-11-20 代码审查与修复（发布前）

全量通读 flow_links.js 后修复 4 项：
1. 覆盖层自愈：前端重建画布元素时覆盖层可能被摘掉，drawOverlayGlow 每帧检查并重新挂载。
2. setup 解耦：连线接管失败时只禁用流水，节点荧光与设置面板照常工作（老版本前端更友好）。
3. linkState 内存保护：超过 5000 条自动清理，防长时间使用膨胀。
4. 清理无用变量与过时注释。

## 2026-11-20 包完整性校验

- `__init__.py` 可正常导入：NODE_CLASS_MAPPINGS = {}，WEB_DIRECTORY = ./web 且目录存在。
- `web/flow_links.js` 通过 node --check 语法校验。
- Mac 上实际安装的副本与发布包 md5 一致（flow_links.js: 09874c711e34068321481f10b2b0173f），即「发布包字节 = 已实测字节」，效果可复现。
- 文件夹改名可用：JS 用相对路径 `../../scripts/app.js`，与文件夹名无关。

## 2026-11-20 实机回归（赛博朋克演示工作流）

- 用无敏感内容的演示工作流（flowlinks-demo-cyberpunk，文生图赛博朋克城市）打开画布：节点荧光全覆盖、连线流水正常、FPS 约 60 不卡。
- 设置面板 9 项齐全；「节点荧光」开关实测：关 → 边框消失、流水仍在；开 → 边框恢复。开关后配置已恢复默认全开。
- 截图：docs/screenshot-main.png、docs/screenshot-panel.png、docs/screenshot-glow-off.png；动图：docs/demo.gif（待机慢漂）。

## 待执行（今晚队列清空后自动跑，cron flowlinks-fresh-install-test）

- 全新安装实测：备份现装 → 按新用户方式装发布包到改名文件夹 → 重启 ComfyUI → 验证 /extensions 加载与效果 → 恢复原装。
- 执行中采集：提交赛博朋克演示任务，执行期间连拍拼 demo-active.gif（验证流速跟随进度），结果图存 docs/demo-result.png。
- 结果将追加到本文件。
