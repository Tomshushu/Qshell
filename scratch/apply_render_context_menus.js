import fs from 'fs';

const filePath = './src/components/layout/sftp-panel.tsx';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/\r\n/g, '\n');

// 1. Replace Local ScrollArea block
const localListStart = content.indexOf('<ScrollArea className="flex-1">', content.indexOf("t('sftp_retry')"));
const localListEnd = content.indexOf('</ScrollArea>', localListStart) + '</ScrollArea>'.length;

const localListTarget = content.substring(localListStart, localListEnd);
const localListReplacement = `<ContextMenu>
                    <ContextMenuTrigger asChild>
                      <ScrollArea className="flex-1" onContextMenu={() => setLocalContextMenuFile(null)}>
                        <div className="divide-none">
                          {filteredLocalFiles.map((file) => {
                            const isSelected = selectedLocalPaths.has(file.path)
                            return (
                              <div
                                key={file.path}
                                onDoubleClick={() => {
                                  if (file.isDirectory) {
                                    loadLocalDirectory(file.path)
                                    setSelectedLocalPaths(new Set())
                                  } else {
                                    // 双击文件：如果远程已连通，直接触发上传
                                    if (selectedServerId) {
                                      setSelectedLocalPaths(new Set([file.path]))
                                      setTimeout(() => handleUploadSelected(), 50)
                                    }
                                  }
                                }}
                                onMouseDown={(e) => {
                                  if (e.button !== 0 && e.button !== 2) return
                                  const newSet = new Set(selectedLocalPaths)
                                  if (e.ctrlKey || e.metaKey) {
                                    if (newSet.has(file.path)) newSet.delete(file.path)
                                    else newSet.add(file.path)
                                  } else {
                                    if (e.button === 2 && newSet.has(file.path)) {
                                      return
                                    }
                                    newSet.clear()
                                    newSet.add(file.path)
                                  }
                                  setSelectedLocalPaths(newSet)
                                }}
                                onContextMenu={(e) => {
                                  e.stopPropagation()
                                  setLocalContextMenuFile(file)
                                }}
                                className={cn(
                                  "grid grid-cols-[2.5fr_1fr_1.2fr_1.8fr] px-4 h-10 text-xs items-center cursor-pointer select-none transition-colors",
                                  isSelected ? "bg-blue-500/20 dark:bg-blue-950/40 font-semibold" : "hover:bg-accent/60"
                                )}
                              >
                                <div className="flex items-center gap-2.5 overflow-hidden pr-2">
                                  {renderFileIcon(file as any, "h-6 w-6")}
                                  <span className={cn("truncate", !file.isDirectory && "text-muted-foreground")}>{file.name}</span>
                                </div>
                                <span className="text-left text-[11px] text-muted-foreground font-mono pl-3">
                                  {file.name === '..' ? '' : (file.isDirectory ? '-' : formatFileSize(file.size))}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : t(getFileTypeLabel(file as any))}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : (file.modified || '-')}
                                </span>
                              </div>
                            )
                          })}
                          {filteredLocalFiles.length === 0 && (
                            <div className="py-12 text-center text-xs text-muted-foreground select-none">
                              {t('sftp_no_files')}
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      {localContextMenuFile && localContextMenuFile.name !== '..' ? (
                        <>
                          <ContextMenuItem onClick={() => {
                            if (localContextMenuFile) {
                              setSelectedLocalPaths(new Set([localContextMenuFile.path]))
                              setTimeout(() => handleUploadSelected(), 50)
                            }
                          }}>
                            <Upload className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>传输到目标目录</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setRenameSide('local')
                            setRenameTarget(localContextMenuFile as any)
                            setRenameValue(localContextMenuFile.name)
                          }}>
                            <Edit2 className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>重命名</span>
                          </ContextMenuItem>
                          <ContextMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30" onClick={() => {
                            setDeleteSide('local')
                            setDeleteTarget(localContextMenuFile as any)
                          }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>删除</span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                        </>
                      ) : null}
                      <ContextMenuItem onClick={() => loadLocalDirectory(localPath)}>
                        <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>刷新</span>
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>新建</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-40">
                          <ContextMenuItem onClick={() => {
                            setCreateFolderSide('local')
                            setShowCreateFolder(true)
                            setNewFolderName('')
                          }}>
                            <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>新建目录</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setCreateFileSide('local')
                            setShowCreateFile(true)
                            setNewFileName('')
                          }}>
                            <File className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>新建文件</span>
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuContent>
                  </ContextMenu>`;

