import fs from 'fs';

const filePath = './src/components/layout/sftp-panel.tsx';
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/\r\n/g, '\n');

// 1. Add context-menu, dialog and plugin-fs imports
const targetImports = "import { getParentPath,";
const replacementImports = `import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  mkdir as mkdirLocal,
  rename as renameLocal,
  remove as removeLocal,
  writeTextFile as writeLocal
} from '@tauri-apps/plugin-fs'
import { getParentPath,`;

content = content.replace(targetImports, replacementImports);
console.log("Imports added.");

// 2. Add Switch component code before export function SftpPanel()
const switchComponentCode = `// Custom Switch component for Edit Permissions UI
const Switch = ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-1"
        )}
      />
    </button>
  )
}

// Parser helper for ls -l permissions string (e.g. "-rwxr-xr-x")
const parsePermissions = (permString: string) => {
  const perms = {
    owner: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    others: { read: false, write: false, execute: false }
  }
  if (!permString || permString.length < 10) return perms;
  perms.owner.read = permString[1] === 'r';
  perms.owner.write = permString[2] === 'w';
  perms.owner.execute = permString[3] === 'x';
  perms.group.read = permString[4] === 'r';
  perms.group.write = permString[5] === 'w';
  perms.group.execute = permString[6] === 'x';
  perms.others.read = permString[7] === 'r';
  perms.others.write = permString[8] === 'w';
  perms.others.execute = permString[9] === 'x';
  return perms;
}

// Mode helper to convert perms back to octal string (e.g. "755")
const getOctalMode = (perms: ReturnType<typeof parsePermissions>) => {
  let ownerNum = 0;
  if (perms.owner.read) ownerNum += 4;
  if (perms.owner.write) ownerNum += 2;
  if (perms.owner.execute) ownerNum += 1;
  let groupNum = 0;
  if (perms.group.read) groupNum += 4;
  if (perms.group.write) groupNum += 2;
  if (perms.group.execute) groupNum += 1;
  let othersNum = 0;
  if (perms.others.read) othersNum += 4;
  if (perms.others.write) othersNum += 2;
  if (perms.others.execute) othersNum += 1;
  return \`\${ownerNum}\${groupNum}\${othersNum}\`;
}

export function SftpPanel() {`;

content = content.replace('export function SftpPanel() {', switchComponentCode);
console.log("Switch component and parser helpers injected.");

// 3. Inject states for context menus and local FS operations
const targetStates = "  const [copiedLocalIp, setCopiedLocalIp] = useState<boolean>(false)";
const replacementStates = `  const [copiedLocalIp, setCopiedLocalIp] = useState<boolean>(false)

  // Local/Remote context menu and operations states
  const [localContextMenuFile, setLocalContextMenuFile] = useState<LocalFileEntry | null>(null)
  const [remoteContextMenuFile, setRemoteContextMenuFile] = useState<FileEntry | null>(null)
  const [renameSide, setRenameSide] = useState<'local' | 'remote'>('local')
  const [deleteSide, setDeleteSide] = useState<'local' | 'remote'>('local')
  const [createFolderSide, setCreateFolderSide] = useState<'local' | 'remote'>('local')
  const [createFileSide, setCreateFileSide] = useState<'local' | 'remote'>('local')

  const [showCreateFile, setShowCreateFile] = useState<boolean>(false)
  const [newFileName, setNewFileName] = useState<string>('')

  // Edit Permissions states
  const [permissionsTarget, setPermissionsTarget] = useState<FileEntry | null>(null)
  const [perms, setPerms] = useState({
    owner: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    others: { read: false, write: false, execute: false }
  })
  const [ownerUser, setOwnerUser] = useState('')
  const [ownerGroup, setOwnerGroup] = useState('')
  const [permissionsRecursive, setPermissionsRecursive] = useState(false)`;

content = content.replace(targetStates, replacementStates);
console.log("Context menu states injected.");

