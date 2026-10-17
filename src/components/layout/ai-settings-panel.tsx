/**
 * src/components/layout/ai-settings-panel.tsx
 *
 * Qshell AIOps & Terminal Copilot 模型配置中心
 * 1. 提供商列表管理：已配置 (Configured) 与 热门提供商 (Popular Providers)
 * 2. 状态约束：已配置的服务商每次只能开启一个 (Single active provider)
 * 3. 健康检测：已配置服务商连通性与网络延迟探测 (⚡ 142ms)
 * 4. 交互式弹窗配置：动态拉取模型列表、参数自定义、测试连接并保存启用
 * 5. 端侧零信任安全防御与数据脱敏 (DLP)
 */

import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SelectPopover } from '@/components/ui/select-popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from '@/i18n'
import {
  useAIStore,
  getAssistantStorageStats,
  DEFAULT_MAX_ASSISTANT_SESSIONS,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
} from '@/store/ai-store'
import {
  AI_PROVIDER_PRESETS,
  type AIProvider,
  type AIProtocol,
  type ConfiguredProvider,
} from '@/types/ai'
import {
  Sparkles,
  Bot,
  KeyRound,
  Globe,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Zap,
  RefreshCw,
  Edit2,
  Pencil,
  Trash2,
  Plus,
  Sliders,
  Check,
  Layers,
  Activity,
  X,
  Terminal,
  Database,
  HardDrive,
  Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ==========================================
// 1. 服务商 Brand 图标组件
// ==========================================
function ProviderBrandIcon({
  provider,
  className,
}: {
  provider: AIProvider
  className?: string
}) {
  const iconClass = cn('w-4 h-4 shrink-0', className)

  switch (provider) {
    case 'deepseek':
      // DeepSeek 深度求索官方蓝鲸矢量徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"
            fill="#4D6BFE"
          />
        </svg>
      )
    case 'qwen':
      // 阿里通义千问官方几何六边莫比乌斯环徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <defs>
            <linearGradient id="qshell-brand-qwen" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6336E7" />
              <stop offset="100%" stopColor="#6F69F7" />
            </linearGradient>
          </defs>
          <path
            d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"
            fill="url(#qshell-brand-qwen)"
            fillRule="nonzero"
          />
        </svg>
      )
    case 'siliconflow':
      // 硅基流动 SiliconFlow / SiliconCloud 官方缎带 S 徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M22.956 6.521H12.522c-.577 0-1.044.468-1.044 1.044v3.13c0 .577-.466 1.044-1.043 1.044H1.044c-.577 0-1.044.467-1.044 1.044v4.174C0 17.533.467 18 1.044 18h10.434c.577 0 1.044-.467 1.044-1.043v-3.13c0-.578.466-1.044 1.043-1.044h9.391c.577 0 1.044-.467 1.044-1.044V7.565c0-.576-.467-1.044-1.044-1.044z"
            fill="#6E29F6"
          />
        </svg>
      )
    case 'glm':
      // 智谱 AI (Zhipu BigModel) 官方原子网络徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M11.991 23.503a.24.24 0 00-.244.248.24.24 0 00.244.249.24.24 0 00.245-.249.24.24 0 00-.22-.247l-.025-.001zM9.671 5.365a1.697 1.697 0 011.099 2.132l-.071.172-.016.04-.018.054c-.07.16-.104.32-.104.498-.035.71.47 1.279 1.186 1.314h.366c1.309.053 2.338 1.173 2.286 2.523-.052 1.332-1.152 2.38-2.478 2.327h-.174c-.715.018-1.274.64-1.239 1.368 0 .124.018.23.053.337.209.373.54.658.96.8.75.23 1.517-.125 1.9-.782l.018-.035c.402-.64 1.17-.96 1.92-.711.854.284 1.378 1.226 1.099 2.167a1.661 1.661 0 01-2.077 1.102 1.711 1.711 0 01-.907-.711l-.017-.035c-.2-.323-.463-.58-.851-.711l-.056-.018a1.646 1.646 0 00-1.954.746 1.66 1.66 0 01-1.065.764 1.677 1.677 0 01-1.989-1.279c-.209-.906.332-1.83 1.257-2.043a1.51 1.51 0 01.296-.035h.018c.68-.071 1.151-.622 1.116-1.333a1.307 1.307 0 00-.227-.693 2.515 2.515 0 01-.366-1.403 2.39 2.39 0 01.366-1.208c.14-.195.21-.444.227-.693.018-.71-.506-1.261-1.186-1.332l-.07-.018a1.43 1.43 0 01-.299-.07l-.05-.019a1.7 1.7 0 01-1.047-2.114 1.68 1.68 0 012.094-1.101zm-5.575 10.11c.26-.264.639-.367.994-.27.355.096.633.379.728.74.095.362-.007.748-.267 1.013-.402.41-1.053.41-1.455 0a1.062 1.062 0 010-1.482zm14.845-.294c.359-.09.738.024.992.297.254.274.344.665.237 1.025-.107.36-.396.634-.756.718-.551.128-1.1-.22-1.23-.781a1.05 1.05 0 01.757-1.26zm-.064-4.39c.314.32.49.753.49 1.206 0 .452-.176.886-.49 1.206-.315.32-.74.5-1.185.5-.444 0-.87-.18-1.184-.5a1.727 1.727 0 010-2.412 1.654 1.654 0 012.369 0zm-11.243.163c.364.484.447 1.128.218 1.691a1.665 1.665 0 01-2.188.923c-.855-.36-1.26-1.358-.907-2.228a1.68 1.68 0 011.33-1.038c.593-.08 1.183.169 1.547.652zm11.545-4.221c.368 0 .708.2.892.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.892.524c-.568 0-1.03-.47-1.03-1.048 0-.579.462-1.048 1.03-1.048zm-14.358 0c.368 0 .707.2.891.524.184.324.184.724 0 1.048a1.026 1.026 0 01-.891.524c-.569 0-1.03-.47-1.03-1.048 0-.579.461-1.048 1.03-1.048zm10.031-1.475c.925 0 1.675.764 1.675 1.706s-.75 1.705-1.675 1.705-1.674-.763-1.674-1.705c0-.942.75-1.706 1.674-1.706zm-2.626-.684c.362-.082.653-.356.761-.718a1.062 1.062 0 00-.238-1.028 1.017 1.017 0 00-.996-.294c-.547.14-.881.7-.752 1.257.13.558.675.907 1.225.783zm0 16.876c.359-.087.644-.36.75-.72a1.062 1.062 0 00-.237-1.019 1.018 1.018 0 00-.985-.301 1.037 1.037 0 00-.762.717c-.108.361-.017.754.239 1.028.245.263.606.377.953.305l.043-.01zM17.19 3.5a.631.631 0 00.628-.64c0-.355-.279-.64-.628-.64a.631.631 0 00-.628.64c0 .355.28.64.628.64zm-10.38 0a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64a.631.631 0 00-.628.64c0 .355.279.64.628.64zm-5.182 7.852a.631.631 0 00-.628.64c0 .354.28.639.628.639a.63.63 0 00.627-.606l.001-.034a.62.62 0 00-.628-.64zm5.182 9.13a.631.631 0 00-.628.64c0 .355.279.64.628.64a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm10.38.018a.631.631 0 00-.628.64c0 .355.28.64.628.64a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm5.182-9.148a.631.631 0 00-.628.64c0 .354.279.639.628.639a.631.631 0 00.628-.64c0-.355-.28-.64-.628-.64zm-.384-4.992a.24.24 0 00.244-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249c0 .142.122.249.244.249zM11.991.497a.24.24 0 00.245-.248A.24.24 0 0011.99 0a.24.24 0 00-.244.249c0 .133.108.236.223.247l.021.001zM2.011 6.36a.24.24 0 00.245-.249.24.24 0 00-.244-.249.24.24 0 00-.244.249.24.24 0 00.244.249zm0 11.263a.24.24 0 00-.243.248.24.24 0 00.244.249.24.24 0 00.244-.249.252.252 0 00-.244-.248zm19.995-.018a.24.24 0 00-.245.248.24.24 0 00.245.25.24.24 0 00.244-.25.252.252 0 00-.244-.248z"
            fill="#3859FF"
            fillRule="nonzero"
          />
        </svg>
      )
    case 'moonshot':
      // 月之暗面 Moonshot AI 官方日蚀光芒射线徽标
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn(iconClass, 'text-foreground')}>
          <path
            fillRule="evenodd"
            d="M1.052 16.916l9.539 2.552a21.007 21.007 0 00.06 2.033l5.956 1.593a11.997 11.997 0 01-5.586.865l-.18-.016-.044-.004-.084-.009-.094-.01a11.605 11.605 0 01-.157-.02l-.107-.014-.11-.016a11.962 11.962 0 01-.32-.051l-.042-.008-.075-.013-.107-.02-.07-.015-.093-.019-.075-.016-.095-.02-.097-.023-.094-.022-.068-.017-.088-.022-.09-.024-.095-.025-.082-.023-.109-.03-.062-.02-.084-.025-.093-.028-.105-.034-.058-.019-.08-.026-.09-.031-.066-.024a6.293 6.293 0 01-.044-.015l-.068-.025-.101-.037-.057-.022-.08-.03-.087-.035-.088-.035-.079-.032-.095-.04-.063-.028-.063-.027a5.655 5.655 0 01-.041-.018l-.066-.03-.103-.047-.052-.024-.096-.046-.062-.03-.084-.04-.086-.044-.093-.047-.052-.027-.103-.055-.057-.03-.058-.032a6.49 6.49 0 01-.046-.026l-.094-.053-.06-.034-.051-.03-.072-.041-.082-.05-.093-.056-.052-.032-.084-.053-.061-.039-.079-.05-.07-.047-.053-.035a7.785 7.785 0 01-.054-.036l-.044-.03-.044-.03a6.066 6.066 0 01-.04-.028l-.057-.04-.076-.054-.069-.05-.074-.054-.056-.042-.076-.057-.076-.059-.086-.067-.045-.035-.064-.052-.074-.06-.089-.073-.046-.039-.046-.039a7.516 7.516 0 01-.043-.037l-.045-.04-.061-.053-.07-.062-.068-.06-.062-.058-.067-.062-.053-.05-.088-.084a13.28 13.28 0 01-.099-.097l-.029-.028-.041-.042-.069-.07-.05-.051-.05-.053a6.457 6.457 0 01-.168-.179l-.08-.088-.062-.07-.071-.08-.042-.049-.053-.062-.058-.068-.046-.056a7.175 7.175 0 01-.027-.033l-.045-.055-.066-.082-.041-.052-.05-.064-.02-.025a11.99 11.99 0 01-1.44-2.402zm-1.02-5.794l11.353 3.037a20.468 20.468 0 00-.469 2.011l10.817 2.894a12.076 12.076 0 01-1.845 2.005L.657 15.923l-.016-.046-.035-.104a11.965 11.965 0 01-.05-.153l-.007-.023a11.896 11.896 0 01-.207-.741l-.03-.126-.018-.08-.021-.097-.018-.081-.018-.09-.017-.084-.018-.094c-.026-.141-.05-.283-.071-.426l-.017-.118-.011-.083-.013-.102a12.01 12.01 0 01-.019-.161l-.005-.047a12.12 12.12 0 01-.034-2.145zm1.593-5.15l11.948 3.196c-.368.605-.705 1.231-1.01 1.875l11.295 3.022c-.142.82-.368 1.612-.668 2.365l-11.55-3.09L.124 10.26l.015-.1.008-.049.01-.067.015-.087.018-.098c.026-.148.056-.295.088-.442l.028-.124.02-.085.024-.097c.022-.09.045-.18.07-.268l.028-.102.023-.083.03-.1.025-.082.03-.096.026-.082.031-.095a11.896 11.896 0 011.01-2.232zm4.442-4.4L17.352 4.59a20.77 20.77 0 00-1.688 1.721l7.823 2.093c.267.852.442 1.744.513 2.665L2.106 5.213l.045-.065.027-.04.04-.055.046-.065.055-.076.054-.072.064-.086.05-.065.057-.073.055-.07.06-.074.055-.069.065-.077.054-.066.066-.077.053-.06.072-.082.053-.06.067-.074.054-.058.073-.078.058-.06.063-.067.168-.17.1-.098.059-.056.076-.071a12.084 12.084 0 012.272-1.677zM12.017 0h.097l.082.001.069.001.054.002.068.002.046.001.076.003.047.002.06.003.054.002.087.005.105.007.144.011.088.007.044.004.077.008.082.008.047.005.102.012.05.006.108.014.081.01.042.006.065.01.207.032.07.012.065.011.14.026.092.018.11.022.046.01.075.016.041.01L14.7.3l.042.01.065.015.049.012.071.017.096.024.112.03.113.03.113.032.05.015.07.02.078.024.073.023.05.016.05.016.076.025.099.033.102.036.048.017.064.023.093.034.11.041.116.045.1.04.047.02.06.024.041.018.063.026.04.018.057.025.11.048.1.046.074.035.075.036.06.028.092.046.091.045.102.052.053.028.049.026.046.024.06.033.041.022.052.029.088.05.106.06.087.051.057.034.053.032.096.059.088.055.098.062.036.024.064.041.084.056.04.027.062.042.062.043.023.017c.054.037.108.075.161.114l.083.06.065.048.056.043.086.065.082.064.04.03.05.041.086.069.079.065.085.071c.712.6 1.353 1.283 1.909 2.031L7.222.994l.062-.027.065-.028.081-.034.086-.035c.113-.045.227-.09.341-.131l.096-.035.093-.033.084-.03.096-.031c.087-.03.176-.058.264-.085l.091-.027.086-.025.102-.03.085-.023.1-.026L9.04.37l.09-.023.091-.022.095-.022.09-.02.098-.021.091-.02.095-.018.092-.018.1-.018.091-.016.098-.017.092-.014.097-.015.092-.013.102-.013.091-.012.105-.012.09-.01.105-.01c.093-.01.186-.018.28-.024l.106-.008.09-.005.11-.006.093-.004.1-.004.097-.002.099-.002.197-.002z"
          />
        </svg>
      )
    case 'ollama':
      // Ollama 官方立耳羊驼剪影徽标
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn(iconClass, 'text-foreground')}>
          <path
            fillRule="evenodd"
            d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.134-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z"
          />
        </svg>
      )
    case 'openai':
      // OpenAI 官方旋转罗盘涡旋花瓣徽标
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn(iconClass, 'text-[#10A37F]')}>
          <path
            fillRule="evenodd"
            d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"
          />
        </svg>
      )
    case 'anthropic':
      // Anthropic (Claude) 官方陶土色八角星芒徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
            fill="#D97757"
            fillRule="nonzero"
          />
        </svg>
      )
    case 'gemini':
      // Google Gemini 官方绚丽四芒星徽标
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <defs>
            <linearGradient id="qshell-gemini-0" x1="7" y1="15.5" x2="11" y2="12" gradientUnits="userSpaceOnUse">
              <stop stopColor="#08B962" />
              <stop offset="1" stopColor="#08B962" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="qshell-gemini-1" x1="8" y1="5.5" x2="11.5" y2="11" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F94543" />
              <stop offset="1" stopColor="#F94543" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="qshell-gemini-2" x1="3.5" y1="13.5" x2="17.5" y2="12" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FABC12" />
              <stop offset="0.46" stopColor="#FABC12" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
            fill="#3186FF"
          />
          <path
            d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
            fill="url(#qshell-gemini-0)"
          />
          <path
            d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
            fill="url(#qshell-gemini-1)"
          />
          <path
            d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"
            fill="url(#qshell-gemini-2)"
          />
        </svg>
      )
    case 'groq':
      // Groq 官方加速跃迁 'g' 徽标
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn(iconClass, 'text-[#F55036]')}>
          <path
            fillRule="evenodd"
            d="M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z"
          />
        </svg>
      )
    default:
      return <Sliders className={cn('text-muted-foreground', iconClass)} />
  }
}

