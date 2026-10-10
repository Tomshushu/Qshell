import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useTranslation } from '@/i18n'
import { backend } from '@/services/api'

interface ErrorBoundaryInnerProps {
  children: ReactNode
  t: (key: string) => string
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
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {this.state.error?.message}
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={this.handleReload}>
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
  return <ErrorBoundaryInner t={t}>{children}</ErrorBoundaryInner>
}
