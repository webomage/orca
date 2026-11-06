import { useCallback, useMemo, useState } from 'react'
import { computeActiveTerminalKeyboardLift } from '../terminal/terminal-keyboard-avoidance-lift'
import { terminalPaneDirection, terminalPaneKeyboardLayout } from './mobile-terminal-pane-layout'
import { Animated, View, Text, Pressable, ActivityIndicator } from 'react-native'
import { saveTerminalTextScale } from '../storage/preferences'
import { MobileBrowserPane } from '../browser/MobileBrowserPane'
import { TerminalPaneView } from './TerminalPaneView'
import { useWarmTerminalHandles } from './use-warm-terminal-handles'
import { MobileNativeChatOverlay } from './native-chat/MobileNativeChatOverlay'
import { mobileSessionNativeChatHostOutage } from './native-chat/mobile-native-chat-host-outage'
import { MobileAgentMessageProvider } from './native-chat/transcript/MobileAgentMessageProvider'
import { useMobileAgentMessageNavigation } from './use-mobile-agent-message-navigation'
import { MobileNativeChatDictationPreviewContext } from './native-chat/composer/mobile-native-chat-dictation-preview-context'
import { MobileDictationMeterContext } from './mobile-dictation-meter-context'
import { resolveMobileNativeChatSessionId } from './native-chat/mobile-native-chat-eligibility'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { styles } from './mobile-session-styles'
import type { MobileSessionController } from './use-mobile-session-controller'
import { useWorkspaceExecutionHost } from '../navigation/workspace-execution-host'
import { useHostProfile } from '../transport/use-host-profile'
import { useHostDisplay } from '../transport/use-host-display'
import { FileReader } from './MobileSessionFileReader'
import { MobileSessionContentState } from './MobileSessionContentState'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import { loadMarkdownPreviewImage } from '../files/mobile-markdown-image-source'
import { PaneEdgeNavigationOverlay } from '../navigation/edge-arrows/edge-navigation-context'
import { useSessionEdgeNavigation } from './use-session-edge-navigation'