// ==========================================
// 2. 标签徽章组件 (TagBadge)
// ==========================================
function TagBadge({
  text,
  type = 'custom',
}: {
  text: string
  type?: 'recommended' | 'domestic' | 'offline' | 'speed' | 'custom' | 'global' | 'official'
}) {
  const colorMap: Record<string, string> = {
    recommended: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    domestic: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
    offline: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25',
    speed: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    global: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    official: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    custom: 'bg-muted/80 text-muted-foreground border-border/60',
  }

  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded font-medium border leading-none shrink-0 inline-flex items-center justify-center',
        colorMap[type] || colorMap.custom,
      )}
    >
      {text}
    </span>
  )
}

// ==========================================
// 3. 配置提供商模态弹窗 (ConfigureProviderModal)
// ==========================================
interface ConfigureModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProvider: ConfiguredProvider | null
  presetProviderKey: AIProvider | null
  onSave: (
    data: Partial<ConfiguredProvider> & { provider: AIProvider },
    activate: boolean,
  ) => void
}

function ConfigureProviderModal({
  open,
  onOpenChange,
  editingProvider,
  presetProviderKey,
  onSave,
}: ConfigureModalProps) {
  const { t } = useTranslation()
  const {
    customModelsMap,
    testProviderConfig,
    fetchModelsForConfig,
  } = useAIStore()

  // 提供商 Key (优先取编辑项，否则取预设项)
  const providerKey = editingProvider?.provider || presetProviderKey || 'deepseek'
  const preset = AI_PROVIDER_PRESETS[providerKey]

  // 表单状态
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [protocol, setProtocol] = useState<AIProtocol>('openai')

  const [showApiKey, setShowApiKey] = useState(false)
  const [isManualInput, setIsManualInput] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    latencyMs?: number
    error?: string
  } | null>(null)

  // 模型拉取状态
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [maxTokens, setMaxTokens] = useState<number>(8192)

  // 当弹窗打开时回填表单
  React.useEffect(() => {
    if (!open) return

    setTestResult(null)
    setFetchError(null)

    if (editingProvider) {
      setName(editingProvider.name)
      setBaseUrl(editingProvider.baseUrl)
      setApiKey(editingProvider.apiKey)
      setModel(editingProvider.model)
      setProtocol(editingProvider.protocol)
      setMaxTokens(editingProvider.maxTokens ?? 8192)
    } else if (preset) {
      setName(preset.name)
      setBaseUrl(preset.defaultBaseUrl)
      setApiKey('')
      setModel(preset.defaultModel)
      setProtocol(preset.protocol)
      setMaxTokens(8192)
    }

    // 载入已有缓存模型
    const cached = customModelsMap[providerKey] || []
    setFetchedModels(cached)
    setIsManualInput(cached.length === 0)
  }, [open, editingProvider, preset, providerKey, customModelsMap])

  // 执行连通性测试
  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testProviderConfig({
        provider: providerKey,
        protocol,
        baseUrl,
        apiKey,
        model,
      })
      setTestResult(res)
    } finally {
      setIsTesting(false)
    }
  }

  // 动态拉取模型列表
  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setFetchError(null)
    try {
      const models = await fetchModelsForConfig({
        provider: providerKey,
        protocol,
        baseUrl,
        apiKey,
      })
      setFetchedModels(models)
      if (models.length > 0) {
        setIsManualInput(false)
        if (!model || !models.includes(model)) {
          setModel(models[0])
        }
      }
    } catch (err: unknown) {
      setFetchError((err as Error)?.message || t('ai_fetch_models_failed'))
    } finally {
      setIsFetchingModels(false)
    }
  }

  // 保存动作
  const handleSubmit = (activate: boolean) => {
    onSave(
      {
        id: editingProvider?.id,
        provider: providerKey,
        name: name.trim() || preset?.name || providerKey,
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || preset?.defaultModel || 'default',
        maxTokens,
      },
      activate,
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-xl border border-border/80 shadow-2xl bg-background">
        {/* Header */}
        <DialogHeader className="p-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-background border border-border/60 shadow-2xs">
              <ProviderBrandIcon provider={providerKey} className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                {editingProvider
                  ? t('ai_config_dialog_title_edit', { provider: preset?.name || providerKey })
                  : t('ai_config_dialog_title_create', { provider: preset?.name || providerKey })}
                <TagBadge
                  text={preset?.tagText || (editingProvider ? t('ai_tag_custom') : t('ai_tag_official'))}
                  type={preset?.tagType || 'custom'}
                />
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t('ai_config_dialog_subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto text-xs">
          {/* 提供商别名 */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              {t('ai_config_name_label')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={preset?.name || 'My AI Provider'}
              className="h-8 text-xs font-medium"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t('ai_base_url_label')}
              </label>
              {preset?.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => setBaseUrl(preset.defaultBaseUrl)}
                  className="text-[11px] text-primary hover:underline"
                >
                  {t('ai_reset_default_url')}
                </button>
              )}
            </div>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={preset?.defaultBaseUrl || 'https://api.openai.com/v1'}
              className="h-8 text-xs font-mono"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                {t('ai_api_key_label')}
              </label>
              {preset?.websiteUrl && (
                <a
                  href={preset.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-primary hover:underline flex items-center gap-1"
                >
                  {t('ai_get_api_key_link')}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={providerKey === 'ollama' ? 'Ollama 本地无需 API Key' : 'sk-...'}
                className="h-8 text-xs font-mono pr-9"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              {t('ai_api_key_security_notice')}
            </p>
          </div>

          {/* 模型选择与拉取 */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="font-medium text-foreground">
                  {t('ai_model_name_label')}
                </label>
                {fetchedModels.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-medium border border-emerald-500/20">
                    {t('ai_models_count', { count: fetchedModels.length })}
                  </span>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isFetchingModels}
                onClick={() => void handleFetchModels()}
                className="h-6 px-2 text-[11px] gap-1 hover:text-primary hover:border-primary/50 text-foreground"
              >
                <RefreshCw className={cn('h-3 w-3', isFetchingModels && 'animate-spin text-primary')} />
                <span>
                  {isFetchingModels ? t('ai_fetching_models') : t('ai_fetch_models_btn')}
                </span>
              </Button>
            </div>

            {/* 下拉选择 or 手动输入 */}
            {fetchedModels.length > 0 && !isManualInput ? (
              <div className="flex items-center gap-2">
                <SelectPopover
                  value={model || null}
                  onChange={(val) => {
                    if (val) setModel(val)
                  }}
                  options={fetchedModels.map((m) => ({
                    value: m,
                    label: m,
                  }))}
                  searchable
                  searchPlaceholder={t('ai_select_model_placeholder')}
                  placeholder={t('ai_select_model_placeholder')}
                  className="flex-1 h-8 text-xs font-mono"
                  panelClassName="w-[360px] max-h-72"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsManualInput(true)}
                  className="h-8 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
                  title={t('ai_custom_model_mode')}
                >
                  <Edit2 className="h-3 w-3" />
                  <span className="hidden sm:inline">{t('ai_custom_model_mode')}</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={preset?.defaultModel || 'deepseek-chat'}
                  className="h-8 text-xs font-mono flex-1"
                />
                {fetchedModels.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsManualInput(false)}
                    className="h-8 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
                    title="从已拉取列表中选择"
                  >
                    <Layers className="h-3 w-3" />
                    <span className="hidden sm:inline">选择列表</span>
                  </Button>
                )}
              </div>
            )}

            {/* 拉取失败错误提示 */}
            {fetchError && (
              <div className="text-[11px] text-destructive flex items-center gap-1.5 pt-0.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{fetchError}</span>
              </div>
            )}

            {/* 推荐模型标签 */}
            {preset?.recommendedModels && preset.recommendedModels.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground">{t('ai_recommended_models')}:</span>
                {preset.recommendedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors',
                      model === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 单次最大回复 Token 限制 (Max Tokens) */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                单次最大生成 Token (Max Tokens)
              </label>
              <span className="text-[11px] font-mono text-primary font-semibold">
                {maxTokens} Tokens
              </span>
            </div>
            <div className="flex items-center gap-2">
              {[2048, 4096, 8192, 16384].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setMaxTokens(val)}
                  className={cn(
                    'text-[10.5px] font-mono py-1 px-2 rounded-md border transition-all flex-1 text-center',
                    maxTokens === val
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-2xs'
                      : 'border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  {val >= 1024 ? `${val / 1024}k` : val}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/80 leading-normal">
              推荐 8192（针对 DeepSeek-R1 / Qwen 等长思维链模型，充足的 Token 配额可杜绝集群巡检时思维链截断卡死）。
            </p>
          </div>

          {/* 连通性测试按钮与反馈 */}
          <div className="pt-2 border-t border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isTesting}
                onClick={() => void handleTestConnection()}
                className="h-7 px-2.5 text-xs gap-1.5 font-medium border-border/80 hover:bg-primary/10 hover:text-primary transition-all"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span>{t('ai_testing_connection')}</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span>{t('ai_test_connection_btn')}</span>
                  </>
                )}
              </Button>

              {testResult && (
                <div className="text-xs">
                  {testResult.success ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('ai_test_success_msg', { latency: testResult.latencyMs || 0 })}
                    </span>
                  ) : (
                    <span className="text-destructive font-medium flex items-center gap-1 truncate max-w-xs" title={testResult.error}>
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {testResult.error || t('ai_test_failed_msg')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('modal_close_esc')}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSubmit(false)}
            className="h-8 px-3 text-xs font-medium border-border/80 hover:bg-muted"
          >
            {t('ai_save_only_btn')}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => handleSubmit(true)}
            className="h-8 px-3.5 text-xs font-medium gap-1.5 bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('ai_save_and_enable_btn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ==========================================
// 4. 主面板组件 (AISettingsPanel)
// ==========================================
export function AISettingsPanel() {
  const { t } = useTranslation()
  const {
    settings,
    updateSettings,
    configuredProviders,
    testingProviderId,
    saveConfiguredProvider,
    removeConfiguredProvider,
    toggleActiveProvider,
    testConfiguredProvider,
    enableAiGlobal,
    setEnableAiGlobal,
    showFloatingMascot,
    setShowFloatingMascot,
    assistantSessions,
    clearAllAssistantSessions,
  } = useAIStore()

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ConfiguredProvider | null>(null)
  const [selectedPresetKey, setSelectedPresetKey] = useState<AIProvider | null>(null)

  // 清空所有历史会话确认弹窗状态
  const [isClearHistoryConfirmOpen, setIsClearHistoryConfirmOpen] = useState(false)
  const storageStats = getAssistantStorageStats(assistantSessions)

  // 删除确认状态
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // 自定义指令黑名单输入状态
  const [newBlacklistInput, setNewBlacklistInput] = useState('')

  const handleAddCustomBlacklist = () => {
    const raw = newBlacklistInput.trim()
    if (!raw) return
    const items = raw
      .split(/[,，\n]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    const current = settings.customBlacklist || []
    const merged = Array.from(new Set([...current, ...items]))
    updateSettings({ customBlacklist: merged })
    setNewBlacklistInput('')
  }

  const handleRemoveCustomBlacklist = (kw: string) => {
    const current = settings.customBlacklist || []
    updateSettings({ customBlacklist: current.filter((k) => k !== kw) })
  }

  const handleOpenCreate = (presetKey: AIProvider) => {
    setEditingProvider(null)
    setSelectedPresetKey(presetKey)
    setModalOpen(true)
  }

  const handleOpenEdit = (provider: ConfiguredProvider) => {
    setSelectedPresetKey(null)
    setEditingProvider(provider)
    setModalOpen(true)
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-12">
      {/* 顶部标题区 */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
          {t('ai_providers_section_title')}
        </h2>
      </div>

      {/* 0. 全局 AI 功能总开关 (Master Switch) */}
      <Card className="border border-border/80 bg-gradient-to-r from-primary/5 via-background to-background rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground">
                  {t('ai_master_switch_title')}
                </span>
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.2 rounded-full font-medium',
                    enableAiGlobal
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      : 'bg-muted text-muted-foreground border border-border',
                  )}
                >
                  {enableAiGlobal ? t('ai_status_enabled') : t('lg_pause')}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_master_switch_desc')}
              </p>
            </div>
          </div>

          <Switch
            checked={enableAiGlobal}
            onCheckedChange={setEnableAiGlobal}
            className="shrink-0"
          />
        </CardContent>
      </Card>

      {!enableAiGlobal ? (
        /* 全局禁用状态提示 */
        <div className="p-8 rounded-xl border border-dashed border-border/80 bg-muted/20 text-center flex flex-col items-center justify-center space-y-2">
          <div className="p-3 rounded-full bg-muted/60 text-muted-foreground">
            <Bot className="h-5 w-5" />
          </div>
          <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
            {t('ai_master_disabled_notice')}
          </p>
        </div>
      ) : (
        <>
          {/* 1. 已配置卡片区 (Configured Providers) */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-foreground">
              {t('ai_configured_section_title')}
            </span>

            <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
          {configuredProviders.length === 0 ? (
            <CardContent className="p-8 text-center flex flex-col items-center justify-center space-y-2">
              <div className="p-3 rounded-full bg-muted/60 text-muted-foreground">
                <Bot className="h-5 w-5" />
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                {t('ai_configured_empty_tip')}
              </p>
            </CardContent>
          ) : (
            <div className="divide-y divide-border/40">
              {configuredProviders.map((item) => {
                const isTestingThis = testingProviderId === item.id
                const preset = AI_PROVIDER_PRESETS[item.provider]

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'px-4 py-2.5 flex items-center justify-between gap-3 transition-colors',
                      item.isEnabled
                        ? 'bg-primary/5 hover:bg-primary/8'
                        : 'hover:bg-muted/30',
                    )}
                  >
                    {/* 左侧：图标 + 名称 + 标签 + 模型 */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-background border border-border/60 shadow-2xs shrink-0">
                        <ProviderBrandIcon provider={item.provider} className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                            {item.name}
                          </span>
                          <TagBadge
                            text={preset?.tagText || t('ai_tag_custom')}
                            type={preset?.tagType || 'custom'}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[260px]">
                          {item.model || 'default'}
                        </div>
                      </div>
                    </div>

                    {/* 右侧：健康检测 + 单选启用 + 编辑 + 删除 */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* 健康检测按钮与延迟显示（固定宽度 w-[84px]，防止悬停与状态切换抖动） */}
                      {isTestingThis ? (
                        <div className="h-7 w-[84px] shrink-0 rounded border border-border/60 bg-background text-[11px] text-primary flex items-center justify-center gap-1 font-mono">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span>{t('ai_test_pinging')}</span>
                        </div>
                      ) : item.lastTestStatus === 'success' ? (
                        <button
                          type="button"
                          onClick={() => void testConfiguredProvider(item.id)}
                          title="点击重新检测延迟"
                          className="h-7 w-[84px] shrink-0 rounded border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-mono flex items-center justify-center gap-1 transition-colors"
                        >
                          <Zap className="h-3 w-3 shrink-0" />
                          <span>⚡ {item.lastLatencyMs || 0}ms</span>
                        </button>
                      ) : item.lastTestStatus === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => void testConfiguredProvider(item.id)}
                          title={item.lastTestError || '连接失败，点击重新检测'}
                          className="h-7 w-[84px] shrink-0 rounded border border-destructive/25 bg-destructive/10 hover:bg-destructive/20 text-destructive text-[11px] flex items-center justify-center gap-1 transition-colors"
                        >
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          <span>{t('ai_test_failed_msg')}</span>
                        </button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void testConfiguredProvider(item.id)}
                          className="h-7 w-[84px] shrink-0 text-[11px] gap-1 text-muted-foreground hover:text-foreground hover:border-primary/40 justify-center"
                        >
                          <Activity className="h-3 w-3" />
                          <span>{t('ai_test_ping_btn')}</span>
                        </Button>
                      )}

                      {/* 单选启用/停用按钮（固定宽度 w-[68px]，杜绝悬浮文案替换引发的反复抖动） */}
                      {item.isEnabled ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActiveProvider(item.id)}
                          className="h-7 w-[68px] shrink-0 text-xs font-medium border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/35 transition-colors gap-1 justify-center"
                          title={t('ai_status_disable_hint')}
                        >
                          <Check className="h-3.5 w-3.5 shrink-0" />
                          <span>{t('ai_status_enabled')}</span>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActiveProvider(item.id)}
                          className="h-7 w-[68px] shrink-0 text-xs font-medium border-border/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors justify-center"
                          title={t('ai_status_enable_hint')}
                        >
                          <span>{t('ai_status_enable_btn')}</span>
                        </Button>
                      )}

                      {/* 编辑按钮 */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleOpenEdit(item)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={t('ai_edit_btn')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>

                      {/* 删除按钮 */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteId(item.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={t('ai_delete_btn')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 2. 热门提供商卡片区 (Popular Providers) */}
      <div className="space-y-2 pt-2">
        <span className="text-xs font-semibold text-foreground">
          {t('ai_popular_section_title')}
        </span>

        <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs divide-y divide-border/40">
          {(Object.keys(AI_PROVIDER_PRESETS) as AIProvider[]).map((key) => {
            const preset = AI_PROVIDER_PRESETS[key]

            return (
              <div
                key={key}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                {/* 左侧：图标 + 名称 + 标签 */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-background border border-border/60 shadow-2xs shrink-0">
                    <ProviderBrandIcon provider={key} className="w-4 h-4" />
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-foreground truncate">
                      {preset.name}
                    </span>
                    <TagBadge text={preset.tagText} type={preset.tagType} />
                  </div>
                </div>

                {/* 右侧：+ 连接 按钮 */}
                <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenCreate(key)}
                    className="h-7 px-3 text-xs font-medium border-border/80 hover:bg-background hover:text-primary hover:border-primary/40 shadow-2xs gap-1 transition-all"
                  >
                    <Plus className="h-3 w-3" />
                    <span>{t('ai_connect_btn')}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </Card>
      </div>

      {/* 3. 安全防护与隐私脱敏 (DLP) */}
      <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-5 space-y-4">
          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {t('ai_security_and_dlp_title')}
          </div>

          {/* DLP 脱敏开关 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-foreground">
                {t('ai_dlp_switch_title')}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_dlp_switch_desc')}
              </p>
            </div>
            <Switch
              checked={settings.enableDlp}
              onCheckedChange={(checked) => updateSettings({ enableDlp: checked })}
            />
          </div>

          {/* 内网 IP 模糊化开关 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-foreground">
                {t('ai_mask_private_ip_title')}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_mask_private_ip_desc')}
              </p>
            </div>
            <Switch
              checked={settings.maskPrivateIps}
              onCheckedChange={(checked) => updateSettings({ maskPrivateIps: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. 终端安全决策网关与执行策略 (Option C Command Guard & Execution Policy) */}
      <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-5 space-y-4">
          <div className="space-y-1">
            <div className="font-semibold text-xs text-foreground flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>{t('ai_cmd_guard_title') || 'AI 终端安全执行与只读白名单网关'}</span>
              </div>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                Option C 智能受控
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t('ai_cmd_guard_desc') ||
                '控制 AI 助手在远程服务器上执行指令的权限。内置严格只读白名单与防深度遍历 I/O 阻塞防护，确保生产服务器 100% 安全。'}
            </p>
          </div>

          {/* 3 种执行模式选择卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {/* 1. 询问确认模式 (推荐) */}
            <div
              data-testid="exec-mode-ask"
              onClick={() => updateSettings({ executionMode: 'ask' })}
              className={cn(
                'p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-2',
                (settings.executionMode || 'ask') === 'ask'
                  ? 'border-primary bg-primary/10 shadow-2xs ring-1 ring-primary/30'
                  : 'border-border/60 bg-background/60 hover:bg-muted/40 hover:border-border',
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">
                    {t('ai_exec_mode_ask') || '询问确认模式 (推荐)'}
                  </span>
                  <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-primary/20 text-primary font-medium">
                    推荐
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t('ai_exec_mode_ask_desc') ||
                    'AI 提议只读诊断指令时，在会话中以卡片展示，由您确认后才在终端安全执行并输出诊断分析。'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-primary font-medium pt-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>交互授权安全可控</span>
              </div>
            </div>

            {/* 2. 安全只读自动执行模式 */}
            <div
              data-testid="exec-mode-auto-readonly"
              onClick={() => updateSettings({ executionMode: 'auto_readonly' })}
              className={cn(
                'p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-2',
                settings.executionMode === 'auto_readonly'
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-2xs ring-1 ring-emerald-500/30'
                  : 'border-border/60 bg-background/60 hover:bg-muted/40 hover:border-border',
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">
                    {t('ai_exec_mode_auto_readonly') || '安全只读自动执行'}
                  </span>
                  <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium">
                    极速
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t('ai_exec_mode_auto_readonly_desc') ||
                    '通过内核只读白名单与深度限制校验的无风险查询，AI 自动在当前会话执行并直接给出诊断结论。'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium pt-1">
                <Zap className="h-3 w-3" />
                <span>仅限受限只读白名单</span>
              </div>
            </div>

            {/* 3. 禁止 AI 执行终端指令 */}
            <div
              data-testid="exec-mode-disabled"
              onClick={() => updateSettings({ executionMode: 'disabled' })}
              className={cn(
                'p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-2',
                settings.executionMode === 'disabled'
                  ? 'border-zinc-500 bg-zinc-500/10 shadow-2xs ring-1 ring-zinc-500/30'
                  : 'border-border/60 bg-background/60 hover:bg-muted/40 hover:border-border',
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">
                    {t('ai_exec_mode_disabled') || '禁止 AI 执行指令'}
                  </span>
                  <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-medium">
                    只读问答
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t('ai_exec_mode_disabled_desc') ||
                    'AI 仅生成排查建议文本，不提供任何在终端执行命令的能力。'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium pt-1">
                <ShieldCheck className="h-3 w-3" />
                <span>纯文本模式</span>
              </div>
            </div>
          </div>

          {/* 内置只读安全防御规范清单 */}
          <div className="p-3 rounded-lg border border-border/50 bg-background/40 space-y-1.5">
            <span className="text-xs font-medium text-foreground block">
              🛡️ {t('ai_cmd_guard_highlights_title') || '端侧只读安全防御机制'}
            </span>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
              <li>{t('ai_cmd_guard_hl_whitelist')}</li>
              <li>{t('ai_cmd_guard_hl_no_mutation')}</li>
              <li>{t('ai_cmd_guard_hl_anti_hang')}</li>
              <li>{t('ai_cmd_guard_hl_sensitive')}</li>
            </ul>
          </div>

          {/* 自定义安全黑名单 */}
          <div className="p-3 rounded-lg border border-border/50 bg-background/50 space-y-2.5">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                {t('ai_custom_blacklist_title') || '自定义安全黑名单'}
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_custom_blacklist_desc') ||
                  '输入您希望额外严格禁止 AI 执行的关键词、指令或路径，用回车或逗号分隔：'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                data-testid="custom-blacklist-input"
                value={newBlacklistInput}
                onChange={(e) => setNewBlacklistInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddCustomBlacklist()
                  }
                }}
                placeholder={
                  t('ai_custom_blacklist_placeholder') ||
                  '例如：prod-db, /data/secret, truncate, drop, reboot'
                }
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="custom-blacklist-add-btn"
                onClick={handleAddCustomBlacklist}
                className="h-8 px-3 text-xs gap-1 cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('ai_custom_blacklist_add_btn') || '添加'}</span>
              </Button>
            </div>

            {/* 当前已配置的自定义黑名单标签 */}
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5 min-h-[24px]">
              {(settings.customBlacklist || []).length === 0 ? (
                <span className="text-[11px] text-muted-foreground/60 italic">
                  {t('ai_custom_blacklist_empty') || '暂无自定义黑名单关键词'}
                </span>
              ) : (
                (settings.customBlacklist || []).map((keyword) => (
                  <span
                    key={keyword}
                    data-testid={`blacklist-tag-${keyword}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-destructive/10 text-destructive text-[11px] font-mono border border-destructive/20"
                  >
                    <span>{keyword}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomBlacklist(keyword)}
                      className="hover:text-destructive/70 cursor-pointer ml-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 5. 全局悬浮 AI 助手 (Global Floating AI Assistant) */}
      <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-5 space-y-4">
          <div className="font-semibold text-xs text-foreground flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>{t('ai_floating_mascot_title')}</span>
            </div>
            <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-normal">
              Ctrl+Alt+A
            </span>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-foreground">
                {t('ai_floating_mascot_enable')}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_floating_mascot_desc')}
              </p>
            </div>
            <Switch
              checked={showFloatingMascot}
              onCheckedChange={setShowFloatingMascot}
            />
          </div>
        </CardContent>
      </Card>

      {/* 6. AI 问答记录存储与滚动淘汰策略 (AI Chat Storage & Rolling Retention) */}
      <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-5 space-y-4">
          <div className="font-semibold text-xs text-foreground flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Database className="h-4 w-4 text-primary" />
              <span>{t('ai_storage_limit_title') || '问答记录本地存储与滚动淘汰'}</span>
            </div>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
              FIFO 自动滚动淘汰
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t('ai_storage_limit_desc') ||
              '限制本地保留的历史会话与问答条数，超出上限时自动滚动淘汰最早的旧记录，防止占用过多空间。'}
          </p>

          {/* 存储占用统计与一键清理 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-primary" />
                <span>
                  当前已存储 <span className="font-mono text-primary font-bold">{storageStats.sessionCount}</span> 个会话，
                  共 <span className="font-mono text-primary font-bold">{storageStats.messageCount}</span> 条问答记录
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono">
                本地占用空间约 <span className="text-foreground font-semibold">{storageStats.approxFormatted}</span>
                {storageStats.sessionCount > 0 ? '（单条命令庞大回显超 8KB 会自动截断保护）' : ''}
              </p>
            </div>

            {storageStats.sessionCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="ai-clear-storage-btn"
                onClick={() => setIsClearHistoryConfirmOpen(true)}
                className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10 border-destructive/30 hover:border-destructive/50 gap-1 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                <span>{t('ai_storage_clear_all_btn') || '一键清理所有问答缓存'}</span>
              </Button>
            )}
          </div>

          {/* 两个滚动上限配置 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* 1. 最多保留历史会话数 */}
            <div className="p-3 rounded-lg border border-border/50 bg-background/50 space-y-2">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-foreground block">
                  {t('ai_storage_max_sessions') || '最多保留会话数'}
                </span>
                <p className="text-[10.5px] text-muted-foreground leading-snug">
                  {t('ai_storage_max_sessions_desc') || '超出此上限后，自动删除最久未活跃的历史会话。'}
                </p>
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                {[10, 20, 30, 50, 100].map((num) => {
                  const currentVal = settings.maxAssistantSessions || DEFAULT_MAX_ASSISTANT_SESSIONS
                  const isSelected = currentVal === num
                  return (
                    <button
                      key={num}
                      type="button"
                      data-testid={`max-sessions-${num}`}
                      onClick={() => updateSettings({ maxAssistantSessions: num })}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] font-mono transition-all cursor-pointer font-medium border',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-2xs font-semibold'
                          : 'bg-muted/40 hover:bg-muted text-muted-foreground border-border/40 hover:text-foreground',
                      )}
                    >
                      {num}{num === 30 ? ' (默认)' : ''}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. 单个会话最多保留记录数 */}
            <div className="p-3 rounded-lg border border-border/50 bg-background/50 space-y-2">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-foreground block">
                  {t('ai_storage_max_messages') || '单个会话最多保留记录数'}
                </span>
                <p className="text-[10.5px] text-muted-foreground leading-snug">
                  {t('ai_storage_max_messages_desc') || '超出此上限后，当前会话以滑动窗口保留最新对话。'}
                </p>
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                {[20, 30, 50, 100].map((num) => {
                  const currentVal = settings.maxMessagesPerSession || DEFAULT_MAX_MESSAGES_PER_SESSION
                  const isSelected = currentVal === num
                  return (
                    <button
                      key={num}
                      type="button"
                      data-testid={`max-messages-${num}`}
                      onClick={() => updateSettings({ maxMessagesPerSession: num })}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-[11px] font-mono transition-all cursor-pointer font-medium border',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary shadow-2xs font-semibold'
                          : 'bg-muted/40 hover:bg-muted text-muted-foreground border-border/40 hover:text-foreground',
                      )}
                    >
                      {num}{num === 50 ? ' (默认)' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </>
      )}

      {/* 配置模态弹窗 */}
      <ConfigureProviderModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editingProvider={editingProvider}
        presetProviderKey={selectedPresetKey}
        onSave={(data, activate) => {
          saveConfiguredProvider(data, activate)
        }}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={!!deleteId}
        title={t('ai_delete_provider_title')}
        description={t('ai_delete_provider_confirm')}
        onConfirm={() => {
          if (deleteId) {
            removeConfiguredProvider(deleteId)
            setDeleteId(null)
          }
        }}
        onCancel={() => setDeleteId(null)}
      />

      {/* 清空全部历史会话确认弹窗 */}
      <ConfirmDialog
        open={isClearHistoryConfirmOpen}
        title={t('ai_clear_history') || '清空全部记录'}
        description={t('ai_clear_history_confirm') || '确定要清空全部 AI 会话历史记录吗？此操作无法撤销。'}
        onConfirm={() => {
          clearAllAssistantSessions()
          setIsClearHistoryConfirmOpen(false)
        }}
        onCancel={() => setIsClearHistoryConfirmOpen(false)}
      />
    </div>
  )
}
