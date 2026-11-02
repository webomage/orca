import { useMemo, useRef, type RefObject } from 'react'
import { View, Text, Pressable, type LayoutChangeEvent } from 'react-native'
import { File, FileText, Globe, SquareTerminal } from 'lucide-react-native'
import { DetailCardFocusBoundary } from '../components/detail-card-host'
import { useDetailCardSource, type DetailCardSource } from '../components/use-anchored-detail-card'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { AgentStateDot } from '../components/AgentStateDot'
import { agentStateLabel, type AgentDotState } from '../worktree/agent-row-display'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-session-styles'
import type { SessionTitleCard } from './use-session-title-card'
import type { MobileSessionTab as SessionTab } from './mobile-session-route-types'

export function MobileSessionTab({
  tab,
  first,
  active,
  title,
  tabState,
  agentId,
  details,
  barRef,
  isDragging = false,
  onLayout,
  onPress,
  onLongPress,
  onDragMove,
  onDragEnd
}: {
  tab: SessionTab
  first: boolean
  active: boolean
  title: string
  tabState?: AgentDotState
  agentId: string | null
  details: SessionTitleCard['tabDetails']
  barRef: RefObject<View | null>
  isDragging?: boolean
  onLayout: (event: LayoutChangeEvent) => void
  onPress: (source: DetailCardSource) => void
  onLongPress: () => void
  onDragMove?: (dx: number) => void
  onDragEnd?: () => void
}) {
  const t = useMobileTranslation()
  const openerRef = useRef<View>(null)
  const touchStartRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const draggingRef = useRef(false)
  const source = useMemo<DetailCardSource>(
    () => ({ key: `tab:${tab.id}`, anchorRef: openerRef, openerRef, barRef, geometry: 'refresh' }),
    [tab.id, barRef]
  )
  useDetailCardSource(details, source)
  const ownsCard = details.activeKey === source.key
  return (
    <>
      <DetailCardFocusBoundary refs={details.boundaryRefs} index={0} active={ownsCard} />
      <Pressable
        ref={openerRef}
        style={({ pressed }) => [
          styles.tab,
          first && styles.tabFirst,
          active && styles.tabActive,
          (pressed || isDragging) && styles.tabPressed
        ]}
        onLayout={(event) => {
          onLayout(event)
          details.refreshSource()
        }}
        onTouchStart={(event) => {
          const touch = event.nativeEvent.touches?.[0]
          if (!touch) {
            return
          }
          touchStartRef.current = {
            x: touch.pageX,
            y: touch.pageY,
            at: Date.now()
          }
          draggingRef.current = false
        }}
        onTouchMove={(event) => {
          const start = touchStartRef.current
          const touch = event.nativeEvent.touches?.[0]
          if (!start || !touch || !onDragMove) {
            return
          }
          const dx = touch.pageX - start.x
          const dy = touch.pageY - start.y
          if (
            !draggingRef.current &&
            (active || Date.now() - start.at >= 160) &&
            Math.abs(dx) >= 14 &&
            Math.abs(dx) > Math.abs(dy) * 1.25
          ) {
            draggingRef.current = true
          }
          if (draggingRef.current) {
            onDragMove(dx)
          }
        }}
        onTouchEnd={() => {
          touchStartRef.current = null
          if (draggingRef.current) {
            draggingRef.current = false
            onDragEnd?.()
          }
        }}
        onTouchCancel={() => {
          touchStartRef.current = null
          if (draggingRef.current) {
            draggingRef.current = false
            onDragEnd?.()
          }
        }}
        onPress={() => {
          if (draggingRef.current) {
            return
          }
          onPress(source)
        }}
        accessibilityRole="tab"
        aria-expanded={details.requestedKey === source.key}
        accessibilityLabel={
          tabState && tabState !== 'idle'
            ? t('session.tabStrip.tabStatus', '{{title}}, {{status}}', {
                title,
                status: agentStateLabel(tabState)
              })
            : title
        }
        accessibilityState={{ selected: active }}
        onLongPress={() => {
          if (draggingRef.current) {
            return
          }
          onLongPress()
        }}
        delayLongPress={400}
      >
        <View style={styles.tabLabelRow}>
          {tabState && tabState !== 'idle' ? <AgentStateDot state={tabState} /> : null}
          <View style={styles.tabIcon}>
            {tab.type === 'browser' && (
              <Globe size={13} color={colors.textSecondary} strokeWidth={2.1} />
            )}
            {tab.type === 'markdown' && (
              <FileText size={13} color={colors.textSecondary} strokeWidth={2.1} />
            )}
            {tab.type === 'file' && (
              <File size={13} color={colors.textSecondary} strokeWidth={2.1} />
            )}
            {agentId ? (
              <MobileAgentIcon agentId={agentId} size={13} />
            ) : tab.type === 'terminal' ? (
              <SquareTerminal size={13} color={colors.textSecondary} strokeWidth={2.1} />
            ) : null}
          </View>
          <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </Pressable>
      <DetailCardFocusBoundary refs={details.boundaryRefs} index={1} active={ownsCard} />
    </>
  )
}
