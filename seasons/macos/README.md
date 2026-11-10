# Seasonote Mac 应用

双击 `Seasonote.app`，或将它拖入「应用程序」后打开。首次打开会创建桌面 Seasonote 别名，草坪转盘图标也会显示在 Dock 中。

- 鼠标移入转盘，右上角显示 **×**；点击收起，QQ 音乐继续播放。
- 点击 Dock 中的 **Seasonote** 图标重新显示。退出后再次打开应用，也会显示转盘。
- 菜单栏 Seasonote →「打开开关窗口…」提供显示、隐藏和退出；关闭开关窗口不会退出。
- 完全退出：菜单栏「退出 Seasonote」，或应用激活时按 ⌘Q。
- 直接拖动转盘移动，拖动四角缩放；按住 Shift 拖动指针调整季节。
- 转盘位于桌面层，其他应用窗口会覆盖它。没有置顶模式，也没有安装开机自启动项。
- 没有音乐时仅显示摆件；检测到有效歌曲后，歌名、歌手、播放按钮和进度条常驻显示，封面显示在圆盘中心。暂停保留，播放器退出则恢复摆件。
- 菜单栏「创建桌面快捷方式」可补建桌面入口。

## 构建

运行 `./macos/build.sh`。脚本生成 macOS 13+ 的 Apple Silicon / Intel 通用应用，打包本地网页、资源、转盘图标和音乐连接程序，并添加本地签名。

## 开发验证

退出已有应用后，可执行：

```sh
./macos/Seasonote.app/Contents/MacOS/SeasonDesktop --snapshot /绝对路径/widget.png
./macos/Seasonote.app/Contents/MacOS/SeasonDesktop --diagnose /绝对路径/state.jsonl
```

快照模式记录网页加载、透明度、音乐连接和绘制错误，再导出图像并退出。诊断模式记录窗口层级、显示状态、关闭按钮、位置尺寸、动画与音乐状态。
