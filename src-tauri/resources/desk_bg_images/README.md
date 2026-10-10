# 预置终端背景资源目录

将预置的图片/视频文件放入此目录，会在打包时一并打包到应用安装目录。

## 命名规范

- 文件名使用英文小写 + 短横线分隔，如 `aurora-night.jpg`、`ocean-waves.mp4`
- 避免特殊字符和空格
- 视频建议 mp4 格式，图片建议 jpg/png/webp/gif

## 支持的文件类型

- 图片：.png .jpg .jpeg .webp .gif
- 视频：.mp4 .webm .ogv .mov

## 在 preset-backgrounds.ts 中注册

每个新增的预置背景需要在 `src/lib/preset-backgrounds.ts` 的 `PRESET_BACKGROUNDS` 数组中添加一项，指定：
- id：唯一标识
- filename：文件名（与目录中文件一致）
- type：'image' | 'video'
- name：显示名称（多语言通过 i18n key 或直接写）
