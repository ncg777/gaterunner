<template>
  <div class="preset-manager">
    <div class="toolbar-panel preset-panel">
      <div class="preset-inline-row">
        <v-btn
          class="preset-browser-launch"
          color="primary"
          variant="outlined"
          prepend-icon="mdi-folder-multiple-outline"
          @click="openPresetBrowser"
        >
          <div class="preset-browser-launch-content">
            <span class="preset-browser-launch-name">{{ currentPreset?.name ?? 'No preset selected' }}</span>
            <span class="preset-browser-launch-path">{{ currentPresetFolderPathLabel }}</span>
          </div>
        </v-btn>
        <div class="preset-state-pill" :class="{ dirty: isDirty }">
          <v-icon size="16">{{ isDirty ? 'mdi-circle-edit-outline' : 'mdi-check-circle-outline' }}</v-icon>
          <span>{{ isDirty ? 'Unsaved changes' : 'Saved' }}</span>
        </div>
        <v-menu v-model="presetMenuOpen" location="bottom end">
          <template #activator="{ props }">
            <v-btn v-bind="props" class="preset-menu-btn" color="secondary" variant="tonal" append-icon="mdi-chevron-down">
              Preset Actions
            </v-btn>
          </template>
          <v-list density="compact" class="preset-action-menu">
            <v-list-item
              title="Rename"
              prepend-icon="mdi-form-textbox"
              :disabled="!currentPreset"
              @click="openRenamePresetDialog"
            />
            <v-list-item
              title="Save"
              prepend-icon="mdi-content-save-outline"
              :disabled="!currentPreset || !isDirty"
              @click="saveCurrentPreset"
            />
            <v-list-item title="Save As" prepend-icon="mdi-content-save-edit-outline" @click="saveAsPreset" />
            <v-list-item title="New" prepend-icon="mdi-plus-box-outline" @click="createNewPreset" />
            <v-list-item title="Delete" prepend-icon="mdi-delete-outline" @click="deleteCurrentPreset" />
            <v-divider class="my-1" />
            <v-list-item title="Export Preset" prepend-icon="mdi-export-variant" @click="exportCurrentPreset" />
            <v-list-item title="Export Library" prepend-icon="mdi-database-export-outline" @click="exportPresetLibrary" />
            <v-list-item title="Import JSON" prepend-icon="mdi-file-import-outline" @click="triggerPresetImport" />
          </v-list>
        </v-menu>
      </div>
    </div>

    <input
      ref="presetFileInput"
      type="file"
      accept=".json,application/json"
      class="preset-file-input"
      @change="handlePresetFileImport"
    />

    <v-dialog v-model="showRenamePresetDialog" max-width="460px">
      <v-card class="rename-dialog-card">
        <v-card-title class="text-h6">Rename Preset</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renamePresetInput"
            label="Preset name"
            density="comfortable"
            variant="outlined"
            autofocus
            @keydown.enter.prevent="confirmPresetRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="cancelPresetRename">Cancel</v-btn>
          <v-btn color="primary" @click="confirmPresetRename" :disabled="!canSubmitPresetRename">Rename</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showCreatePresetDialog" max-width="460px">
      <v-card class="rename-dialog-card">
        <v-card-title class="text-h6">New Preset</v-card-title>
        <v-card-text>
          <v-text-field
            ref="createPresetInputRef"
            v-model="createPresetInput"
            label="Preset name"
            density="comfortable"
            variant="outlined"
            autofocus
            @keydown.enter.prevent="confirmCreatePreset"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="cancelCreatePreset">Cancel</v-btn>
          <v-btn color="primary" @click="confirmCreatePreset" :disabled="!canSubmitCreatePreset">Create</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="showPresetBrowser"
      max-width="1120px"
      scrim="#080906"
      opacity="0.78"
      :fullscreen="$vuetify.display.xs"
    >
      <v-card class="preset-browser-card">
        <v-card-title class="preset-browser-title">
          <div>
            <div class="text-h6">Preset Browser</div>
            <div class="text-caption preset-browser-subtitle">Browse folders, search presets, and manage your library.</div>
          </div>
          <v-spacer></v-spacer>
          <v-btn icon variant="text" @click="showPresetBrowser = false" title="Close preset browser">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-title>
        <v-card-text class="preset-browser-body">
          <div class="preset-browser-toolbar">
            <v-text-field
              v-model="presetBrowserSearch"
              density="compact"
              variant="outlined"
              hide-details
              prepend-inner-icon="mdi-magnify"
              label="Search presets or paths"
              class="preset-browser-search"
            />
            <v-btn color="secondary" variant="tonal" prepend-icon="mdi-folder-plus-outline" @click="createFolderInActivePresetFolder">
              New Folder
            </v-btn>
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus-box-outline" @click="createPresetInActiveFolder">
              New Preset
            </v-btn>
          </div>

          <div class="preset-browser-layout">
            <div class="preset-browser-tree">
              <button
                type="button"
                class="preset-folder-row"
                :class="{ active: activePresetFolderId === null }"
                @click="selectPresetFolder(null)"
              >
                <span class="preset-folder-row-title">/</span>
              </button>

              <div
                v-for="row in presetBrowserTreeRows"
                :key="row.folder.id"
                class="preset-folder-row"
                :class="{ active: activePresetFolderId === row.folder.id }"
                :style="{ paddingLeft: `${10 + row.level * 14}px` }"
              >
                <button
                  type="button"
                  class="preset-folder-expand"
                  :disabled="!row.hasChildren"
                  @click.stop="togglePresetFolderExpanded(row.folder.id)"
                >
                  <v-icon size="16">{{ row.hasChildren ? (row.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right') : 'mdi-circle-small' }}</v-icon>
                </button>
                <button type="button" class="preset-folder-row-label" @click="selectPresetFolder(row.folder.id)">
                  {{ row.folder.name }}
                </button>
                <v-menu location="bottom end">
                  <template #activator="{ props }">
                    <v-btn v-bind="props" icon size="x-small" variant="text" class="preset-item-menu-btn" title="Folder actions">
                      <v-icon size="16">mdi-dots-horizontal</v-icon>
                    </v-btn>
                  </template>
                  <v-list density="compact" class="preset-action-menu">
                    <v-list-item title="New subfolder" prepend-icon="mdi-folder-plus-outline" @click="createFolderInPresetFolder(row.folder.id)" />
                    <v-list-item title="Rename folder" prepend-icon="mdi-form-textbox" @click="renamePresetFolder(row.folder.id)" />
                    <v-list-item title="Move folder" prepend-icon="mdi-folder-move-outline" @click="openMoveFolderDialog(row.folder.id)" />
                    <v-list-item title="Delete folder" prepend-icon="mdi-delete-outline" @click="deletePresetFolder(row.folder.id)" />
                  </v-list>
                </v-menu>
              </div>
            </div>

            <div class="preset-browser-content">
              <div class="preset-browser-path-row">
                <span class="preset-browser-path-label">Current folder</span>
                <strong>{{ activePresetFolderPathLabel }}</strong>
              </div>

              <template v-if="presetBrowserSearch.trim().length > 0">
                <div class="preset-browser-section-title">Search results</div>
                <div v-if="presetBrowserSearchResults.length === 0" class="preset-browser-empty">No presets match your search.</div>
                <div
                  v-for="entry in presetBrowserSearchResults"
                  :key="entry.preset.id"
                  class="preset-item-row"
                  :class="{ active: entry.preset.id === presetLibrary.selectedPresetId }"
                >
                  <button type="button" class="preset-item-load" @click="loadPresetFromBrowser(entry.preset.id)">
                    <span class="preset-item-name">{{ entry.preset.name }}</span>
                    <span class="preset-item-path">{{ entry.path }}</span>
                  </button>
                  <v-menu location="bottom end">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon size="x-small" variant="text" class="preset-item-menu-btn" title="Preset actions">
                        <v-icon size="16">mdi-dots-horizontal</v-icon>
                      </v-btn>
                    </template>
                    <v-list density="compact" class="preset-action-menu">
                      <v-list-item title="Load preset" prepend-icon="mdi-folder-open-outline" @click="loadPresetFromBrowser(entry.preset.id)" />
                      <v-list-item
                        title="Merge tracks into current"
                        prepend-icon="mdi-playlist-plus"
                        :disabled="entry.preset.id === presetLibrary.selectedPresetId"
                        @click="mergeTracksFromPreset(entry.preset.id)"
                      />
                      <v-list-item title="Rename preset" prepend-icon="mdi-form-textbox" @click="renamePresetFromBrowser(entry.preset.id)" />
                      <v-list-item title="Move preset" prepend-icon="mdi-folder-move-outline" @click="openMovePresetDialog(entry.preset.id)" />
                      <v-list-item title="Delete preset" prepend-icon="mdi-delete-outline" @click="deletePresetFromBrowser(entry.preset.id)" />
                    </v-list>
                  </v-menu>
                </div>
              </template>

              <template v-else>
                <div class="preset-browser-section-title">Folders</div>
                <div v-if="activePresetChildFolders.length === 0" class="preset-browser-empty">No folders here yet.</div>
                <div v-for="folder in activePresetChildFolders" :key="folder.id" class="preset-item-row folder">
                  <button type="button" class="preset-item-load" @click="selectPresetFolder(folder.id)">
                    <span class="preset-item-name">{{ folder.name }}</span>
                    <span class="preset-item-path">Open folder</span>
                  </button>
                  <v-menu location="bottom end">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon size="x-small" variant="text" class="preset-item-menu-btn" title="Folder actions">
                        <v-icon size="16">mdi-dots-horizontal</v-icon>
                      </v-btn>
                    </template>
                    <v-list density="compact" class="preset-action-menu">
                      <v-list-item title="New subfolder" prepend-icon="mdi-folder-plus-outline" @click="createFolderInPresetFolder(folder.id)" />
                      <v-list-item title="Rename folder" prepend-icon="mdi-form-textbox" @click="renamePresetFolder(folder.id)" />
                      <v-list-item title="Move folder" prepend-icon="mdi-folder-move-outline" @click="openMoveFolderDialog(folder.id)" />
                      <v-list-item title="Delete folder" prepend-icon="mdi-delete-outline" @click="deletePresetFolder(folder.id)" />
                    </v-list>
                  </v-menu>
                </div>

                <div class="preset-browser-section-title">Presets</div>
                <div v-if="activePresetFolderPresets.length === 0" class="preset-browser-empty">No presets in this folder.</div>
                <div
                  v-for="preset in activePresetFolderPresets"
                  :key="preset.id"
                  class="preset-item-row"
                  :class="{ active: preset.id === presetLibrary.selectedPresetId }"
                >
                  <button type="button" class="preset-item-load" @click="loadPresetFromBrowser(preset.id)">
                    <span class="preset-item-name">{{ preset.name }}</span>
                  </button>
                  <v-menu location="bottom end">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon size="x-small" variant="text" class="preset-item-menu-btn" title="Preset actions">
                        <v-icon size="16">mdi-dots-horizontal</v-icon>
                      </v-btn>
                    </template>
                    <v-list density="compact" class="preset-action-menu">
                      <v-list-item title="Load preset" prepend-icon="mdi-folder-open-outline" @click="loadPresetFromBrowser(preset.id)" />
                      <v-list-item
                        title="Merge tracks into current"
                        prepend-icon="mdi-playlist-plus"
                        :disabled="preset.id === presetLibrary.selectedPresetId"
                        @click="mergeTracksFromPreset(preset.id)"
                      />
                      <v-list-item title="Rename preset" prepend-icon="mdi-form-textbox" @click="renamePresetFromBrowser(preset.id)" />
                      <v-list-item title="Move preset" prepend-icon="mdi-folder-move-outline" @click="openMovePresetDialog(preset.id)" />
                      <v-list-item title="Delete preset" prepend-icon="mdi-delete-outline" @click="deletePresetFromBrowser(preset.id)" />
                    </v-list>
                  </v-menu>
                </div>
              </template>
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showMoveDestinationDialog" max-width="480px">
      <v-card class="rename-dialog-card">
        <v-card-title class="text-h6">Move {{ moveDialogMode === 'folder' ? 'Folder' : 'Preset' }}</v-card-title>
        <v-card-text>
          <v-select
            v-model="moveDestinationFolderId"
            label="Destination folder"
            :items="availableMoveDestinationOptions"
            item-title="title"
            item-value="value"
            density="comfortable"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="cancelMoveDialog">Cancel</v-btn>
          <v-btn color="primary" @click="confirmMoveDialog">Move</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="showPresetBrowserNameDialog" max-width="460px">
      <v-card class="rename-dialog-card">
        <v-card-title class="text-h6">{{ presetBrowserNameDialogTitle }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="presetBrowserNameInput"
            label="Name"
            density="comfortable"
            variant="outlined"
            autofocus
            @keydown.enter.prevent="confirmPresetBrowserNameDialog"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn variant="text" @click="cancelPresetBrowserNameDialog">Cancel</v-btn>
          <v-btn color="primary" @click="confirmPresetBrowserNameDialog" :disabled="!canSubmitPresetBrowserNameDialog">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { presetStorageErrorMessage } from '../presetStorage';
import {
  DEFAULT_PRESET_DATA,
  buildPresetLibraryExport,
  buildSinglePresetExport,
  buildUniqueFolderName,
  buildUniquePresetNameInFolder,
  createFolder,
  createNamedPreset,
  deleteFolderRecursive,
  deletePreset,
  getFolderPath,
  isFolderDescendant,
  listChildFolders,
  listFolderPresets,
  mergeImportedPresetLibrary,
  mergePresetTracks,
  moveFolder,
  movePresetToFolder,
  parsePresetImportPayload,
  renameFolder,
  renamePreset,
  sanitizePresetName,
  savePresetLibrary,
  updatePresetData,
  arePresetDataEqual,
  type NamedPreset,
  type PresetData,
  type PresetFolder,
  type PresetLibrary,
  type PresetLibraryImportPayload,
} from '../presets';

type NoticeColor = 'info' | 'success' | 'warning' | 'error';
type NameDialogMode = 'new-folder' | 'rename-folder' | 'new-preset' | 'rename-preset';

export interface TextInputOptions {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
}

export interface PresetFolderTreeRow {
  folder: PresetFolder;
  level: number;
  expanded: boolean;
  hasChildren: boolean;
}

export default defineComponent({
  name: 'PresetManager',
  props: {
    initialLibrary: {
      type: Object as PropType<PresetLibrary>,
      required: true,
    },
    initialDirty: {
      type: Boolean,
      required: true,
    },
    draftData: {
      type: Object as PropType<PresetData>,
      required: true,
    },
    applyDraftData: {
      type: Function as PropType<(data: PresetData, options?: { preserveTrackMixStates?: boolean }) => void>,
      required: true,
    },
    confirmDiscardChanges: {
      type: Function as PropType<(actionLabel: string) => Promise<boolean>>,
      required: true,
    },
    askForConfirmation: {
      type: Function as PropType<(title: string, message: string, confirmLabel?: string) => Promise<boolean>>,
      required: true,
    },
    askForTextInput: {
      type: Function as PropType<(options: TextInputOptions) => Promise<string | null>>,
      required: true,
    },
    showNotice: {
      type: Function as PropType<(message: string, color?: NoticeColor) => void>,
      required: true,
    },
  },
  emits: ['dirty-change'],
  data() {
    const selectedPreset = this.initialLibrary.presets.find((preset) => preset.id === this.initialLibrary.selectedPresetId)
      ?? this.initialLibrary.presets[0]
      ?? null;

    return {
      presetLibrary: this.initialLibrary,
      activePresetFolderId: selectedPreset?.folderId ?? null as string | null,
      dirtyState: this.initialDirty,
      showPresetBrowser: false,
      presetBrowserSearch: '',
      expandedPresetFolderIds: [] as string[],
      showMoveDestinationDialog: false,
      moveDialogMode: null as 'preset' | 'folder' | null,
      moveTargetId: null as string | null,
      moveDestinationFolderId: null as string | null,
      showPresetBrowserNameDialog: false,
      presetBrowserNameDialogMode: null as NameDialogMode | null,
      presetBrowserNameDialogTargetId: null as string | null,
      presetBrowserNameDialogFolderId: null as string | null,
      presetBrowserNameInput: '',
      showRenamePresetDialog: false,
      renamePresetInput: '',
      showCreatePresetDialog: false,
      createPresetInput: '',
      presetMenuOpen: false,
      isPersisting: false,
    };
  },
  computed: {
    currentPreset(): NamedPreset | null {
      return this.presetLibrary.presets.find((preset) => preset.id === this.presetLibrary.selectedPresetId)
        ?? this.presetLibrary.presets[0]
        ?? null;
    },
    isDirty(): boolean {
      return this.dirtyState;
    },
    currentPresetFolderPath(): PresetFolder[] {
      return this.currentPreset ? getFolderPath(this.presetLibrary, this.currentPreset.folderId) : [];
    },
    currentPresetFolderPathLabel(): string {
      if (!this.currentPreset) {
        return '/';
      }
      const segments = this.currentPresetFolderPath.map((folder) => folder.name);
      return segments.length > 0 ? segments.join(' / ') : '/';
    },
    activePresetFolderPathLabel(): string {
      const segments = getFolderPath(this.presetLibrary, this.activePresetFolderId).map((folder) => folder.name);
      return segments.length > 0 ? segments.join(' / ') : '/';
    },
    presetBrowserTreeRows(): PresetFolderTreeRow[] {
      const childrenByParent = new Map<string | null, PresetFolder[]>();
      for (const folder of this.presetLibrary.folders) {
        const existing = childrenByParent.get(folder.parentFolderId) ?? [];
        existing.push(folder);
        childrenByParent.set(folder.parentFolderId, existing);
      }

      for (const folders of childrenByParent.values()) {
        folders.sort((left, right) => left.name.localeCompare(right.name));
      }

      const expanded = new Set(this.expandedPresetFolderIds);
      const showAll = this.presetBrowserSearch.trim().length > 0;
      const rows: PresetFolderTreeRow[] = [];
      const walk = (parentFolderId: string | null, level: number) => {
        for (const folder of childrenByParent.get(parentFolderId) ?? []) {
          const hasChildren = (childrenByParent.get(folder.id)?.length ?? 0) > 0;
          const isExpanded = showAll || expanded.has(folder.id);
          rows.push({ folder, level, expanded: isExpanded, hasChildren });
          if (hasChildren && isExpanded) {
            walk(folder.id, level + 1);
          }
        }
      };

      walk(null, 0);
      return rows;
    },
    activePresetChildFolders(): PresetFolder[] {
      return listChildFolders(this.presetLibrary, this.activePresetFolderId)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    activePresetFolderPresets(): NamedPreset[] {
      return listFolderPresets(this.presetLibrary, this.activePresetFolderId)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    presetBrowserSearchResults(): Array<{ preset: NamedPreset; path: string }> {
      const query = this.presetBrowserSearch.trim().toLowerCase();
      if (!query) {
        return [];
      }

      return this.presetLibrary.presets
        .filter((preset) => {
          const path = this.formatFolderPath(preset.folderId).toLowerCase();
          return preset.name.toLowerCase().includes(query) || path.includes(query);
        })
        .map((preset) => ({ preset, path: this.formatFolderPath(preset.folderId) }))
        .sort((left, right) => left.preset.name.localeCompare(right.preset.name));
    },
    presetMoveDestinationOptions(): Array<{ title: string; value: string | null }> {
      const options: Array<{ title: string; value: string | null }> = [{ title: '/', value: null }];
      for (const folder of this.presetLibrary.folders) {
        options.push({ title: this.formatFolderPath(folder.id), value: folder.id });
      }
      return options.sort((left, right) => left.title.localeCompare(right.title));
    },
    availableMoveDestinationOptions(): Array<{ title: string; value: string | null }> {
      if (this.moveDialogMode !== 'folder' || !this.moveTargetId) {
        return this.presetMoveDestinationOptions;
      }

      const moveTargetId = this.moveTargetId;
      return this.presetMoveDestinationOptions.filter((option) => {
        if (option.value === moveTargetId) {
          return false;
        }
        if (!option.value) {
          return true;
        }
        return !isFolderDescendant(this.presetLibrary, moveTargetId, option.value);
      });
    },
    presetBrowserNameDialogTitle(): string {
      if (this.presetBrowserNameDialogMode === 'new-folder') return 'New Folder';
      if (this.presetBrowserNameDialogMode === 'rename-folder') return 'Rename Folder';
      if (this.presetBrowserNameDialogMode === 'new-preset') return 'New Preset';
      if (this.presetBrowserNameDialogMode === 'rename-preset') return 'Rename Preset';
      return 'Name';
    },
    canSubmitPresetBrowserNameDialog(): boolean {
      return this.presetBrowserNameInput.trim().length > 0;
    },
    canSubmitPresetRename(): boolean {
      if (!this.currentPreset) return false;
      return sanitizePresetName(this.renamePresetInput) !== this.currentPreset.name;
    },
    canSubmitCreatePreset(): boolean {
      return this.createPresetInput.trim().length > 0;
    },
  },
  watch: {
    draftData: {
      handler() {
        this.syncDirtyState();
      },
      deep: true,
    },
  },
  methods: {
    syncDirtyState() {
      this.dirtyState = this.currentPreset ? !arePresetDataEqual(this.draftData, this.currentPreset.data) : false;
      this.$emit('dirty-change', this.dirtyState);
    },
    formatFolderPath(folderId: string | null): string {
      const segments = getFolderPath(this.presetLibrary, folderId).map((folder) => folder.name);
      return segments.length > 0 ? segments.join(' / ') : '/';
    },
    openPresetBrowser() {
      this.activePresetFolderId = this.currentPreset?.folderId ?? this.activePresetFolderId ?? null;
      this.showPresetBrowser = true;
    },
    selectPresetFolder(folderId: string | null) {
      this.activePresetFolderId = folderId;
      if (folderId && !this.expandedPresetFolderIds.includes(folderId)) {
        this.expandedPresetFolderIds = [...this.expandedPresetFolderIds, folderId];
      }
    },
    togglePresetFolderExpanded(folderId: string) {
      this.expandedPresetFolderIds = this.expandedPresetFolderIds.includes(folderId)
        ? this.expandedPresetFolderIds.filter((id) => id !== folderId)
        : [...this.expandedPresetFolderIds, folderId];
    },
    openPresetBrowserNameDialog(mode: NameDialogMode, options: { targetId?: string | null; folderId?: string | null; initialName?: string } = {}) {
      this.presetBrowserNameDialogMode = mode;
      this.presetBrowserNameDialogTargetId = options.targetId ?? null;
      this.presetBrowserNameDialogFolderId = options.folderId ?? null;
      this.presetBrowserNameInput = options.initialName ?? '';
      this.showPresetBrowserNameDialog = true;
    },
    cancelPresetBrowserNameDialog() {
      this.showPresetBrowserNameDialog = false;
      this.presetBrowserNameDialogMode = null;
      this.presetBrowserNameDialogTargetId = null;
      this.presetBrowserNameDialogFolderId = null;
      this.presetBrowserNameInput = '';
    },
    async confirmPresetBrowserNameDialog() {
      if (!this.canSubmitPresetBrowserNameDialog || !this.presetBrowserNameDialogMode) return;

      const value = this.presetBrowserNameInput;
      if (this.presetBrowserNameDialogMode === 'new-folder') {
        const result = createFolder(this.presetLibrary, value, this.presetBrowserNameDialogFolderId);
        if (!(await this.persistPresetLibrary(result.library))) return;
        this.activePresetFolderId = result.folder.id;
        if (!this.expandedPresetFolderIds.includes(result.folder.id)) {
          this.expandedPresetFolderIds = [...this.expandedPresetFolderIds, result.folder.id];
        }
      } else if (this.presetBrowserNameDialogMode === 'rename-folder' && this.presetBrowserNameDialogTargetId) {
        if (!(await this.persistPresetLibrary(renameFolder(this.presetLibrary, this.presetBrowserNameDialogTargetId, value)))) return;
      } else if (this.presetBrowserNameDialogMode === 'new-preset') {
        const folderId = this.presetBrowserNameDialogFolderId;
        const preset = { ...createNamedPreset(this.buildUniquePresetName(value, folderId), DEFAULT_PRESET_DATA), folderId };
        if (!(await this.persistPresetLibrary({ ...this.presetLibrary, presets: [...this.presetLibrary.presets, preset] }))) return;
      } else if (this.presetBrowserNameDialogMode === 'rename-preset' && this.presetBrowserNameDialogTargetId) {
        if (!(await this.persistPresetLibrary(renamePreset(this.presetLibrary, this.presetBrowserNameDialogTargetId, value)))) return;
      }

      this.cancelPresetBrowserNameDialog();
    },
    createFolderInPresetFolder(parentFolderId: string | null) {
      this.openPresetBrowserNameDialog('new-folder', {
        folderId: parentFolderId,
        initialName: buildUniqueFolderName(this.presetLibrary, 'New folder', parentFolderId),
      });
    },
    createFolderInActivePresetFolder() {
      this.createFolderInPresetFolder(this.activePresetFolderId);
    },
    renamePresetFolder(folderId: string) {
      const folder = this.presetLibrary.folders.find((entry) => entry.id === folderId);
      if (!folder) return;

      this.openPresetBrowserNameDialog('rename-folder', {
        targetId: folderId,
        folderId: folder.parentFolderId,
        initialName: buildUniqueFolderName(this.presetLibrary, folder.name, folder.parentFolderId, folder.id),
      });
    },
    async deletePresetFolder(folderId: string) {
      const folder = this.presetLibrary.folders.find((entry) => entry.id === folderId);
      if (!folder) return;

      const result = deleteFolderRecursive(this.presetLibrary, folderId);
      if (result.deletedFolderIds.length === 0) return;

      const deletedCurrentPreset = this.currentPreset ? result.deletedPresetIds.includes(this.currentPreset.id) : false;
      if (deletedCurrentPreset && !(await this.confirmDiscardChanges('Delete this folder subtree and discard them'))) return;
      const shouldDelete = await this.askForConfirmation(
        'Delete Folder',
        `Delete folder "${folder.name}" and ${result.deletedFolderIds.length - 1} subfolder(s), plus ${result.deletedPresetIds.length} preset(s)? This cannot be undone.`,
        'Delete',
      );
      if (!shouldDelete) return;

      if (!(await this.persistPresetLibrary(result.library))) return;
      this.activePresetFolderId = null;
      if (deletedCurrentPreset && result.selectedPresetId) {
        await this.loadPresetById(result.selectedPresetId, result.library);
      }
    },
    createPresetInActiveFolder() {
      this.openPresetBrowserNameDialog('new-preset', {
        folderId: this.activePresetFolderId,
        initialName: buildUniquePresetNameInFolder(this.presetLibrary, 'New preset', this.activePresetFolderId),
      });
    },
    renamePresetFromBrowser(presetId: string) {
      const preset = this.presetLibrary.presets.find((entry) => entry.id === presetId);
      if (!preset) return;

      this.openPresetBrowserNameDialog('rename-preset', {
        targetId: presetId,
        folderId: preset.folderId,
        initialName: this.buildUniquePresetName(preset.name, preset.folderId, preset.id),
      });
    },
    async deletePresetFromBrowser(presetId: string) {
      const preset = this.presetLibrary.presets.find((entry) => entry.id === presetId);
      if (!preset) return;

      const deletingCurrent = this.currentPreset?.id === presetId;
      if (deletingCurrent && !(await this.confirmDiscardChanges(`Delete preset "${preset.name}" and discard them`))) return;
      const shouldDelete = await this.askForConfirmation('Delete Preset', `Delete preset "${preset.name}"? This cannot be undone.`, 'Delete');
      if (!shouldDelete) return;

      const result = deletePreset(this.presetLibrary, presetId);
      if (!(await this.persistPresetLibrary(result.library))) return;
      if (deletingCurrent && result.selectedPresetId) {
        await this.loadPresetById(result.selectedPresetId, result.library);
      }
    },
    async mergeTracksFromPreset(presetId: string) {
      const sourcePreset = this.presetLibrary.presets.find((preset) => preset.id === presetId);
      const currentPreset = this.currentPreset;
      if (!sourcePreset || !currentPreset || sourcePreset.id === currentPreset.id) return;

      const trackCount = sourcePreset.data.tracks.length;
      const shouldMerge = await this.askForConfirmation(
        'Merge Preset Tracks',
        `Add ${trackCount} track${trackCount === 1 ? '' : 's'} from "${sourcePreset.name}" to "${currentPreset.name}"? Current song settings will stay unchanged.`,
        'Merge',
      );
      if (!shouldMerge) return;

      this.applyDraftData(mergePresetTracks(this.draftData, sourcePreset.data), { preserveTrackMixStates: true });
      this.syncDirtyState();
      this.showNotice(`Merged ${trackCount} track${trackCount === 1 ? '' : 's'} from "${sourcePreset.name}".`, 'success');
    },
    openMovePresetDialog(presetId: string) {
      this.moveDialogMode = 'preset';
      this.moveTargetId = presetId;
      this.moveDestinationFolderId = this.presetLibrary.presets.find((preset) => preset.id === presetId)?.folderId ?? null;
      this.showMoveDestinationDialog = true;
    },
    openMoveFolderDialog(folderId: string) {
      this.moveDialogMode = 'folder';
      this.moveTargetId = folderId;
      this.moveDestinationFolderId = this.presetLibrary.folders.find((folder) => folder.id === folderId)?.parentFolderId ?? null;
      this.showMoveDestinationDialog = true;
    },
    cancelMoveDialog() {
      this.showMoveDestinationDialog = false;
      this.moveDialogMode = null;
      this.moveTargetId = null;
      this.moveDestinationFolderId = null;
    },
    async confirmMoveDialog() {
      if (!this.moveDialogMode || !this.moveTargetId) {
        this.cancelMoveDialog();
        return;
      }

      const nextLibrary = this.moveDialogMode === 'preset'
        ? movePresetToFolder(this.presetLibrary, this.moveTargetId, this.moveDestinationFolderId)
        : moveFolder(this.presetLibrary, this.moveTargetId, this.moveDestinationFolderId);
      if (!(await this.persistPresetLibrary(nextLibrary))) return;
      this.cancelMoveDialog();
    },
    openRenamePresetDialog() {
      if (!this.currentPreset) return;
      this.renamePresetInput = this.currentPreset.name;
      this.showRenamePresetDialog = true;
    },
    cancelPresetRename() {
      this.showRenamePresetDialog = false;
      this.renamePresetInput = '';
    },
    async confirmPresetRename() {
      if (!this.currentPreset) return;
      if (!this.canSubmitPresetRename) {
        this.cancelPresetRename();
        return;
      }
      if (!(await this.renameCurrentPreset(this.renamePresetInput))) return;
      this.cancelPresetRename();
    },
    openCreatePresetDialog() {
      this.createPresetInput = this.buildUniquePresetName('New preset', this.activePresetFolderId);
      this.showCreatePresetDialog = true;
      this.focusCreatePresetInput();
    },
    focusCreatePresetInput() {
      this.$nextTick(() => {
        window.requestAnimationFrame(() => {
          const input = (this.$refs.createPresetInputRef as { $el?: HTMLElement } | undefined)?.$el?.querySelector('input') as HTMLInputElement | null;
          input?.focus();
          input?.select();
        });
      });
    },
    cancelCreatePreset() {
      this.showCreatePresetDialog = false;
      this.createPresetInput = '';
    },
    async confirmCreatePreset() {
      if (!this.canSubmitCreatePreset) return;

      const folderId = this.activePresetFolderId;
      const preset = {
        ...createNamedPreset(this.buildUniquePresetName(this.createPresetInput, folderId), DEFAULT_PRESET_DATA),
        folderId,
      };
      if (!(await this.persistPresetLibrary({
        ...this.presetLibrary,
        presets: [...this.presetLibrary.presets, preset],
        selectedPresetId: preset.id,
      }))) return;
      this.applyDraftData(preset.data);
      this.cancelCreatePreset();
    },
    async persistPresetLibrary(library: PresetLibrary): Promise<boolean> {
      if (this.isPersisting) {
        this.showNotice('A preset save is still in progress. Please retry when it finishes.', 'info');
        return false;
      }
      this.isPersisting = true;
      try {
        await savePresetLibrary(library);
        this.presetLibrary = library;
        if (this.activePresetFolderId && !library.folders.some((folder) => folder.id === this.activePresetFolderId)) {
          this.activePresetFolderId = null;
        }
        this.syncDirtyState();
        return true;
      } catch (error) {
        this.showNotice(presetStorageErrorMessage(error), 'error');
        return false;
      } finally {
        this.isPersisting = false;
      }
    },
    async loadPresetById(presetId: string, libraryOverride?: PresetLibrary): Promise<boolean> {
      const library = libraryOverride ?? this.presetLibrary;
      const preset = library.presets.find((entry) => entry.id === presetId);
      if (!preset) return false;

      const nextLibrary = { ...library, selectedPresetId: preset.id };
      if (!(await this.persistPresetLibrary(nextLibrary))) return false;
      this.activePresetFolderId = preset.folderId;
      this.applyDraftData(preset.data);
      this.syncDirtyState();
      return true;
    },
    buildUniquePresetName(baseName: string, folderId: string | null, excludedPresetId?: string): string {
      return buildUniquePresetNameInFolder(this.presetLibrary, baseName, folderId, excludedPresetId);
    },
    async renameCurrentPreset(baseName?: string): Promise<boolean> {
      const currentPreset = this.currentPreset;
      if (!currentPreset) return false;

      const nextName = this.buildUniquePresetName(baseName ?? currentPreset.name, currentPreset.folderId, currentPreset.id);
      if (nextName === currentPreset.name) return true;

      const nextLibrary = renamePreset(this.presetLibrary, currentPreset.id, nextName);
      if (!(await this.persistPresetLibrary(nextLibrary))) return false;
      this.showNotice(`Renamed preset to "${nextLibrary.presets.find((preset) => preset.id === currentPreset.id)?.name ?? nextName}".`, 'success');
      return true;
    },
    async saveCurrentPreset() {
      const currentPreset = this.currentPreset;
      if (!currentPreset) return;

      const updatedPreset = updatePresetData(currentPreset, this.draftData);
      if (!(await this.persistPresetLibrary({
        ...this.presetLibrary,
        presets: this.presetLibrary.presets.map((preset) => preset.id === updatedPreset.id ? updatedPreset : preset),
        selectedPresetId: updatedPreset.id,
      }))) return;
      this.syncDirtyState();
      this.showNotice(`Saved preset "${updatedPreset.name}".`, 'success');
    },
    async saveAsPreset() {
      const folderId = this.currentPreset?.folderId ?? null;
      const requestedName = await this.askForTextInput({
        title: 'Save Preset Copy',
        label: 'Preset name',
        initialValue: this.buildUniquePresetName(`${this.currentPreset?.name ?? 'Preset'} Copy`, folderId),
        confirmLabel: 'Create',
      });
      if (requestedName === null) return;

      const newPreset = {
        ...createNamedPreset(this.buildUniquePresetName(requestedName, folderId), this.draftData),
        folderId,
      };
      if (!(await this.persistPresetLibrary({
        ...this.presetLibrary,
        presets: [...this.presetLibrary.presets, newPreset],
        selectedPresetId: newPreset.id,
      }))) return;
      this.activePresetFolderId = folderId;
      this.applyDraftData(newPreset.data);
      this.syncDirtyState();
      this.showNotice(`Created preset "${newPreset.name}".`, 'success');
    },
    async createNewPreset() {
      this.presetMenuOpen = false;
      if (!(await this.confirmDiscardChanges('Create a new preset and discard them'))) return;
      this.activePresetFolderId = this.currentPreset?.folderId ?? null;
      this.$nextTick(() => this.openCreatePresetDialog());
    },
    async deleteCurrentPreset() {
      const currentPreset = this.currentPreset;
      if (!currentPreset) return;
      if (!(await this.confirmDiscardChanges(`Delete preset "${currentPreset.name}" and discard them`))) return;
      const shouldDelete = await this.askForConfirmation('Delete Preset', `Delete preset "${currentPreset.name}"? This cannot be undone.`, 'Delete');
      if (!shouldDelete) return;

      const result = deletePreset(this.presetLibrary, currentPreset.id);
      const fallbackPreset = result.library.presets.find((preset) => preset.id === result.selectedPresetId) ?? result.library.presets[0];
      if (!fallbackPreset) return;
      if (!(await this.persistPresetLibrary(result.library))) return;
      this.activePresetFolderId = fallbackPreset.folderId;
      this.applyDraftData(fallbackPreset.data);
      this.syncDirtyState();
    },
    sanitizeFilenamePart(value: string) {
      return value.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'preset';
    },
    currentPresetFilenamePart() {
      return this.sanitizeFilenamePart(this.currentPreset?.name ?? 'preset');
    },
    downloadJson(filename: string, payload: object) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    formattedDate() {
      const date = new Date();
      return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;
    },
    buildLibraryForExport(): PresetLibrary {
      const currentPreset = this.currentPreset;
      if (!currentPreset) return this.presetLibrary;
      return {
        ...this.presetLibrary,
        presets: this.presetLibrary.presets.map((preset) => preset.id === currentPreset.id ? updatePresetData(preset, this.draftData) : preset),
      };
    },
    exportCurrentPreset() {
      const currentPreset = this.currentPreset;
      if (!currentPreset) return;
      const exportPreset = updatePresetData(currentPreset, this.draftData);
      this.downloadJson(`gaterunner-preset-${this.currentPresetFilenamePart()}-${this.formattedDate()}.json`, buildSinglePresetExport(exportPreset));
    },
    exportPresetLibrary() {
      this.downloadJson(`gaterunner-preset-library-${this.formattedDate()}.json`, buildPresetLibraryExport(this.buildLibraryForExport()));
    },
    triggerPresetImport() {
      (this.$refs.presetFileInput as HTMLInputElement | undefined)?.click();
    },
    async handlePresetFileImport(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      try {
        const payload = parsePresetImportPayload(await file.text());
        const importedLibrary: PresetLibraryImportPayload = payload.kind === 'single-preset'
          ? {
            version: payload.version,
            kind: 'preset-library',
            exportedAt: payload.exportedAt,
            selectedPresetId: payload.preset.id,
            folders: [],
            presets: [payload.preset],
          }
          : payload;
        const mergeResult = mergeImportedPresetLibrary(this.presetLibrary, importedLibrary, {
          preferredSelectedPresetId: importedLibrary.selectedPresetId,
          singlePresetDestinationFolderId: payload.kind === 'single-preset' ? this.activePresetFolderId : undefined,
        });
        if (mergeResult.importedPresets.length === 0) {
          this.showNotice('No presets were imported.', 'warning');
          return;
        }

        const shouldLoad = mergeResult.selectedPresetId !== null
          && await this.confirmDiscardChanges('Load the imported preset and discard them');
        const nextLibrary = { ...mergeResult.library,
          selectedPresetId: shouldLoad ? mergeResult.selectedPresetId : this.presetLibrary.selectedPresetId };
        if (!(await this.persistPresetLibrary(nextLibrary))) return;
        if (shouldLoad) {
          const preset = nextLibrary.presets.find(entry => entry.id === mergeResult.selectedPresetId)!;
          this.activePresetFolderId = preset.folderId;
          this.applyDraftData(preset.data);
          this.syncDirtyState();
        }
        this.showNotice(`Imported ${mergeResult.importedPresets.length} preset${mergeResult.importedPresets.length === 1 ? '' : 's'}.`, 'success');
      } catch (error) {
        this.showNotice(error instanceof Error ? error.message : 'Unable to import preset file.', 'error');
      } finally {
        input.value = '';
      }
    },
    async loadPresetFromBrowser(presetId: string) {
      const before = this.presetLibrary.selectedPresetId;
      if (!(await this.handlePresetSelection(presetId))) return;
      if (this.presetLibrary.selectedPresetId !== before) {
        this.showPresetBrowser = false;
      }
    },
    async handlePresetSelection(nextPresetId: string): Promise<boolean> {
      const currentPresetId = this.presetLibrary.selectedPresetId;
      if (!nextPresetId || nextPresetId === currentPresetId) return false;
      if (!(await this.confirmDiscardChanges('Load another preset and discard them'))) return false;
      return this.loadPresetById(nextPresetId);
    },
  },
});
</script>

<style scoped>
.toolbar-panel {
  padding: 8px 10px;
  border-radius: 0;
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-deep);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
}

.preset-panel {
  overflow-x: auto;
}

.preset-inline-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  min-width: 760px;
}

.preset-browser-launch {
  width: 100%;
  min-height: 40px;
  justify-content: flex-start;
  padding-inline: 10px;
}

.preset-browser-launch-content {
  min-width: 0;
  display: grid;
  line-height: 1.15;
  text-align: left;
}

.preset-browser-launch-name {
  font-weight: 700;
  color: var(--instrument-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-browser-launch-path {
  color: var(--instrument-muted);
  font-size: 0.73rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-state-pill {
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--panel-border-soft);
  border-radius: 0;
  background: var(--panel-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--instrument-muted);
  font-size: 0.82rem;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.preset-state-pill.dirty {
  color: #ffd487;
  border-color: rgba(242, 184, 75, 0.56);
  background: rgba(112, 73, 22, 0.32);
}

.preset-menu-btn {
  min-width: 164px;
}

.preset-action-menu {
  min-width: 240px;
  border: 1px solid var(--panel-border-soft);
  background: rgba(28, 30, 25, 0.98);
}

.preset-browser-card {
  border: 1px solid rgba(180, 177, 133, 0.48);
  background: #1c1e19;
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.72);
}

.preset-browser-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.preset-browser-subtitle {
  color: var(--instrument-muted);
}

.preset-browser-body {
  display: grid;
  gap: 10px;
  max-height: 72vh;
}

.preset-browser-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.preset-browser-search {
  min-width: 0;
}

.preset-browser-layout {
  min-height: 420px;
  display: grid;
  grid-template-columns: minmax(230px, 0.9fr) minmax(0, 1.4fr);
  gap: 10px;
}

.preset-browser-tree,
.preset-browser-content {
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-inset);
  overflow: auto;
}

.preset-browser-tree {
  padding: 7px;
}

.preset-browser-content {
  padding: 10px;
  display: grid;
  align-content: start;
  gap: 7px;
}

.preset-browser-path-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
  color: var(--instrument-text);
  border-bottom: 1px solid var(--panel-border-soft);
  padding-bottom: 5px;
}

.preset-browser-path-label {
  color: var(--instrument-muted);
  font-size: 0.78rem;
}

.preset-browser-section-title {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--indicator-amber);
  margin-top: 2px;
}

.preset-browser-empty {
  font-size: 0.83rem;
  color: var(--instrument-muted);
  padding: 6px 8px;
  border: 1px dashed var(--panel-border-soft);
}

.preset-folder-row {
  width: 100%;
  min-height: 31px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--instrument-text);
  text-align: left;
  padding: 1px 4px;
}

.preset-folder-row.active {
  border-color: rgba(242, 184, 75, 0.65);
  background: rgba(242, 184, 75, 0.14);
}

.preset-folder-expand {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--instrument-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preset-folder-expand:disabled {
  opacity: 0.42;
}

.preset-folder-row-label {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  font-size: 0.84rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-folder-row-title {
  grid-column: 2;
  font-size: 0.84rem;
  font-weight: 700;
}

.preset-item-row {
  min-height: 38px;
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-raised);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.preset-item-row.active {
  border-color: rgba(242, 184, 75, 0.65);
  background: rgba(242, 184, 75, 0.12);
}

.preset-item-row.folder {
  background: rgba(39, 41, 32, 0.72);
}

.preset-item-load {
  border: none;
  background: transparent;
  color: var(--instrument-text);
  padding: 7px 9px;
  text-align: left;
  display: grid;
  gap: 1px;
}

.preset-item-name {
  font-size: 0.87rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-item-path {
  font-size: 0.72rem;
  color: var(--instrument-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-item-menu-btn {
  margin-right: 2px;
}

.preset-file-input {
  display: none;
}

.rename-dialog-card {
  border: 1px solid var(--panel-border-soft);
  background: var(--panel-deep);
}

@media (max-width: 960px) {
  .preset-inline-row {
    min-width: 700px;
  }

  .preset-browser-layout {
    grid-template-columns: minmax(200px, 0.9fr) minmax(0, 1.2fr);
  }
}

@media (max-width: 680px) {
  .toolbar-panel {
    padding: 8px 9px;
    border-radius: 0;
  }

  .preset-panel {
    overflow-x: visible;
  }

  .preset-inline-row {
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "selector state"
      "menu menu";
    column-gap: 6px;
    row-gap: 8px;
  }

  .preset-browser-launch {
    grid-area: selector;
  }

  .preset-state-pill {
    grid-area: state;
    font-size: 0.75rem;
    padding: 6px 10px;
  }

  .preset-menu-btn {
    grid-area: menu;
    width: 100%;
    min-width: 0;
  }

  .preset-browser-body {
    min-height: 0;
    max-height: none;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
  }

  .preset-browser-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preset-browser-search {
    grid-column: 1 / -1;
  }

  .preset-browser-layout {
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(88px, 20vh);
    grid-template-areas:
      "content"
      "tree";
    overflow: hidden;
  }

  .preset-browser-card {
    height: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .preset-browser-title {
    min-height: 56px;
    padding-block: 10px;
    align-items: center;
  }

  .preset-browser-subtitle {
    display: none;
  }

  .preset-browser-tree {
    grid-area: tree;
  }

  .preset-browser-content {
    grid-area: content;
  }
}
</style>
