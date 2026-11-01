import { parseOrchestrationDeepLink } from '../../../../shared/orchestration-deep-link'
import { parseWorktreeDeepLink } from '../../../../shared/worktree-deep-link'
import { noopUnsubscribe } from './web-storage'

function createBrowserDeepLinkChannel<T>(parse: (url: string) => T | null): {
  onOpen: (callback: (link: T) => void) => () => void
  consume: () => Promise<T | null>
} {
  let initial = typeof window !== 'undefined' ? parse(window.location.href) : null
  let consumed = false
  return {
    onOpen: (callback) => {
      if (typeof window === 'undefined') {
        return noopUnsubscribe
      }
      const handlePopState = () => {
        const link = parse(window.location.href)
        if (link) {
          callback(link)
        }
      }
      window.addEventListener('popstate', handlePopState)
      return () => window.removeEventListener('popstate', handlePopState)
    },
    consume: () => {
      if (consumed) {
        return Promise.resolve(null)
      }
      consumed = true
      const pending =
        initial ?? (typeof window !== 'undefined' ? parse(window.location.href) : null)
      initial = null
      return Promise.resolve(pending)
    }
  }
}

export const worktreeDeepLinkChannel = createBrowserDeepLinkChannel(parseWorktreeDeepLink)
export const orchestrationDeepLinkChannel = createBrowserDeepLinkChannel(parseOrchestrationDeepLink)
