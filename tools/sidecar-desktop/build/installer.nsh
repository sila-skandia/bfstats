; The NSIS installer's additions (package.json build.nsis.include).
;
; electron-builder's `protocols` setting registers nothing on Windows (it is
; macOS's Info.plist and Linux's MimeType), so the installer registers
; bfstats-sidecar:// itself, for the user who installs, and the uninstaller
; removes it, so no link is left pointing at a removed program. The app
; writes the same key at each start (app.setAsDefaultProtocolClient); this
; makes a link work before the first start too.
;
; The uninstaller also removes "Start at login" (the Run value Electron writes
; under the app's AppUserModelID, build.appId). An update runs the old
; uninstaller first (${isUpdated}); both stay then.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\bfstats-sidecar" "" "URL:bfstats Sidecar join link"
  WriteRegStr HKCU "Software\Classes\bfstats-sidecar" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\bfstats-sidecar\DefaultIcon" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0"
  WriteRegStr HKCU "Software\Classes\bfstats-sidecar\shell\open\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\""
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\bfstats-sidecar"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "io.bfstats.sidecar"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "io.bfstats.sidecar"
  ${endIf}
!macroend
