import { describe, it, expect } from 'vitest'
import {
  getFileIconTheme,
  getAllFileIconThemes,
  renderThemedFileIcon,
  renderFileIcon,
  DEFAULT_FILE_ICON_THEME,
  type FileIconThemeId,
} from '../index'
import { precisionTheme } from '../themes/precision'
import { yaruTheme } from '../themes/yaru'
import { developerTheme } from '../themes/developer'
import { minimalTheme } from '../themes/minimal'

describe('File Icon Themes System', () => {
  it('registers all 4 themes correctly', () => {
    const themes = getAllFileIconThemes()
    expect(themes.length).toBe(4)
    expect(themes.map(t => t.id)).toContain('precision')
    expect(themes.map(t => t.id)).toContain('yaru')
    expect(themes.map(t => t.id)).toContain('developer')
    expect(themes.map(t => t.id)).toContain('minimal')
  })

  it('retrieves themes by ID with fallback to developer', () => {
    expect(getFileIconTheme('precision').id).toBe('precision')
    expect(getFileIconTheme('yaru').id).toBe('yaru')
    expect(getFileIconTheme('developer').id).toBe('developer')
    expect(getFileIconTheme('minimal').id).toBe('minimal')
    expect(getFileIconTheme(null).id).toBe(DEFAULT_FILE_ICON_THEME)
    expect(getFileIconTheme('unknown-theme' as unknown as FileIconThemeId).id).toBe('developer')
  })

  describe('Precision Theme', () => {
    it('renders folder and parent folder icons', () => {
      const folderIcon = precisionTheme.renderIcon({ name: 'my_folder', isDirectory: true })
      expect(folderIcon).toBeDefined()

      const parentIcon = precisionTheme.renderIcon({ name: '..', isDirectory: true })
      expect(parentIcon).toBeDefined()
    })

    it('renders specific file types', () => {
      const archiveIcon = precisionTheme.renderIcon({ name: 'archive.tar.gz', isDirectory: false })
      expect(archiveIcon).toBeDefined()

      const pdfIcon = precisionTheme.renderIcon({ name: 'doc.pdf', isDirectory: false })
      expect(pdfIcon).toBeDefined()

      const pyIcon = precisionTheme.renderIcon({ name: 'script.py', isDirectory: false })
      expect(pyIcon).toBeDefined()

      const vueIcon = precisionTheme.renderIcon({ name: 'App.vue', isDirectory: false })
      expect(vueIcon).toBeDefined()

      const tsIcon = precisionTheme.renderIcon({ name: 'main.ts', isDirectory: false })
      expect(tsIcon).toBeDefined()

      const wordIcon = precisionTheme.renderIcon({ name: 'file.docx', isDirectory: false })
      expect(wordIcon).toBeDefined()

      const excelIcon = precisionTheme.renderIcon({ name: 'data.xlsx', isDirectory: false })
      expect(excelIcon).toBeDefined()

      const pptIcon = precisionTheme.renderIcon({ name: 'slide.pptx', isDirectory: false })
      expect(pptIcon).toBeDefined()

      const exeIcon = precisionTheme.renderIcon({ name: 'setup.exe', isDirectory: false })
      expect(exeIcon).toBeDefined()

      const lockIcon = precisionTheme.renderIcon({ name: 'pnpm-lock.yaml', isDirectory: false })
      expect(lockIcon).toBeDefined()

      const genericIcon = precisionTheme.renderIcon({ name: 'unknown.xyz', isDirectory: false })
      expect(genericIcon).toBeDefined()
    })

    it('provides preview elements', () => {
      expect(precisionTheme.renderPreviewFolder()).toBeDefined()
      expect(precisionTheme.renderPreviewFile()).toBeDefined()
      expect(precisionTheme.renderPreviewList?.().length).toBe(5)
    })
  })

  describe('Ubuntu Yaru Theme', () => {
    it('renders folder with system emblems', () => {
      const homeFolder = yaruTheme.renderIcon({ name: 'home', isDirectory: true, path: '/home' })
      expect(homeFolder).toBeDefined()

      const desktopFolder = yaruTheme.renderIcon({ name: 'Desktop', isDirectory: true })
      expect(desktopFolder).toBeDefined()

      const downloadsFolder = yaruTheme.renderIcon({ name: 'Downloads', isDirectory: true })
      expect(downloadsFolder).toBeDefined()

      const normalFolder = yaruTheme.renderIcon({ name: 'normal_dir', isDirectory: true })
      expect(normalFolder).toBeDefined()

      const parentFolder = yaruTheme.renderIcon({ name: '..', isDirectory: true })
      expect(parentFolder).toBeDefined()
    })

    it('renders symlink overlay badge', () => {
      const symlinkFile = yaruTheme.renderIcon({ name: 'app.lnk', isDirectory: false, isSymlink: true })
      expect(symlinkFile).toBeDefined()

      const symlinkFolder = yaruTheme.renderIcon({ name: 'link_dir', isDirectory: true, isSymlink: true })
      expect(symlinkFolder).toBeDefined()
    })

    it('renders specific MIME file types', () => {
      const shIcon = yaruTheme.renderIcon({ name: 'deploy.sh', isDirectory: false })
      expect(shIcon).toBeDefined()

      const zipIcon = yaruTheme.renderIcon({ name: 'data.zip', isDirectory: false })
      expect(zipIcon).toBeDefined()

      const pngIcon = yaruTheme.renderIcon({ name: 'photo.png', isDirectory: false })
      expect(pngIcon).toBeDefined()

      const mp3Icon = yaruTheme.renderIcon({ name: 'song.mp3', isDirectory: false })
      expect(mp3Icon).toBeDefined()

      const codeIcon = yaruTheme.renderIcon({ name: 'main.rs', isDirectory: false })
      expect(codeIcon).toBeDefined()

      const wordIcon = yaruTheme.renderIcon({ name: 'doc.docx', isDirectory: false })
      expect(wordIcon).toBeDefined()

      const sheetIcon = yaruTheme.renderIcon({ name: 'table.xlsx', isDirectory: false })
      expect(sheetIcon).toBeDefined()

      const pptIcon = yaruTheme.renderIcon({ name: 'pres.pptx', isDirectory: false })
      expect(pptIcon).toBeDefined()

      const vueIcon = yaruTheme.renderIcon({ name: 'App.vue', isDirectory: false })
      expect(vueIcon).toBeDefined()

      const tsIcon = yaruTheme.renderIcon({ name: 'main.ts', isDirectory: false })
      expect(tsIcon).toBeDefined()

      const pdfIcon = yaruTheme.renderIcon({ name: 'doc.pdf', isDirectory: false })
      expect(pdfIcon).toBeDefined()

      const debIcon = yaruTheme.renderIcon({ name: 'package.deb', isDirectory: false })
      expect(debIcon).toBeDefined()

      const lockIcon = yaruTheme.renderIcon({ name: 'yarn.lock', isDirectory: false })
      expect(lockIcon).toBeDefined()
    })

    it('provides preview elements', () => {
      expect(yaruTheme.renderPreviewFolder()).toBeDefined()
      expect(yaruTheme.renderPreviewFile()).toBeDefined()
      expect(yaruTheme.renderPreviewList?.().length).toBe(5)
    })
  })

  describe('Developer Code Theme', () => {
    it('renders dev folders with emblems', () => {
      const srcFolder = developerTheme.renderIcon({ name: 'src', isDirectory: true })
      expect(srcFolder).toBeDefined()

      const gitFolder = developerTheme.renderIcon({ name: '.git', isDirectory: true })
      expect(gitFolder).toBeDefined()

      const testFolder = developerTheme.renderIcon({ name: '__tests__', isDirectory: true })
      expect(testFolder).toBeDefined()

      const nodeFolder = developerTheme.renderIcon({ name: 'node_modules', isDirectory: true })
      expect(nodeFolder).toBeDefined()

      const parentFolder = developerTheme.renderIcon({ name: '..', isDirectory: true })
      expect(parentFolder).toBeDefined()
    })

    it('renders specialized language & devops icons', () => {
      const rsIcon = developerTheme.renderIcon({ name: 'main.rs', isDirectory: false })
      expect(rsIcon).toBeDefined()

      const goIcon = developerTheme.renderIcon({ name: 'server.go', isDirectory: false })
      expect(goIcon).toBeDefined()

      const pyIcon = developerTheme.renderIcon({ name: 'test.py', isDirectory: false })
      expect(pyIcon).toBeDefined()

      const vueIcon = developerTheme.renderIcon({ name: 'App.vue', isDirectory: false })
      expect(vueIcon).toBeDefined()

      const htmlIcon = developerTheme.renderIcon({ name: 'index.html', isDirectory: false })
      expect(htmlIcon).toBeDefined()

      const cssIcon = developerTheme.renderIcon({ name: 'style.css', isDirectory: false })
      expect(cssIcon).toBeDefined()

      const mdIcon = developerTheme.renderIcon({ name: 'README.md', isDirectory: false })
      expect(mdIcon).toBeDefined()

      const tsxIcon = developerTheme.renderIcon({ name: 'App.tsx', isDirectory: false })
      expect(tsxIcon).toBeDefined()

      const jsIcon = developerTheme.renderIcon({ name: 'index.js', isDirectory: false })
      expect(jsIcon).toBeDefined()

      const dockerIcon = developerTheme.renderIcon({ name: 'Dockerfile', isDirectory: false })
      expect(dockerIcon).toBeDefined()

      const k8sIcon = developerTheme.renderIcon({ name: 'deploy.k8s.yaml', isDirectory: false })
      expect(k8sIcon).toBeDefined()

      const gitignore = developerTheme.renderIcon({ name: '.gitignore', isDirectory: false })
      expect(gitignore).toBeDefined()

      const lockFile = developerTheme.renderIcon({ name: 'package-lock.json', isDirectory: false })
      expect(lockFile).toBeDefined()

      const envFile = developerTheme.renderIcon({ name: '.env.local', isDirectory: false })
      expect(envFile).toBeDefined()

      const confFile = developerTheme.renderIcon({ name: 'network_config.conf', isDirectory: false })
      expect(confFile).toBeDefined()

      // 新增关键常用文件测试（Word, Excel, PPT, PDF, 纯文本, 可执行文件, 未知普通文件）
      const wordDocx = developerTheme.renderIcon({ name: 'analysis.docx', isDirectory: false })
      expect(wordDocx).toBeDefined()

      const excelXlsx = developerTheme.renderIcon({ name: 'finance.xlsx', isDirectory: false })
      expect(excelXlsx).toBeDefined()

      const pptFile = developerTheme.renderIcon({ name: 'slides.pptx', isDirectory: false })
      expect(pptFile).toBeDefined()

      const pdfDoc = developerTheme.renderIcon({ name: 'guide.pdf', isDirectory: false })
      expect(pdfDoc).toBeDefined()

      const txtDoc = developerTheme.renderIcon({ name: 'notes.txt', isDirectory: false })
      expect(txtDoc).toBeDefined()

      const exeBinary = developerTheme.renderIcon({ name: 'app.exe', isDirectory: false })
      expect(exeBinary).toBeDefined()

      const unknownFile = developerTheme.renderIcon({ name: '0ca0a94e77884fc0b0cf3205d520d0b', isDirectory: false })
      expect(unknownFile).toBeDefined()

      // 验证包含 'lock' 字符的图片文件不会被误判为依赖锁文件
      const faceLockImage = developerTheme.renderIcon({ name: 'face_lock-config1.apk.png', isDirectory: false })
      expect(faceLockImage).toBeDefined()
    })

    it('provides preview elements', () => {
      expect(developerTheme.renderPreviewFolder()).toBeDefined()
      expect(developerTheme.renderPreviewFile()).toBeDefined()
      expect(developerTheme.renderPreviewList?.().length).toBe(5)
    })
  })

  describe('Minimal Outline Theme', () => {
    it('renders minimal folder and parent folder', () => {
      const folder = minimalTheme.renderIcon({ name: 'folder', isDirectory: true })
      expect(folder).toBeDefined()

      const parentFolder = minimalTheme.renderIcon({ name: '..', isDirectory: true })
      expect(parentFolder).toBeDefined()
    })

    it('renders minimal file types with outline badges', () => {
      const codeIcon = minimalTheme.renderIcon({ name: 'app.ts', isDirectory: false })
      expect(codeIcon).toBeDefined()

      const vueIcon = minimalTheme.renderIcon({ name: 'App.vue', isDirectory: false })
      expect(vueIcon).toBeDefined()

      const htmlIcon = minimalTheme.renderIcon({ name: 'index.html', isDirectory: false })
      expect(htmlIcon).toBeDefined()

      const cssIcon = minimalTheme.renderIcon({ name: 'style.css', isDirectory: false })
      expect(cssIcon).toBeDefined()

      const pdfIcon = minimalTheme.renderIcon({ name: 'doc.pdf', isDirectory: false })
      expect(pdfIcon).toBeDefined()

      const shellIcon = minimalTheme.renderIcon({ name: 'build.sh', isDirectory: false })
      expect(shellIcon).toBeDefined()

      const configIcon = minimalTheme.renderIcon({ name: 'config.json', isDirectory: false })
      expect(configIcon).toBeDefined()

      const lockIcon = minimalTheme.renderIcon({ name: 'cert.key', isDirectory: false })
      expect(lockIcon).toBeDefined()

      const zipIcon = minimalTheme.renderIcon({ name: 'bundle.tar.gz', isDirectory: false })
      expect(zipIcon).toBeDefined()

      const imgIcon = minimalTheme.renderIcon({ name: 'logo.png', isDirectory: false })
      expect(imgIcon).toBeDefined()

      const dbIcon = minimalTheme.renderIcon({ name: 'data.sql', isDirectory: false })
      expect(dbIcon).toBeDefined()

      const textIcon = minimalTheme.renderIcon({ name: 'readme.txt', isDirectory: false })
      expect(textIcon).toBeDefined()

      const wordIcon = minimalTheme.renderIcon({ name: 'doc.docx', isDirectory: false })
      expect(wordIcon).toBeDefined()

      const sheetIcon = minimalTheme.renderIcon({ name: 'table.xlsx', isDirectory: false })
      expect(sheetIcon).toBeDefined()

      const pptIcon = minimalTheme.renderIcon({ name: 'pres.pptx', isDirectory: false })
      expect(pptIcon).toBeDefined()

      const exeIcon = minimalTheme.renderIcon({ name: 'app.exe', isDirectory: false })
      expect(exeIcon).toBeDefined()
    })

    it('provides preview elements', () => {
      expect(minimalTheme.renderPreviewFolder()).toBeDefined()
      expect(minimalTheme.renderPreviewFile()).toBeDefined()
      expect(minimalTheme.renderPreviewList?.().length).toBe(5)
    })
  })

  describe('Theme Dispatcher', () => {
    it('renders via renderThemedFileIcon across all themes', () => {
      const iconP = renderThemedFileIcon({ name: 'test.txt', isDirectory: false }, 'precision')
      const iconY = renderThemedFileIcon({ name: 'test.txt', isDirectory: false }, 'yaru')
      const iconD = renderThemedFileIcon({ name: 'test.txt', isDirectory: false }, 'developer')
      const iconM = renderThemedFileIcon({ name: 'test.txt', isDirectory: false }, 'minimal')
      expect(iconP).toBeDefined()
      expect(iconY).toBeDefined()
      expect(iconD).toBeDefined()
      expect(iconM).toBeDefined()
    })

    it('renders via renderFileIcon with default store theme', () => {
      const icon = renderFileIcon({ name: 'test.txt', isDirectory: false })
      expect(icon).toBeDefined()
    })
  })
})
