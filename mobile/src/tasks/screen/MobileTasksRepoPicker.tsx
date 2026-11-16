import { Check, Pencil, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { BottomDrawer } from '../../components/bottom-drawer/BottomDrawer'
import { TextField } from '../../components/composer-input/TextField'
import {
  LIST_LEADING_INSET,
  ListGroup,
  ListRow,
  SectionHeader
} from '../../components/list/ListGroup'
import { translate as t } from '../../i18n/mobile-i18n'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { styles } from '../mobile-tasks-legacy-styles'
import type { RepoSummary } from '../mobile-tasks-provider-detail-types'
import { isHostedTaskRepo } from '../repositories/hosted-repo-selection'
import {
  getRepoBadgeColor,
  getTaskRepoDetail,
  repositoryCount
} from '../repositories/mobile-tasks-repository-presentation'
import type { ConnectionPresentationModel } from '../screen-state/use-mobile-tasks-connection-presentation'

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
            'tasks.providerPickers.repoMapDescription',
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
                <View
                  style={[styles.pickerRepoDot, { backgroundColor: getRepoBadgeColor(repo) }]}
                />
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
