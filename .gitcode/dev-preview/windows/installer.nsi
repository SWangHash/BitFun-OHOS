; BitFun dev-preview NSIS installer (per-user, no admin required).
; Built by make-installer.bat from the extracted payload folder.

Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel user

Name "BitFun"
OutFile "BitFun-setup.exe"
InstallDir "$LOCALAPPDATA\BitFun"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "install"
  SetOutPath "$INSTDIR"
  File /r /x installer.nsi /x make-installer.bat /x README.txt /x BitFun-setup.exe *.*
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\BitFun"
  CreateShortcut "$SMPROGRAMS\BitFun\BitFun.lnk" "$INSTDIR\bitfun-desktop.exe"
  CreateShortcut "$DESKTOP\BitFun.lnk" "$INSTDIR\bitfun-desktop.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "DisplayName" "BitFun"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "DisplayIcon" "$INSTDIR\bitfun-desktop.exe"
SectionEnd

Section "uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\BitFun\BitFun.lnk"
  RMDir "$SMPROGRAMS\BitFun"
  Delete "$DESKTOP\BitFun.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun"
SectionEnd
