# HostHarbor / Dock mark

当前品牌是用户选定的 C「几何泊位」。完整A/B/C概念图、选稿与用途索引见 [设计档案](../../docs/design/branding/README.md)，供官网复用；概念原图不进入App包。

## 源文件与输出

- `mark.svg`：按用户选定白色图标的轮廓比例重绘，平滑曲线；源色为薄荷绿 `#A2E7CD`。
- `wordmark.svg`：原始C概念图中HostHarbor字形的平滑矢量轮廓，非系统字体。主窗口使用浅色版本，跨平台保持同一字形。
- `mark-light.svg` / `mark-dark.svg`、`wordmark-light.svg` / `wordmark-dark.svg`：独立标志/字标，透明底。
- `lockup-light.svg` / `lockup-dark.svg`：横排组合；`lockup-stacked-light.svg` / `lockup-stacked-dark.svg`：竖排组合，可用于官网导航、Hero和宣传素材。
- `app-icon.svg` / `icon.png` / `icon.icns` / `icon.ico`：白色标志、石墨底圆角背景。1024画布中背景848×848、四周88透明留白；比旧版928背景缩小约8.6%，用于Dock/窗口/安装图标。
- `trayTemplate.png` / `trayTemplate@2x.png`：18pt菜单栏黑色透明模板，系统按外观着色；`tray.png`为Windows透明彩色托盘图标。

生成：`npm run brand:build`，从`mark.svg`和`wordmark.svg`确定性生成所有变体（仅构建时使用@resvg/resvg-js）。提交源与所有生成产物；安装和运行无需额外工具。ICNS含16–1024及Retina PNG块，ICO含16/24/32/48/64/128/256。

生成脚本不读取概念档案；概念字标已转换为本目录中的源SVG。网站直接使用SVG输出并提供HostHarbor可访问名称，无须依赖AI生成工具或字体安装。
