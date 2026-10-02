; Retrogram — NSIS additions for the Windows setup (wired via "nsis.include").
;
; Keep the login across updates. Versions up to 1.0.37 stored ICQ-Data (WhatsApp
; and Telegram login, chat list) inside the install folder, and an update deletes
; that folder before installing the new version (electron-builder's uninstaller:
; RMDir /r $INSTDIR). So right before the old version is removed, move ICQ-Data to
; the user-data folder; the app takes it over on its next start
; (electron/lib/data-dir.js → legacy-ICQ-Data).
;
; The hook is customCheckAppRunning: it runs in the install section after the user
; confirmed the setup, immediately before the old version is uninstalled — unlike
; customInit, a cancelled setup moves nothing. Defining it replaces the default
; check, so the default is called first and its helpers are declared here (the
; template only declares them when this macro is NOT defined).

!include "getProcessInfo.nsh"
Var pid

!macro retrogramRescueDataFrom DIR
  ${If} ${FileExists} "${DIR}\ICQ-Data\*.*"
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}\legacy-ICQ-Data"
    ClearErrors
    Rename "${DIR}\ICQ-Data" "$APPDATA\${PRODUCT_FILENAME}\legacy-ICQ-Data"
    ${If} ${Errors}
      ; Rename fails across drives — copy instead (the uninstaller deletes the original).
      ClearErrors
      CreateDirectory "$APPDATA\${PRODUCT_FILENAME}\legacy-ICQ-Data"
      CopyFiles /SILENT "${DIR}\ICQ-Data\*.*" "$APPDATA\${PRODUCT_FILENAME}\legacy-ICQ-Data"
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  !insertmacro _CHECK_APP_RUNNING

  ; The previous version may live elsewhere if the folder was changed in the wizard.
  ; Read it in the template's own registry context (HKLM for per-machine installs).
  ReadRegStr $R9 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation

  ; The app runs as the logged-in user and reads that user's %APPDATA%, also for
  ; a per-machine install.
  SetShellVarContext current
  CreateDirectory "$APPDATA\${PRODUCT_FILENAME}"
  !insertmacro retrogramRescueDataFrom "$INSTDIR"
  ${If} $R9 != ""
  ${AndIf} $R9 != "$INSTDIR"
    !insertmacro retrogramRescueDataFrom "$R9"
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  ClearErrors
!macroend