content = content.replace(localListTarget, localListReplacement);
console.log("Local ContextMenu injected.");

// 2. Replace Remote ScrollArea block
const remoteLoadPos = content.indexOf("t('sftp_loading_remote')");
const remoteListStart = content.indexOf('<ScrollArea className="flex-1">', remoteLoadPos);
const remoteListEnd = content.indexOf('</ScrollArea>', remoteListStart) + '</ScrollArea>'.length;

const remoteListTarget = content.substring(remoteListStart, remoteListEnd);
const remoteListReplacement = `<ContextMenu>
                    <ContextMenuTrigger asChild>
                      <ScrollArea className="flex-1" onContextMenu={() => setRemoteContextMenuFile(null)}>
                        <div className="divide-none">
                          {filteredRemoteFiles.map((file) => {
                            const isSelected = selectedRemotePaths.has(file.path)
                            return (
                              <div
                                key={file.path}
                                onDoubleClick={() => {
                                  if (file.isDirectory) {
                                    loadRemoteDirectory(selectedServerId, file.path)
                                    setSelectedRemotePaths(new Set())
                                  } else {
                                    // 双击远程文件：触发下载
                                    handleDownloadFile(file)
                                  }
                                }}
                                onMouseDown={(e) => {
                                  if (e.button !== 0 && e.button !== 2) return
                                  const newSet = new Set(selectedRemotePaths)
                                  if (e.ctrlKey || e.metaKey) {
                                    if (newSet.has(file.path)) newSet.delete(file.path)
                                    else newSet.add(file.path)
                                  } else {
                                    if (e.button === 2 && newSet.has(file.path)) {
                                      return
                                    }
                                    newSet.clear()
                                    newSet.add(file.path)
                                  }
                                  setSelectedRemotePaths(newSet)
                                }}
                                onContextMenu={(e) => {
                                  e.stopPropagation()
                                  setRemoteContextMenuFile(file)
                                }}
                                className={cn(
                                  "grid grid-cols-[2.5fr_0.8fr_1fr_1.5fr_1.2fr_1fr] px-4 h-10 text-xs items-center cursor-pointer select-none transition-colors",
                                  isSelected ? "bg-blue-500/20 dark:bg-blue-950/40 font-semibold" : "hover:bg-accent/60"
                                )}
                              >
                                <div className="flex items-center gap-2.5 overflow-hidden pr-2">
                                  {renderFileIcon(file as any, "h-6 w-6")}
                                  <span className={cn("truncate", !file.isDirectory && "text-muted-foreground")}>{file.name}</span>
                                </div>
                                <span className="text-left text-[11px] text-muted-foreground font-mono pl-3">
                                  {file.name === '..' ? '' : (file.isDirectory ? '-' : formatFileSize(file.size))}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : t(getFileTypeLabel(file as any))}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : (file.modifiedTime || '-')}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : (file.permissions || '-')}
                                </span>
                                <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                  {file.name === '..' ? '' : (file.owner || '-')}
                                </span>
                              </div>
                            )
                          })}
                          {filteredRemoteFiles.length === 0 && (
                            <div className="py-12 text-center text-xs text-muted-foreground select-none">
                              {t('sftp_no_remote_files')}
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      {remoteContextMenuFile && remoteContextMenuFile.name !== '..' ? (
                        <>
                          <ContextMenuItem onClick={() => {
                            if (remoteContextMenuFile) {
                              handleDownloadFile(remoteContextMenuFile)
                            }
                          }}>
                            <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>传输到目标目录</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setRenameSide('remote')
                            setRenameTarget(remoteContextMenuFile as any)
                            setRenameValue(remoteContextMenuFile.name)
                          }}>
                            <Edit2 className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>重命名</span>
                          </ContextMenuItem>
                          <ContextMenuItem className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/30" onClick={() => {
                            setDeleteSide('remote')
                            setDeleteTarget(remoteContextMenuFile as any)
                          }}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            <span>删除</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => handleOpenPermissions(remoteContextMenuFile)}>
                            <Server className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>编辑权限</span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                        </>
                      ) : null}
                      <ContextMenuItem onClick={() => loadRemoteDirectory(selectedServerId, remotePath)}>
                        <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>刷新</span>
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>新建</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-40">
                          <ContextMenuItem onClick={() => {
                            setCreateFolderSide('remote')
                            setShowCreateFolder(true)
                            setNewFolderName('')
                          }}>
                            <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>新建目录</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setCreateFileSide('remote')
                            setShowCreateFile(true)
                            setNewFileName('')
                          }}>
                            <File className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>新建文件</span>
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    </ContextMenuContent>
                  </ContextMenu>`;

