; Extra steps for the PDF Editor installer (electron-builder, NSIS, per-user).
; Registers the app as a PDF handler the same way the old install.ps1 did, but pointing at the installed exe:
;   - right-click a PDF > Open with > PDF Editor
;   - Windows Settings > Default apps (PDF Editor is offered as a candidate for .pdf)
; Windows itself decides the default app; it cannot be forced from an installer.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\PDFEditor.AssocPDF" "" "PDF document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\PDFEditor.AssocPDF\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\PDFEditor.AssocPDF\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "PDF Editor"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"

  WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "PDFEditor.AssocPDF" ""

  WriteRegStr SHELL_CONTEXT "Software\PDFEditor\Capabilities" "ApplicationName" "PDF Editor"
  WriteRegStr SHELL_CONTEXT "Software\PDFEditor\Capabilities" "ApplicationDescription" "A simple offline PDF editor"
  WriteRegStr SHELL_CONTEXT "Software\PDFEditor\Capabilities\FileAssociations" ".pdf" "PDFEditor.AssocPDF"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "PDF Editor" "Software\PDFEditor\Capabilities"

  ; tell Explorer right away that file associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\PDFEditor.AssocPDF"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "PDFEditor.AssocPDF"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHELL_CONTEXT "Software\PDFEditor"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "PDF Editor"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Settings and data in %APPDATA%\PDF Editor are deliberately kept.
!macroend