// 4. Inject Local file system handlers before remote file handlers
const localHandlersTarget = `  // ── 远程文件管理操作 ──────────────────────────────────────────────────`;
const localHandlersCode = `  // ── 本地文件管理操作 ──────────────────────────────────────────────────
  // 1. 本地重命名
  const handleRenameLocal = async () => {
    if (!renameTarget || !renameValue.trim()) return
    try {
      const separator = renameTarget.path.includes('/') ? '/' : '\\\\'
      const lastIndex = renameTarget.path.lastIndexOf(separator)
      const newPathString = renameTarget.path.substring(0, lastIndex + 1) + renameValue.trim()
      await renameLocal(renameTarget.path, newPathString)
      setRenameTarget(null)
      setRenameValue('')
      loadLocalDirectory(localPath)
    } catch (err: any) {
      console.error('Failed to rename local file:', err)
      setLocalError(err.message || String(err))
    }
  }

  // 2. 本地删除
  const handleDeleteLocal = async () => {
    if (!deleteTarget) return
    try {
      await removeLocal(deleteTarget.path, { recursive: true })
      setDeleteTarget(null)
      loadLocalDirectory(localPath)
    } catch (err: any) {
      console.error('Failed to delete local file:', err)
      setLocalError(err.message || String(err))
    }
  }

  // 3. 本地创建文件夹
  const handleCreateFolderLocal = async () => {
    if (!newFolderName.trim()) return
    try {
      const separator = localPath.includes('/') ? '/' : '\\\\'
      const pathString = localPath.endsWith(separator) ? \`\${localPath}\${newFolderName.trim()}\` : \`\${localPath}\${separator}\${newFolderName.trim()}\`
      await mkdirLocal(pathString)
      setShowCreateFolder(false)
      setNewFolderName('')
      loadLocalDirectory(localPath)
    } catch (err: any) {
      console.error('Failed to create local directory:', err)
      setLocalError(err.message || String(err))
    }
  }

  // 4. 本地创建文件
  const handleCreateFileLocal = async () => {
    if (!newFileName.trim()) return
    try {
      const separator = localPath.includes('/') ? '/' : '\\\\'
      const pathString = localPath.endsWith(separator) ? \`\${localPath}\${newFileName.trim()}\` : \`\${localPath}\${separator}\${newFileName.trim()}\`
      await writeLocal(pathString, '')
      setShowCreateFile(false)
      setNewFileName('')
      loadLocalDirectory(localPath)
    } catch (err: any) {
      console.error('Failed to create local file:', err)
      setLocalError(err.message || String(err))
    }
  }

  // 5. 远程创建文件
  const handleCreateFileRemote = async () => {
    if (!newFileName.trim() || !selectedServerId) return
    try {
      const separator = remotePath.includes('\\\\') ? '\\\\' : '/'
      const pathString = remotePath.endsWith(separator) ? \`\${remotePath}\${newFileName.trim()}\` : \`\${remotePath}\${separator}\${newFileName.trim()}\`
      await sshService.writeFile(selectedServerId, pathString, '')
      setShowCreateFile(false)
      setNewFileName('')
      loadRemoteDirectory(selectedServerId, remotePath)
    } catch (err: any) {
      console.error('Failed to create remote file:', err)
      setRemoteError(err.message || String(err))
    }
  }

  // 6. 远程权限对话框加载
  const handleOpenPermissions = (file: FileEntry) => {
    setPermissionsTarget(file)
    const parsed = parsePermissions(file.permissions)
    setPerms(parsed)
    setOwnerUser(file.owner || '')
    setOwnerGroup(file.group || '')
    setPermissionsRecursive(false)
  }

  // 7. 远程权限对话框保存
  const handleSavePermissions = async () => {
    if (!permissionsTarget || !selectedServerId) return
    try {
      const mode = getOctalMode(perms)
      const permRes = await sshService.setPermissions(selectedServerId, permissionsTarget.path, mode, permissionsRecursive)
      if (!permRes.success) {
        throw new Error(permRes.stderr || 'Failed to update file permissions')
      }

      if (ownerUser !== permissionsTarget.owner || ownerGroup !== permissionsTarget.group) {
        const chownRes = await sshService.chownFile(
          selectedServerId,
          permissionsTarget.path,
          ownerUser,
          ownerGroup,
          permissionsRecursive
        )
        if (!chownRes.success) {
          throw new Error(chownRes.stderr || 'Failed to update ownership')
        }
      }

      setPermissionsTarget(null)
      loadRemoteDirectory(selectedServerId, remotePath)
    } catch (err: any) {
      console.error('Failed to save permissions:', err)
      setRemoteError(err.message || String(err))
    }
  }

  // ── 远程文件管理操作 ──────────────────────────────────────────────────`;

content = content.replace(localHandlersTarget, localHandlersCode);
console.log("Local handlers and remote permissions logic added.");

fs.writeFileSync(filePath, content, 'utf8');
console.log("Step 1 of code modifications completed successfully!");