content = content.replace(remoteListTarget, remoteListReplacement);
console.log("Remote ContextMenu injected.");

// 3. Reconstruct Dialogs block at the end of the file
const confirmDialogsStart = content.indexOf('      {/* 3. 远程辅助模态对话框 */}');
const confirmDialogsEnd = content.indexOf('      {/* 浮动文件传输状态浮');

const dialogsReplacement = `      {/* 3. 远程与本地辅助模态对话框 */}
      {/* A. 确认删除 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('sftp_delete_confirm_title')}
        description={t('sftp_delete_confirm_desc').replace('{type}', deleteTarget?.isDirectory ? t('sftp_folder') : t('sftp_file')).replace('{name}', deleteTarget?.name || '')}
        confirmText={t('sftp_confirm_delete')}
        cancelText={t('sftp_cancel')}
        variant="destructive"
        onConfirm={deleteSide === 'local' ? handleDeleteLocal : handleDeleteRemote}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* B. 重命名 */}
      <ConfirmDialog
        open={!!renameTarget}
        title={t('sftp_rename_title')}
        description={t('sftp_rename_desc')}
        confirmText={t('sftp_rename')}
        cancelText={t('sftp_cancel')}
        onConfirm={renameSide === 'local' ? handleRenameLocal : handleRenameRemote}
        onCancel={() => {
          setRenameTarget(null)
          setRenameValue('')
        }}
      >
        <Input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          className="mt-2 text-xs"
          placeholder={t('sftp_input_name_placeholder')}
          autoFocus
        />
      </ConfirmDialog>

      {/* C. 新建文件夹 */}
      <ConfirmDialog
        open={showCreateFolder}
        title={t('sftp_create_folder_title')}
        description={t('sftp_create_folder_desc')}
        confirmText={t('sftp_create')}
        cancelText={t('sftp_cancel')}
        onConfirm={createFolderSide === 'local' ? handleCreateFolderLocal : handleCreateFolderRemote}
        onCancel={() => {
          setShowCreateFolder(false)
          setNewFolderName('')
        }}
      >
        <Input
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          className="mt-2 text-xs"
          placeholder={t('sftp_input_folder_placeholder')}
          autoFocus
        />
      </ConfirmDialog>

      {/* D. 新建文件 */}
      <ConfirmDialog
        open={showCreateFile}
        title="新建文件"
        description="请输入新建文件的名称："
        confirmText="创建"
        cancelText="取消"
        onConfirm={createFileSide === 'local' ? handleCreateFileLocal : handleCreateFileRemote}
        onCancel={() => {
          setShowCreateFile(false)
          setNewFileName('')
        }}
      >
        <Input
          type="text"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          className="mt-2 text-xs"
          placeholder="请输入文件名称"
          autoFocus
        />
      </ConfirmDialog>

      {/* E. 编辑权限与所有权 */}
      <Dialog open={!!permissionsTarget} onOpenChange={(open) => { if (!open) setPermissionsTarget(null) }}>
        <DialogContent className="max-w-[420px] rounded-xl p-5 border border-border/60 glass-strong">
          <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b">
            <DialogTitle className="text-sm font-bold text-foreground">
              Edit permissions
            </DialogTitle>
          </DialogHeader>

          {permissionsTarget && (
            <div className="flex flex-col gap-4 py-3 text-xs text-foreground">
              {/* Path */}
              <div className="text-[11px] text-muted-foreground font-mono truncate select-all">
                {permissionsTarget.path}
              </div>

              {/* Table */}
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] font-bold text-[11px] text-muted-foreground border-b pb-1">
                  <span>File Access</span>
                  <span className="text-center">Read</span>
                  <span className="text-center">Write</span>
                  <span className="text-center">Execute</span>
                </div>

                {/* Owner */}
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                  <span className="text-muted-foreground">Owner</span>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.owner.read}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        owner: { ...prev.owner, read: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.owner.write}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        owner: { ...prev.owner, write: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.owner.execute}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        owner: { ...prev.owner, execute: checked }
                      }))}
                    />
                  </div>
                </div>

                {/* Groups */}
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                  <span className="text-muted-foreground">Groups</span>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.group.read}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        group: { ...prev.group, read: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.group.write}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        group: { ...prev.group, write: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.group.execute}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        group: { ...prev.group, execute: checked }
                      }))}
                    />
                  </div>
                </div>

                {/* Others */}
                <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                  <span className="text-muted-foreground">Others</span>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.others.read}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        others: { ...prev.others, read: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.others.write}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        others: { ...prev.others, write: checked }
                      }))}
                    />
                  </div>
                  <div className="flex justify-center">
                    <Switch
                      checked={perms.others.execute}
                      onCheckedChange={(checked) => setPerms(prev => ({
                        ...prev,
                        others: { ...prev.others, execute: checked }
                      }))}
                    />
                  </div>
                </div>
              </div>

              {/* Ownership */}
              <div className="flex flex-col gap-2.5 mt-2 border-t pt-3">
                <span className="font-bold text-[11px] text-muted-foreground">Ownership</span>
                
                <div className="flex justify-between items-center h-8">
                  <span className="text-muted-foreground">User</span>
                  <input
                    type="text"
                    value={ownerUser}
                    onChange={(e) => setOwnerUser(e.target.value)}
                    className="bg-transparent text-right border-none outline-none font-mono text-[11px] text-foreground cursor-text max-w-[180px]"
                  />
                </div>

                <div className="flex justify-between items-center h-8">
                  <span className="text-muted-foreground">Group</span>
                  <input
                    type="text"
                    value={ownerGroup}
                    onChange={(e) => setOwnerGroup(e.target.value)}
                    className="bg-transparent text-right border-none outline-none font-mono text-[11px] text-foreground cursor-text max-w-[180px]"
                  />
                </div>

                {/* Recursive switch */}
                <div className="flex justify-between items-center h-8 border-t border-dashed pt-2.5 mt-1">
                  <span className="text-muted-foreground">Apply recursively</span>
                  <Switch
                    checked={permissionsRecursive}
                    onCheckedChange={setPermissionsRecursive}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-2 mt-4">
                <Button
                  onClick={handleSavePermissions}
                  size="sm"
                  className="rounded-lg px-4"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>\n\n`;

content = content.replace(content.substring(confirmDialogsStart, confirmDialogsEnd), dialogsReplacement);
console.log("Dialog blocks replaced successfully.");

fs.writeFileSync(filePath, content, 'utf8');
console.log("All ContextMenu rendering changes applied successfully!");
