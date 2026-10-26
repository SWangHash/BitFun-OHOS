BitFun Windows 开发者预览包
============================

直接运行
--------
双击本目录下的 bitfun-desktop.exe 即可（保持目录结构完整，frontend/
resources/ mobile-web/ flashgrep* 为运行必需，勿单独拷贝 exe）。

制作 setup.exe 安装包（可选）
-----------------------------
1. 安装 NSIS：  winget install NSIS.NSIS
2. 双击 make-installer.bat（或在命令行运行）
3. 生成的 BitFun-setup.exe 按用户级安装到 %LOCALAPPDATA%\BitFun，
   含开始菜单/桌面快捷方式与卸载器，无需管理员权限。

说明
----
- 产物未做 Authenticode 签名，首次运行 SmartScreen 会提示，点"仍要运行"
- CRT 为静态链接，目标机器无需安装 VC++ 运行库
- 安装包同样未签名，仅适合内部测试分发
- bitfun-app-icon.ico 同时用作安装器/卸载器图标与快捷方式图标；
  NSIS 3.x（winget 安装的版本自带 MUI2）即可编译
