import { Component, type ReactNode } from 'react'
import { View } from 'react-native'
import { reportError } from '@/lib/errorReports'
import { Button, Text } from './kit'

// 0.7.3: a screen that crashes shows this instead of a blank app, and the error is reported.

export class ErrorBoundary extends Component<{ children: ReactNode; bg: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const e = error as { message?: string; stack?: string }
    reportError(
      {
        message: e?.message ?? String(error),
        // Oct 31, 2026: which components first. A long JS stack used to fill the report's space
        // and the component stack (the part that names the screen) was cut off.
        stack: `${(info?.componentStack ?? '').trim()}\n---\n${(e?.stack ?? '').split('\n').slice(0, 12).join('\n')}`,
      },
      'screen',
    )
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 16,
          backgroundColor: this.props.bg,
        }}
      >
        <Text display size={24} style={{ textAlign: 'center' }}>
          Something went wrong
        </Text>
        <Text size={15} tone="muted" style={{ textAlign: 'center', lineHeight: 22 }}>
          Glofly hit a problem on this screen. We've been told about it. Try again, and if it keeps happening, close Glofly and open it again.
        </Text>
        <Button label="Try again" onPress={() => this.setState({ failed: false })} />
      </View>
    )
  }
}
