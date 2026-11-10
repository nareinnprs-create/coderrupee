; Stop running CoderRupee processes so files are not locked during install or
; uninstall. Failures are ignored on purpose: a missing process makes taskkill
; exit non-zero, and the install must not abort because of that.
!macro coderrupeeKillProcesses
  DetailPrint "Stopping running CoderRupee processes"
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM coderrupee.exe /T'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM coderrupee-cli.exe /T'
  Pop $0
!macroend

!macro customInit
  !insertmacro coderrupeeKillProcesses
!macroend

!macro customUnInit
  !insertmacro coderrupeeKillProcesses
!macroend
