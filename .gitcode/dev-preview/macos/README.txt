BitFun macOS 开发者预览包（Apple Silicon）
==========================================

一键制作 .app 与 .dmg
---------------------
终端进入本目录，执行：

    sh make-dmg.sh

生成：
- BitFun.app —— 已组装并 ad-hoc 签名，可直接 open 运行
- BitFun.dmg —— 含 /Applications 拖装链接的标准镜像

说明
----
- 未做 Developer ID 签名/公证，首次打开需右键 → 打开，或执行
  xattr -cr BitFun.app
- frontend/ resources/ mobile-web/ flashgrep* 为运行必需，脚本会自动
  将它们移入 BitFun.app/Contents/MacOS/（执行脚本后原目录中的载荷
  文件会被移动，属预期行为）
- Info.plist 由脚本自动生成；如需图标，可自行生成 icns 放入
  BitFun.app/Contents/Resources/ 并在 plist 中添加 CFBundleIconFile
