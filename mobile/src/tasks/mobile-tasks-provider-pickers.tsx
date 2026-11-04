import type { ConnectionPresentationModel } from './use-mobile-tasks-connection-presentation'
import {
  Check,
  Pencil,
  PickerModal,
  TextField,
  View,
  Text,
  Pressable,
  ScrollView,
  X,
  colors,
  isHostedTaskRepo,
  type TaskProvider
} from './mobile-tasks-dependencies'
import { BottomDrawer } from '../components/bottom-drawer/BottomDrawer'
import {
  type RepoSummary,
  normalizeGitHubPreset,
  getTaskPresetQuery,
  githubKindFromQuery,
  scopeGitHubTaskSearch,
  normalizeLinearFilter,
  repositoryCount,
  getRepoBadgeColor,
  getTaskRepoDetail,
  issueSourceSlug,
  GITHUB_KIND_OPTIONS
} from './mobile-tasks-legacy-foundation'
import { LIST_LEADING_INSET, ListGroup, ListRow, SectionHeader } from '../components/list/ListGroup'
import { styles } from './mobile-tasks-legacy-styles'
import { normalizeJiraFilter } from './mobile-jira-issue-filters'
import { translate as t } from '../i18n/mobile-i18n'
import { pressedStyle } from '../theme/mobile-theme'

// Restores the provider's last view and query so switching sources round-trips.
export function selectMobileTasksProvider(model: ConnectionPresentationModel, next: TaskProvider) {
  const {
    githubPreset,
    persistTaskSource,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setItems,
    setLinearFilter,
    setJiraFilter,
    setProvider,
    setQuery,
    taskResumeRef
  } = model
  const resume = taskResumeRef.current
  persistTaskSource(next)
  setProvider(next)
  setItems([])
  if (next === 'github') {
    const nextMode = resume.githubMode === 'project' ? 'project' : 'items'
    setGithubMode(nextMode)
    if (nextMode === 'project') {
      setQuery('')
      setAppliedQuery('')
      return
    }
    const preset =
      resume.githubItemsPreset === null
        ? githubPreset
        : normalizeGitHubPreset(resume.githubItemsPreset ?? githubPreset)
    const nextQuery =
      resume.githubItemsPreset === null
        ? (resume.githubItemsQuery ?? '')
        : getTaskPresetQuery(preset)
    const nextKind = githubKindFromQuery(nextQuery, preset)
    setGithubPreset(preset)
    setGithubKind(nextKind)
    setQuery(nextQuery)
    setAppliedQuery(scopeGitHubTaskSearch(nextQuery, nextKind))
  } else if (next === 'linear') {
    const nextQuery = resume.linearQuery ?? ''
    setLinearFilter(normalizeLinearFilter(resume.linearPreset))
    setQuery(nextQuery)
    setAppliedQuery(nextQuery.trim())
  } else if (next === 'jira') {
    const nextQuery = resume.jiraQuery ?? ''
    setJiraFilter(normalizeJiraFilter(resume.jiraPreset))
    setQuery(nextQuery)
    setAppliedQuery(nextQuery.trim())
  } else {
    setQuery('')
    setAppliedQuery('')
  }
}

