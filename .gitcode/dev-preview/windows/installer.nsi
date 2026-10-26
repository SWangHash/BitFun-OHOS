; BitFun dev-preview NSIS installer (per-user, no admin required).
; Built by make-installer.bat from the extracted payload folder.

Unicode True
SetCompressor /SOLID lzma
RequestExecutionLevel user
!include "MUI2.nsh"

; Installer/uninstaller exe icons ship in the payload folder.
!define MUI_ICON "bitfun-app-icon.ico"
!define MUI_UNICON "bitfun-app-icon.ico"

Name "BitFun"
OutFile "BitFun-setup.exe"
InstallDir "$LOCALAPPDATA\BitFun"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "install"
  SetOutPath "$INSTDIR"
  File /r /x installer.nsi /x make-installer.bat /x README.txt /x BitFun-setup.exe *.*
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\BitFun"
  ; Shortcuts pin the payload icon explicitly so they render correctly even
  ; if the cross-compiled exe carries no embedded icon resource.
  CreateShortcut "$SMPROGRAMS\BitFun\BitFun.lnk" "$INSTDIR\bitfun-desktop.exe" "" "$INSTDIR\bitfun-app-icon.ico"
  CreateShortcut "$DESKTOP\BitFun.lnk" "$INSTDIR\bitfun-desktop.exe" "" "$INSTDIR\bitfun-app-icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "DisplayName" "BitFun"
  ; Embedded quotes: usernames with spaces must not truncate the path when
  ; appwiz.cpl parses UninstallString / DisplayIcon.
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun" "DisplayIcon" '"$INSTDIR\bitfun-app-icon.ico"'
SectionEnd

Section "uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\BitFun\BitFun.lnk"
  RMDir "$SMPROGRAMS\BitFun"
  Delete "$DESKTOP\BitFun.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BitFun"
SectionEnd
