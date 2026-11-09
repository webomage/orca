import '../../i18n/mobile-i18n'

const passwordPromptObservers = new WeakMap<
  Map<string, string>,
  (handle: string, chunk: string) => void
>()

export function registerTerminalPasswordPromptObserver(
  terminalCwd: Map<string, string>,
  observer: (handle: string, chunk: string) => void
): void {
  passwordPromptObservers.set(terminalCwd, observer)
}

export function updateTerminalCwdFromStreamEvent(
  handle: string,
  data: Readonly<Record<string, unknown>>,
  terminalCwd: Map<string, string>
): void {
  const streamText =
    typeof data.chunk === 'string'
      ? data.chunk
      : typeof data.serialized === 'string'
        ? data.serialized
        : ''
  const observer = passwordPromptObservers.get(terminalCwd)
  if (streamText && observer) {
    observer(handle, streamText)
  }
  if (!('cwd' in data)) {
    return
  }
  if (typeof data.cwd === 'string' && data.cwd.trim().length > 0) {
    terminalCwd.set(handle, data.cwd)
    return
  }
  terminalCwd.delete(handle)
}