export function renderMobileTasksRepoPicker(model: ConnectionPresentationModel) {
  const {
    editingRepoMappingId,
    effectiveRepoIds,
    githubRepoSlugCache,
    githubRepoSources,
    hostedRepos,
    persistRepoSelection,
    provider,
    repoHostLabels,
    repoMappingDraft,
    repos,
    setEditingRepoMappingId,
    setGitHubIssueRepository,
    setRepoMappingDraft,
    setSelectedRepoIds,
    setShowRepoPicker,
    showRepoPicker,
    taskUiReady,
    toggleRepoSelection
  } = model
  const editingRepo: RepoSummary | null =
    editingRepoMappingId !== null
      ? (repos.find((entry) => entry.id === editingRepoMappingId) ?? null)
      : null
  const unmappedFolders =
    provider === 'github' ? repos.filter((entry) => !isHostedTaskRepo(entry)) : []
  const resolvedSlugForRepo = (repo: RepoSummary): string | null => {
    const mapped =
      repo.issueRepository ??
      githubRepoSources[repo.id]?.issues ??
      githubRepoSlugCache[repo.id]?.repository ??
      null
    return mapped?.owner && mapped.repo ? `${mapped.owner}/${mapped.repo}` : null
  }
  const openMappingEditor = (repo: RepoSummary): void => {
    setEditingRepoMappingId(repo.id)
    setRepoMappingDraft(resolvedSlugForRepo(repo) ?? '')
  }
  return (
    <BottomDrawer
      visible={taskUiReady && showRepoPicker}
      onClose={() => {
        setEditingRepoMappingId(null)
        setShowRepoPicker(false)
      }}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{t('tasks.providerPickers.repos', 'Repositories')}</Text>
        <Text style={styles.sheetSubtitle}>
          {t(
            'tasks.providerPickers.repoDescription',
            'Choose which repositories to query or map a project folder to owner/repo.'
          )}
        </Text>
      </View>

      {editingRepo ? (
        <View style={styles.projectPickerControls}>
          <Text style={styles.repoPickerTitle} numberOfLines={1}>
            {t('tasks.providerPickers.mapRepoTitle', 'Ticket repository for {{name}}', {
              name: editingRepo.displayName
            })}
          </Text>
          <View style={styles.projectPasteRow}>
            <TextField
              style={styles.projectPasteInput}
              monospace
              autoCapitalize="none"
              autoCorrect={false}
              value={repoMappingDraft}
              onChangeText={setRepoMappingDraft}
              placeholder="owner/repo"
              accessibilityLabel="GitHub ticket repository owner/repo"
            />
            <Pressable
              style={({ pressed }) => [styles.iconActionButton, pressed && pressedStyle]}
              accessibilityRole="button"
              accessibilityLabel="Save ticket repository mapping"
              onPress={() => {
                void setGitHubIssueRepository(editingRepo, repoMappingDraft).then((ok) => {
                  if (ok) {
                    setEditingRepoMappingId(null)
                  }
                })
              }}
            >
              <Check size={18} color={colors.accentBlue} />
            </Pressable>
            {editingRepo.issueRepository ? (
              <Pressable
                style={({ pressed }) => [styles.projectPasteButton, pressed && pressedStyle]}
                accessibilityRole="button"
                accessibilityLabel="Reset to automatic ticket repository discovery"
                onPress={() => {
                  void setGitHubIssueRepository(editingRepo, null).then((ok) => {
                    if (ok) {
                      setEditingRepoMappingId(null)
                    }
                  })
                }}
              >
                <Text style={styles.issueSourceSegmentText}>Auto</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.iconActionButton, pressed && pressedStyle]}
              accessibilityRole="button"
              accessibilityLabel="Cancel ticket repository mapping"
              onPress={() => setEditingRepoMappingId(null)}
            >
              <X size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <ListGroup separatorInset={LIST_LEADING_INSET}>
        <ListRow
          key="all"
          title={t('tasks.providerPickers.allRepositories', 'All repositories')}
          subtitle={repositoryCount(hostedRepos.length)}
          // An empty slot keeps the title in line with the repository names below.
          leading={<View />}
          selected={effectiveRepoIds.size === 0}
          accessibilityRole="checkbox"
          onPress={() => {
            const allSelection = new Set<string>()
            setSelectedRepoIds(allSelection)
            persistRepoSelection(allSelection, hostedRepos)
          }}
        />
        {hostedRepos.map((repo) => {
          const mappedSlug = provider === 'github' ? resolvedSlugForRepo(repo) : null
          const baseDetail = getTaskRepoDetail(repo, repoHostLabels)
          const subtitle = mappedSlug ? `${mappedSlug} · ${baseDetail}` : baseDetail
          return (
            <ListRow
              key={repo.id}
              title={repo.displayName}
              subtitle={subtitle}
              leading={
                <View style={[styles.pickerRepoDot, { backgroundColor: getRepoBadgeColor(repo) }]} />
              }
              accessory={
                provider === 'github' ? (
                  <Pressable
                    style={({ pressed }) => [styles.iconActionButton, pressed && pressedStyle]}
                    accessibilityRole="button"
                    accessibilityLabel={`Map GitHub repository for ${repo.displayName}`}
                    onPress={() => openMappingEditor(repo)}
                  >
                    <Pencil size={15} color={colors.textMuted} />
                  </Pressable>
                ) : undefined
              }
              selected={effectiveRepoIds.has(repo.id)}
              accessibilityRole="checkbox"
              onPress={() => toggleRepoSelection(repo.id)}
            />
          )
        })}
      </ListGroup>

      {unmappedFolders.length > 0 ? (
        <>
          <SectionHeader
            title={t('tasks.providerPickers.unmappedFolders', 'Workspace folders (tap to map)')}
          />
          <ListGroup separatorInset={LIST_LEADING_INSET}>
            {unmappedFolders.map((repo) => (
              <ListRow
                key={repo.id}
                title={repo.displayName}
                subtitle={getTaskRepoDetail(repo, repoHostLabels)}
                leading={
                  <View
                    style={[styles.pickerRepoDot, { backgroundColor: getRepoBadgeColor(repo) }]}
                  />
                }
                accessory={<Pencil size={15} color={colors.textMuted} />}
                accessibilityRole="button"
                onPress={() => openMappingEditor(repo)}
              />
            ))}
          </ListGroup>
        </>
      ) : null}
    </BottomDrawer>
  )
}

export function renderMobileTasksGitHubIssueSourcePicker(model: ConnectionPresentationModel) {
  const {
    githubIssueSourceRows,
    setGitHubIssueSourcePreference,
    setShowGitHubIssueSourcePicker,
    showGitHubIssueSourcePicker,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && showGitHubIssueSourcePicker}
      onClose={() => setShowGitHubIssueSourcePicker(false)}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>
          {t('tasks.providerPickers.issueSources', 'GitHub Issue Sources')}
        </Text>
        <Text style={styles.sheetSubtitle}>
          {t(
            'tasks.providerPickers.issueSourcesDescription',
            'Choose whether each repository queries and creates work from upstream or origin.'
          )}
        </Text>
      </View>

      <View style={styles.repoPickerGroup}>
        {githubIssueSourceRows.length === 0 ? (
          <View style={styles.drawerLoadingRow}>
            <Text style={styles.detailMuted}>
              {t('tasks.providerPickers.noIssueSources', 'No alternate issue sources available.')}
            </Text>
          </View>
        ) : (
          githubIssueSourceRows.map(({ repo, sources }, index) => {
            const selectedPreference =
              repo.issueSourcePreference === 'origin' || repo.issueSourcePreference === 'upstream'
                ? repo.issueSourcePreference
                : 'upstream'
            return (
              <View key={repo.id}>
                {index > 0 ? <View style={styles.actionSeparator} /> : null}
                <View style={styles.issueSourceBox}>
                  <View style={styles.repoPickerTextWrap}>
                    <Text style={styles.repoPickerTitle} numberOfLines={1}>
                      {repo.displayName}
                    </Text>
                    <Text style={styles.issueSourceHint} numberOfLines={2}>
                      {t('tasks.providerPickers.queryingSource', 'Querying {{source}}', {
                        source: issueSourceSlug(
                          selectedPreference === 'origin' ? sources.prs : sources.upstreamCandidate
                        )
                      })}
                    </Text>
                  </View>
                  <View style={styles.issueSourceSegment}>
                    {(['upstream', 'origin'] as const).map((preference) => {
                      const selected = selectedPreference === preference
                      const slug =
                        preference === 'upstream'
                          ? issueSourceSlug(sources.upstreamCandidate)
                          : issueSourceSlug(sources.prs)
                      return (
                        <Pressable
                          key={preference}
                          style={({ pressed }) => [
                            styles.issueSourceSegmentButton,
                            selected && styles.issueSourceSegmentButtonActive,
                            pressed && pressedStyle
                          ]}
                          accessibilityState={{ selected }}
                          onPress={() => void setGitHubIssueSourcePreference(repo, preference)}
                        >
                          <Text
                            style={[
                              styles.issueSourceSegmentText,
                              selected && styles.issueSourceSegmentTextActive
                            ]}
                          >
                            {preference === 'upstream'
                              ? t('tasks.providerPickers.upstream', 'Upstream')
                              : t('tasks.providerPickers.origin', 'Origin')}
                          </Text>
                          <Text style={styles.issueSourceSlug} numberOfLines={1}>
                            {slug}
                          </Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </View>
              </View>
            )
          })
        )}
      </View>
    </BottomDrawer>
  )
}

export function renderMobileTasksGitHubViewPicker(model: ConnectionPresentationModel) {
  const {
    githubKind,
    githubMode,
    persistTaskResumeState,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setItems,
    setQuery,
    setShowGitHubKindPicker,
    showGitHubKindPicker,
    taskUiReady
  } = model
  return (
    <PickerModal
      visible={taskUiReady && showGitHubKindPicker}
      title={t('tasks.providerPickers.githubView', 'GitHub View')}
      options={GITHUB_KIND_OPTIONS}
      selected={githubMode === 'project' ? 'project' : githubKind}
      onSelect={(kind) => {
        if (kind === 'project') {
          setGithubMode('project')
          setItems([])
          persistTaskResumeState({ githubMode: 'project' })
          return
        }
        const preset = kind === 'prs' ? 'prs' : 'issues'
        const nextQuery = getTaskPresetQuery(preset)
        setGithubMode('items')
        setGithubKind(kind)
        setGithubPreset(preset)
        setQuery(nextQuery)
        setAppliedQuery(nextQuery)
        persistTaskResumeState({
          githubMode: 'items',
          githubItemsPreset: preset,
          githubItemsQuery: nextQuery
        })
      }}
      onClose={() => setShowGitHubKindPicker(false)}
    />
  )
}

export function renderMobileTasksGitHubPresetPicker(model: ConnectionPresentationModel) {
  const {
    githubKind,
    githubPreset,
    githubPresetPickerOptions,
    persistDefaultGitHubPreset,
    persistTaskResumeState,
    setAppliedQuery,
    setGithubKind,
    setGithubMode,
    setGithubPreset,
    setQuery,
    setShowGitHubPresetPicker,
    showGitHubPresetPicker,
    taskUiReady
  } = model
  return (
    <PickerModal
      visible={taskUiReady && showGitHubPresetPicker}
      title={
        githubKind === 'prs'
          ? t('tasks.providerPickers.pullRequests', 'Pull Requests')
          : t('tasks.providerPickers.issues', 'Issues')
      }
      options={githubPresetPickerOptions}
      selected={githubPreset}
      onSelect={(preset) => {
        const nextQuery = getTaskPresetQuery(preset)
        setGithubMode('items')
        setGithubKind(preset === 'issues' || preset === 'my-issues' ? 'issues' : 'prs')
        setGithubPreset(preset)
        setQuery(nextQuery)
        setAppliedQuery(nextQuery)
        persistTaskResumeState({
          githubItemsPreset: preset,
          githubItemsQuery: nextQuery
        })
      }}
      onLongSelect={persistDefaultGitHubPreset}
      onClose={() => setShowGitHubPresetPicker(false)}
    />
  )
}

export function renderMobileTasksPagePicker(model: ConnectionPresentationModel) {
  const {
    githubCurrentPage,
    githubPagePickerPages,
    githubPages,
    githubPaginationLoading,
    handleGitHubPageChange,
    setShowGitHubPagePicker,
    showGitHubPagePicker,
    taskUiReady
  } = model
  return (
    <BottomDrawer
      visible={taskUiReady && showGitHubPagePicker}
      onClose={() => setShowGitHubPagePicker(false)}
      // The page list scrolls itself; a drawer ScrollView around it would nest same-axis scrolling.
      contentScrollable={false}
    >
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{t('tasks.providerPickers.pages', 'GitHub Pages')}</Text>
        <Text style={styles.sheetSubtitle}>
          {t('tasks.providerPickers.pageHint', 'Jump to a loaded or available result page.')}
        </Text>
      </View>
      <ScrollView style={styles.pagePickerList}>
        <ListGroup>
          {githubPagePickerPages.map((index) => (
            <ListRow
              key={`github-page:${index}`}
              title={t('tasks.providerPickers.pageNumber', 'Page {{page}}', { page: index + 1 })}
              subtitle={
                index < githubPages.length
                  ? t('tasks.providerPickers.pageLoaded', 'Loaded')
                  : t('tasks.providerPickers.pageNotLoaded', 'Loads older results')
              }
              selected={index === githubCurrentPage}
              disabled={githubPaginationLoading}
              onPress={() => {
                setShowGitHubPagePicker(false)
                void handleGitHubPageChange(index)
              }}
            />
          ))}
        </ListGroup>
      </ScrollView>
    </BottomDrawer>
  )
}
