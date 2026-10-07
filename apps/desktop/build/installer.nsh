; Glofly additions to the installer (electron-builder.yml → nsis.include).

!macro customInit
  ; The red Glofly splash for a moment before installing. Skipped for silent installs,
  ; which is how automatic updates will run, so updates stay quiet.
  ${IfNot} ${Silent}
    InitPluginsDir
    File /oname=$PLUGINSDIR\gloflysplash.bmp "${BUILD_RESOURCES_DIR}\installerSplash.bmp"
    ; show for 1.8s, fading in and out over 0.25s each
    AdvSplash::show 1800 250 250 -1 $PLUGINSDIR\gloflysplash
    Pop $0
  ${EndIf}
!macroend
