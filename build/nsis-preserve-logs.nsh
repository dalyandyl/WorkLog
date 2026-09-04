; 更新前备份旧版日志数据，避免 NSIS 更新时被删除。
;
; 背景：electron-builder 的 NSIS 安装器在更新时会先运行「旧版卸载器」，
; 而旧版卸载器会对安装目录执行 `RMDir /r $INSTDIR`，把 <安装目录>/logs
; 连同数据一起删掉（这正是旧版「更新后日志被清空」的原因）。
;
; customInit 在 .onInit 中、且在任何文件删除之前执行（installSection.nsh 的
; uninstallOldVersion 之前），此时 $INSTDIR 仍是旧安装目录、旧 logs 尚在。
; 因此在这里把 <安装目录>/logs 完整备份到 %APPDATA%/WorkLog/pre-update-backup/logs，
; 新版应用启动时会通过 migrateStorageRoot() 自动迁移回 %APPDATA%/WorkLog/logs。
;
; 仅对打包后的 NSIS 安装器生效（electron-builder.yml: nsis.include）。
!macro customInit
  ${If} ${FileExists} "$INSTDIR\logs"
    CreateDirectory "$APPDATA\WorkLog\pre-update-backup"
    RMDir /r "$APPDATA\WorkLog\pre-update-backup\logs"
    ExecWait '"$SYSDIR\cmd.exe" /c xcopy "$INSTDIR\logs" "$APPDATA\WorkLog\pre-update-backup\logs" /E /I /Y /Q'
  ${EndIf}
!macroend
