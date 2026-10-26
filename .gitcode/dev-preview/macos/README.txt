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
- frontend/ resources/ mobile-web/ flashgrep* 为运行必需，脚本会将它们
  复制进 BitFun.app/Contents/MacOS/；载荷保留在原目录，脚本可重复执行
- bitfun-app-icon.icns 会自动装入 BitFun.app/Contents/Resources/ 并通过
  Info.plist 的 CFBundleIconFile 注册为应用图标

正式签名与公证（可选，其他用户可双击直接打开）
------------------------------------------------
默认 ad-hoc 签名仅供本机测试；正式分发需 Apple Developer Program 账号：

1. 在 developer.apple.com 创建 "Developer ID Application" 证书，导出 p12
   后双击导入 Mac 钥匙串
2. 一次性登记公证凭据（App 专用密码在 appleid.apple.com → 登录与安全
   → App 专用密码 生成）：
       xcrun notarytool store-credentials BITFUN_NOTARY \
         --apple-id <AppleID> --team-id <团队ID> --password <App专用密码>
3. 查询证书名： security find-identity -v -p codesigning
4. 一条命令完成 组装 + Developer ID 签名 + 公证 + 装订：
       BITFUN_SIGN_IDENTITY="Developer ID Application: <公司名> (<团队ID>)" \
       BITFUN_NOTARY_PROFILE=BITFUN_NOTARY \
       sh make-dmg.sh

脚本会依次：对 .app 启用 hardened runtime 并签名（公证必需）→ 提交
.app 公证并装订 → 生成 DMG → 签名 DMG → 提交公证并装订。公证过程
--wait 阻塞等待 Apple 审核结果（几分钟），被拒即报错退出。
未设置这两个变量时自动退回 ad-hoc 签名，行为与以前一致。