export function MobileSessionActiveContent({
  controller,
  obscured = false
}: {
  controller: MobileSessionController
  obscured?: boolean
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const executionHost = useWorkspaceExecutionHost()
  const { terminalTarget, contentTarget, navigateSessionTabs } = useSessionEdgeNavigation({
    controller,
    obscured
  })
  const [paneFrame, setPaneFrame] = useState({ width: 0, height: 0 })
  const paneDirection = terminalPaneDirection(paneFrame, controller.terminalSplitLayout)
  const {
    hostId,
    worktreeId,
    insets,
    client,
    terminals,
    terminalTextScale,
    setTerminalTextScale,
    terminalTextScaleRevisionRef,
    tripleTapEnterEnabled,
    quadTapAltMEnabled,
    activeHandle,
    terminalSplitActive,
    visibleTerminalHandles,
    notifyTerminalPaneFrame,
    dictationMode,
    dictationEnabled,
    toastMessage,
    browserScreencastSupported,
    showToast,
    nativeChatSendError,
    nativeChatOverlayInputLockReason,
    nativeChatController,
    dictation,
    chatDictationPreview,
    notifyTerminalFrame,
    handleNativeChatFileTap,
    nativeChatImages,
    nativeChatStructuredComposer,
    activeMarkdownTab,
    activeFileTab,
    activeBrowserTab,
    activePendingTerminalTab,
    showLoadingState,
    showEmptyState,
    keyboardLift,
    activeTerminalKeyboardLift,
    toastAnimatedStyle,
    handleCreateBrowserRef,
    isFloatingWorkspaceRoute
  } = controller
  // Why: a browser tab needs a real worktree and a connected host known to stream it; elsewhere
  // only the phone's browser is offered, so the sheet never shows a choice that would refuse.
  const canOpenUrlInOrca =
    client !== null &&
    controller.presentedConnState === 'connected' &&
    !isFloatingWorkspaceRoute &&
    browserScreencastSupported === true
  const openUrlInOrca = useMemo(
    () =>
      canOpenUrlInOrca ? (url: string) => void handleCreateBrowserRef.current?.(url) : undefined,
    [canOpenUrlInOrca, handleCreateBrowserRef]
  )
  const warmTerminalHandles = useWarmTerminalHandles(
    terminals,
    visibleTerminalHandles,
    activeHandle
  )
  const handleTextScaleChange = useCallback(
    (scale: number) => {
      // Why: pinch-to-zoom reports a new preset; persist it so the size sticks across panes and launches.
      terminalTextScaleRevisionRef.current += 1
      setTerminalTextScale(scale)
      void saveTerminalTextScale(scale)
    },
    [setTerminalTextScale, terminalTextScaleRevisionRef]
  )
  const hostProfile = useHostProfile(hostId)
  const hostTitle = useHostDisplay(hostProfile).title
  const nativeChatHostOutage = mobileSessionNativeChatHostOutage(controller, hostTitle, t)
  const nativeChatImageSource = useMemo(
    () => (client ? { client, worktreeId } : undefined),
    [client, worktreeId]
  )
  const navigateToSender = useCallback(
    (senderWorktreeId: string, paneKey: string) => {
      const execution = executionHost ? `&executionHost=${encodeURIComponent(executionHost)}` : ''
      controller.router.push(
        `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(senderWorktreeId)}?paneKey=${encodeURIComponent(paneKey)}${execution}`
      )
    },
    [controller.router, hostId, executionHost]
  )
  const openSender = useMobileAgentMessageNavigation(
    client,
    navigateToSender,
    JSON.stringify([hostId, executionHost, worktreeId, controller.activeSessionTab?.id]),
    controller.showToast,
    controller
  )
  const { presentedConnState, showOfflineState, forceReconnectHost } = controller
  const content =
    showLoadingState || showEmptyState || showOfflineState ? (
      <MobileSessionContentState
        connState={presentedConnState}
        hostName={hostTitle}
        loading={showLoadingState}
        creating={controller.createTabBusy}
        createError={controller.createError}
        onReconnect={forceReconnectHost ? () => void forceReconnectHost(hostId) : null}
        onRetryTabs={() => void controller.retryPendingTerminalRecovery()}
        onCreateTab={() => {
          controller.setCreateError('')
          controller.setShowCreateTabDrawer(true)
        }}
      />
    ) : activeMarkdownTab ? (
      <View style={styles.markdownFrame}>
        <MarkdownReader
          documentId={activeMarkdownTab.id}
          doc={controller.markdownDocs.get(activeMarkdownTab.id)}
          onRefresh={() => void controller.readMarkdownTab(activeMarkdownTab)}
          onChange={(content) =>
            controller.updateMarkdownLocalContent(activeMarkdownTab.id, content)
          }
          onSave={() => void controller.saveMarkdownTab(activeMarkdownTab)}
          onCopy={() => void controller.copyMarkdownLocalContent(activeMarkdownTab.id)}
          onCopyPath={() => void controller.copyMarkdownPath(activeMarkdownTab)}
          onDiscard={() => controller.discardMarkdownLocalContent(activeMarkdownTab)}
          loadImageSource={(path) =>
            loadMarkdownPreviewImage(client, worktreeId, activeMarkdownTab.relativePath, path)
          }
          keyboardLift={keyboardLift}
        />
        <PaneEdgeNavigationOverlay target={contentTarget} bottomInset={keyboardLift} />
        {toastMessage && (
          <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
      </View>
    ) : activeFileTab ? (
      <View style={styles.markdownFrame}>
        <FileReader
          documentId={JSON.stringify([hostId, executionHost, worktreeId, activeFileTab.id])}
          client={client}
          doc={controller.fileDocs.get(activeFileTab.id)}
          title={activeFileTab.title || t('session.activeContent.fileTitle', 'File')}
          relativePath={activeFileTab.relativePath}
          language={activeFileTab.language}
          diffCommentActions={
            activeFileTab.diffSource === 'staged' || activeFileTab.diffSource === 'unstaged'
              ? {
                  comments: controller.diffComments,
                  sendingCommentIds: controller.sendingDiffCommentIds,
                  busy: controller.diffCommentBusy,
                  onAdd: controller.addDiffCommentForFile,
                  onDelete: controller.deleteDiffCommentForFile,
                  onCopyAll: controller.copyDiffCommentsToClipboard,
                  onSendAll: controller.sendDiffCommentsToAgent
                }
              : undefined
          }
        />
        <PaneEdgeNavigationOverlay target={contentTarget} bottomInset={keyboardLift} />
        {toastMessage && (
          <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
      </View>
    ) : activeBrowserTab ? (
      <View style={styles.browserFrame}>
        {/* Why: pane owns imperative frame refs; don't render a stale frame while the old stream effect cleans up. */}
        <MobileBrowserPane
          key={activeBrowserTab.browserPageId ?? activeBrowserTab.id}
          client={client}
          worktreeId={worktreeId}
          tab={activeBrowserTab}
          screencastSupported={browserScreencastSupported}
          keyboardLift={keyboardLift}
          bottomInset={insets.bottom}
          onToast={showToast}
        />
        <PaneEdgeNavigationOverlay target={contentTarget} bottomInset={keyboardLift} />
        {toastMessage && (
          <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
      </View>
    ) : activePendingTerminalTab ? (
      <View style={styles.emptyState}>
        {!controller.isPendingTerminalRecoveryParked && (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        )}
        <Text style={styles.emptyText}>
          {controller.isPendingTerminalRecoveryParked
            ? t(
                'session.activeContent.terminalTakingLonger',
                'Terminal is taking longer than expected'
              )
            : activePendingTerminalTab.title ||
              t('session.activeContent.loadingTerminal', 'Loading terminal')}
        </Text>
        {controller.isPendingTerminalRecoveryParked && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              'session.activeContent.retryLoadingTerminal',
              'Retry loading terminal'
            )}
            style={({ pressed }) => [
              styles.createButton,
              pressed && styles.newTerminalButtonPressed
            ]}
            onPress={() => void controller.retryPendingTerminalRecovery()}
          >
            <Text style={styles.createButtonText}>{t('common.retry', 'Retry')}</Text>
          </Pressable>
        )}
      </View>
    ) : (
      <View style={styles.terminalFrame}>
        {terminals.map((terminal) => (
          <TerminalPaneView
            key={terminal.handle}
            handle={terminal.handle}
            active={terminal.handle === activeHandle}
            visible={
              visibleTerminalHandles?.includes(terminal.handle) ?? terminal.handle === activeHandle
            }
            retainMounted={warmTerminalHandles.has(terminal.handle)}
            splitIndex={
              terminalSplitActive && visibleTerminalHandles.includes(terminal.handle)
                ? visibleTerminalHandles.indexOf(terminal.handle)
                : undefined
            }
            splitDirection={paneDirection}
            splitFrame={paneFrame}
            keyboardInset={keyboardLift}
            title={terminal.title}
            onFrame={notifyTerminalPaneFrame}
            keyboardLift={
              terminal.handle !== activeHandle &&
              !(terminalSplitActive && visibleTerminalHandles.includes(terminal.handle))
                ? 0
                : terminalSplitActive
                  ? computeActiveTerminalKeyboardLift({
                      keyboardLift: terminalPaneKeyboardLayout(
                        paneFrame,
                        paneDirection,
                        visibleTerminalHandles.indexOf(terminal.handle),
                        keyboardLift
                      ).occlusion,
                      metrics: controller.terminalKeyboardMetrics.get(terminal.handle),
                      terminalFrameHeight:
                        controller.getTerminalPaneViewport(terminal.handle).terminalFrameRef.current
                          ?.height ?? 0
                    })
                  : activeTerminalKeyboardLift
            }
            terminalTheme={terminal.terminalTheme}
            textScale={terminalTextScale}
            tripleTapEnterEnabled={tripleTapEnterEnabled}
            quadTapAltMEnabled={quadTapAltMEnabled}
            onTextScaleChange={handleTextScaleChange}
            onRef={controller.setTerminalWebViewRef}
            onWebReady={controller.handleTerminalWebReady}
            onCellBoxChange={controller.notifyTerminalCellBoxChange}
            onSelectionMode={controller.handleSelectionMode}
            onSelectionCopy={controller.handleSelectionCopy}
            onSelectionEvicted={controller.handleSelectionEvicted}
            onClipboardWrite={controller.handleClipboardWrite}
            onModesChanged={controller.handleModesChanged}
            onKeyboardAvoidanceMetrics={controller.handleKeyboardAvoidanceMetrics}
            onHaptic={controller.handleHaptic}
            onTerminalInput={controller.handleTerminalInput}
            onTerminalQueryReply={controller.handleTerminalQueryReply}
            onTerminalInteraction={controller.handleTerminalInteraction}
            onTerminalTap={controller.handleTerminalTap}
            onTerminalTripleTap={controller.handleTerminalTripleTap}
            onTerminalQuadTap={controller.handleTerminalQuadTap}
            onFileTap={controller.handleFileTap}
            onOpenUrl={controller.handleTerminalOpenUrl}
          />
        ))}
        <MobileNativeChatDictationPreviewContext.Provider value={chatDictationPreview}>
          <MobileDictationMeterContext.Provider value={dictation.meter}>
            <MobileAgentMessageProvider
              key={JSON.stringify([hostId, executionHost, worktreeId])}
              tabs={controller.sessionTabs}
              terminals={controller.terminals}
              scopeKey={nativeChatImageSource}
              open={openSender}
            >
              <MobileNativeChatOverlay
                controller={nativeChatController}
                imageSource={nativeChatImageSource}
                worktreePath={controller.worktreePath}
                connState={controller.connState}
                activeSessionTabId={controller.activeSessionTab?.id}
                onOpenFile={handleNativeChatFileTap}
                images={nativeChatImages}
                structuredComposer={nativeChatStructuredComposer}
                onMicPress={dictationEnabled ? controller.handleDictationToggle : undefined}
                micActive={dictation.isStarting || dictation.isRecording}
                micStarting={dictation.isStarting}
                micProcessing={dictation.isProcessing}
                dictationMode={dictationMode}
                onMicPressIn={controller.handleDictationPressIn}
                onMicPressOut={controller.handleDictationPressOut}
                inputLockReason={nativeChatOverlayInputLockReason}
                sendErrorMessage={nativeChatSendError.message}
                onClearSendError={nativeChatSendError.clear}
                sendSurfaceId={controller.nativeChatScopeKey ?? ''}
                sessionId={resolveMobileNativeChatSessionId(controller.activeSessionTab)}
                getSendCompletionGeneration={controller.getSendCompletionGeneration}
                keyboardInset={keyboardLift}
                obscured={obscured}
                canNavigateRight={controller.visibleTabs.length > 1}
                onNavigateHorizontal={navigateSessionTabs}
                // A workspace routed to another server stops with that server, whose name the phone lacks.
                hostName={executionHost === undefined && hostProfile ? hostTitle : null}
                onOpenUrlInOrca={openUrlInOrca}
                hostOutage={nativeChatHostOutage}
                onRunInTerminal={(command) =>
                  void controller.handleCreateTerminal(undefined, {
                    startupCommand: command,
                    startupCommandDelivery: 'shell-ready',
                    terminalView: true
                  })
                }
              />
            </MobileAgentMessageProvider>
          </MobileDictationMeterContext.Provider>
        </MobileNativeChatDictationPreviewContext.Provider>
        {!controller.showNativeChat && activeHandle ? (
          <PaneEdgeNavigationOverlay target={terminalTarget} bottomInset={keyboardLift} />
        ) : null}
        {toastMessage && (
          <Animated.View pointerEvents="none" style={[styles.toast, toastAnimatedStyle]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </Animated.View>
        )}
      </View>
    )
  return (
    <View
      // Why: one frame under every branch; react-native-web observes onLayout only on a View that mounts with it.
      style={styles.contentFrame}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        notifyTerminalFrame({ width, height })
        setPaneFrame((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height }
        )
      }}
    >
      {content}
    </View>
  )
}
