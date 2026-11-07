import { Component, Fragment, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from '@/i18n'
import { backend } from '@/services/api'
import { useAppStore } from '@/store'
import { SESSION_WORKSPACE_KEY } from '@/store/constants'

interface ErrorBoundaryInnerProps {
  children: ReactNode
  t: (key: string) => string
  onRecover: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundaryInner extends Component<ErrorBoundaryInnerProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryInnerProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    if (backend) {
      const msg = `Error: ${error.message}\nStack: ${error.stack || ''}\nComponent Stack: ${errorInfo.componentStack || ''}`
      backend.auditLogs.record('frontend', 'React ErrorBoundary', 'Component Crash', 'failed', msg)
        .catch((e) => console.error('Failed to log error to backend:', e))
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  /** 返回主界面：关闭全部会话并清理工作台快照，再重建子树，避免重载后又回到出错页面 */
  handleBack = () => {
    try {
      useAppStore.getState().closeAllTabs(true)
    } catch (e) {
      console.error('ErrorBoundary failed to close tabs:', e)
    }
    try {
      sessionStorage.removeItem(SESSION_WORKSPACE_KEY)
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, error: null })
    this.props.onRecover()
  }

  render() {
    if (this.state.hasError) {
      const { t } = this.props
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {t('eb_title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {t('eb_desc')}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {t('eb_back_hint')}
              </p>
              <details className="rounded-md bg-muted p-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t('eb_details')}
                </summary>
                <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
                  {this.state.error?.message}
                </p>
              </details>
            </CardContent>
            <CardFooter className="gap-2">
              <Button onClick={this.handleBack} className="gap-1.5">
                <ArrowLeft className="h-4 w-4" />
                {t('eb_back')}
              </Button>
              <Button variant="outline" onClick={this.handleReload} className="gap-1.5">
                <RotateCcw className="h-4 w-4" />
                {t('eb_reload')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [resetKey, setResetKey] = useState(0)
  return (
    <ErrorBoundaryInner t={t} onRecover={() => setResetKey((k) => k + 1)}>
      <Fragment key={resetKey}>{children}</Fragment>
    </ErrorBoundaryInner>
  )
}
