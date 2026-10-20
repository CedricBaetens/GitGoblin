<script setup lang="ts">
import { X, ChevronLeft, ChevronRight, Check, FileCode2, AlertTriangle, ArrowDown, GitMerge } from 'lucide-vue-next';
import type { Snapshot, GitRequest } from '~/lib/types';
import { conflictBlocks, acceptConflict, acceptConflictLines, hasConflictMarkers, conflictSidePreview } from '~/lib/conflicts';
interface Conflict { base: string; ours: string; theirs: string; result: string; fingerprint: string; binary: boolean; oursExists: boolean; theirsExists: boolean }
const props = defineProps<{ snapshot: Snapshot; initialPath: string; gitOutput?: string; read: <T>(action: string, params?: Partial<GitRequest>) => Promise<T>; mutate: (action: string, params?: Partial<GitRequest>) => Promise<unknown> }>();
const emit = defineEmits<{ close: [] }>();
const path = ref(''), current = ref<Conflict>(), loading = ref(false), error = ref(''), details = ref(props.gitOutput || ''), discard = ref(false), abort = ref(false);
const drafts = reactive(new Map<string, Conflict>()), originals = new Map<string, string>();
const files = computed(() => props.snapshot.files.filter(file => file.conflict));
const operation = computed(() => props.snapshot.operation);
const oursLabel = computed(() => operation.value === 'rebase' ? 'Target branch' : 'Current branch');
const theirsLabel = computed(() => operation.value === 'rebase' ? 'Commit being replayed' : 'Incoming changes');
const blocks = computed(() => conflictBlocks(current.value?.result || ''));
const activeIndex = ref(0), selectedOurs = ref<number[]>([]), selectedTheirs = ref<number[]>([]);
const resultEditor = ref<{ reveal: (offset: number, end: number) => void }>();
const sourceEditors = ref<{ reveal: (start: number, end: number) => void }[]>([]);
const previews = computed(() => ({ ours: conflictSidePreview(current.value?.result || '', 'ours', activeIndex.value), theirs: conflictSidePreview(current.value?.result || '', 'theirs', activeIndex.value) }));
function revealConflict() {
  if (!activeBlock.value) return;
  resultEditor.value?.reveal(activeBlock.value.start, activeBlock.value.end);
  sourceEditors.value.forEach((editor, index) => { const preview = index === 0 ? previews.value.ours : previews.value.theirs; editor.reveal(preview.start, preview.end); });
}
const activeBlock = computed(() => blocks.value[activeIndex.value]);
const resultRange = computed(() => activeBlock.value ? {
  start: current.value!.result.slice(0, activeBlock.value.start).split('\n').length - 1,
  end: current.value!.result.slice(0, activeBlock.value.end).split('\n').length - 2,
} : undefined);
const canSave = computed(() => !!current.value && !current.value.binary && !hasConflictMarkers(current.value.result));
const filename = (file: string) => file.split('/').at(-1) || file;
const directory = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
watch(() => [path.value, loading.value], async () => {
  await nextTick();
  if (!loading.value) revealConflict();
});
const dirty = computed(() => [...drafts.values()].some(item => item.result !== originals.get(item.fingerprint)));
watch(() => [path.value, activeBlock.value?.start, activeBlock.value?.ours, activeBlock.value?.theirs], () => { selectedOurs.value = []; selectedTheirs.value = []; });
watch(() => blocks.value.length, length => { activeIndex.value = Math.max(0, Math.min(activeIndex.value, length - 1)); });
function toggleLine(side: 'ours' | 'theirs', line: number) {
  const selection = side === 'ours' ? selectedOurs : selectedTheirs;
  selection.value = selection.value.includes(line) ? selection.value.filter(index => index !== line) : [...selection.value, line];
}
async function navigate(direction: number) {
  activeIndex.value = Math.max(0, Math.min(blocks.value.length - 1, activeIndex.value + direction));
  await nextTick();
  revealConflict();
}
function accept(side: 'ours' | 'theirs' | 'both' | 'lines') {
  if (!current.value || !activeBlock.value) return;
  current.value.result = side === 'lines'
    ? acceptConflictLines(current.value.result, activeBlock.value, selectedOurs.value, selectedTheirs.value)
    : acceptConflict(current.value.result, activeBlock.value, side);
  void navigate(0);
}
let request = 0;
async function select(file: string) {
  const id = ++request;
  activeIndex.value = 0; path.value = file; current.value = undefined; error.value = ''; loading.value = true;
  try {
    let item = drafts.get(file);
    if (!item) { item = await props.read<Conflict>('conflict', { path: file }); drafts.set(file, item); originals.set(item.fingerprint, item.result); }
    if (id === request) current.value = item;
  } catch (e) { if (id === request) error.value = String(e); }
  finally { if (id === request) loading.value = false; }
}
async function resolve(mode = '') {
  if (!current.value || loading.value) return;
  loading.value = true; error.value = '';
  try {
    await props.mutate('resolve', { path: path.value, text: current.value.result, fingerprint: current.value.fingerprint, mode });
    drafts.delete(path.value); current.value = undefined;
    if (files.value[0]) await select(files.value[0].path);
  } catch (e) { error.value = String(e); }
  finally { loading.value = false; }
}
async function run(action: 'continue' | 'abort') {
  loading.value = true; error.value = ''; abort.value = false;
  try { await props.mutate(action, { mode: operation.value }); }
  catch (e) { if (files.value.length) details.value = String(e); else error.value = String(e); }
  finally { loading.value = false; }
  if (!props.snapshot.operation) emit('close');
  else if (files.value.length) { drafts.clear(); await select(files.value[0]!.path); }
}
function close() { if (dirty.value) discard.value = true; else emit('close'); }
watch(() => props.snapshot.root, () => emit('close'));
onMounted(() => { const first = files.value.find(file => file.path === props.initialPath) || files.value[0]; if (first) void select(first.path); });
</script>

<template>
  <div class="modal-backdrop">
    <section class="modal resolver-modal" role="dialog" aria-modal="true" aria-labelledby="resolver-title">
      <header class="resolver-heading">
        <div class="resolver-heading-icon"><GitMerge :size="22" /></div>
        <div><h2 id="resolver-title">Resolve {{ operation || 'Git' }} conflicts</h2><p>Compare both versions above. Build and save your resolved file below.</p></div>
        <button class="resolver-close" aria-label="Close conflict resolver" :disabled="loading" @click="close"><X :size="18" /></button>
      </header>
      <div class="resolver-progress"><span :class="{ complete: !files.length }"><b>1</b> Resolve files <em>{{ files.length }} remaining</em></span><span class="progress-line" /><span :class="{ ready: !files.length }"><b>2</b> Continue {{ operation || 'working' }}</span></div>
      <div v-if="discard" class="resolver-alert" role="alert">Discard unsaved edits and close? <button @click="discard = false">Keep editing</button><button @click="emit('close')">Discard edits</button></div>
      <div v-if="error" class="resolver-alert" role="alert">{{ error }}</div>
      <div v-if="files.length" class="resolver-layout" :class="{ 'single-file': files.length === 1 }">
        <nav aria-label="Conflicted files" class="resolver-files">
          <div class="files-heading">FILES TO RESOLVE <span>{{ files.length }}</span></div>
          <button v-for="file in files" :key="file.path" :class="{ active: path === file.path }" :aria-current="path === file.path ? 'true' : undefined" :title="file.path" :disabled="loading" @click="select(file.path)"><FileCode2 :size="16" /><span><strong>{{ filename(file.path) }}</strong><small>{{ directory(file.path) || 'Repository root' }}</small><em v-if="drafts.get(file.path)?.result !== undefined && drafts.get(file.path)?.result !== originals.get(drafts.get(file.path)!.fingerprint)">Unsaved changes</em></span><span class="file-dot" /></button>
        </nav>
        <main class="resolver-editor" :aria-busy="loading">
          <div class="file-heading"><h3>{{ filename(path) }}</h3><span :title="path">{{ directory(path) }}</span></div>
          <p v-if="loading" class="loading-message">Loading file…</p>
          <template v-else-if="current">
            <div v-if="current.binary" class="resolver-alert">Binary file. Keep one version, or edit externally and reload before saving.</div>
            <div v-else class="conflict-navigation">
              <span class="conflict-status" :class="{ resolved: !blocks.length }"><AlertTriangle v-if="blocks.length" :size="14" /><Check v-else :size="14" />{{ blocks.length ? `Conflict ${activeIndex + 1} of ${blocks.length}` : 'Ready to save' }}</span>
              <span class="conflict-help">{{ blocks.length ? 'Choose a version for this block, or select individual lines.' : 'Review the result below, then save this file.' }}</span>
              <div class="conflict-nav-buttons"><button aria-label="Previous conflict" :disabled="activeIndex === 0 || !blocks.length" @click="navigate(-1)"><ChevronLeft :size="14" />Previous</button><button aria-label="Next conflict" :disabled="activeIndex >= blocks.length - 1" @click="navigate(1)">Next<ChevronRight :size="14" /></button></div>
            </div>
            <div class="resolver-sides">
              <section v-for="side in (['ours', 'theirs'] as const)" :key="side" class="source-card" :class="side">
                <header><div><span class="side-eyebrow">{{ side === 'ours' ? 'CURRENT' : 'INCOMING' }}</span><h4>{{ side === 'ours' ? oursLabel : theirsLabel }}</h4></div><button v-if="!current.binary" class="accept-block" @click="accept(side)"><Check :size="14" />{{ activeBlock && !activeBlock[side] ? 'Keep empty block' : 'Accept block' }}</button></header>
                <div v-if="activeBlock && !activeBlock[side]" class="empty-block-note">No lines on this side of the conflict · accepting keeps this block empty</div>
                <SyntaxCode v-if="!current.binary" ref="sourceEditors" :text="activeBlock ? previews[side].text : current[side]" :path="path" :label="side === 'ours' ? oursLabel : theirsLabel" :selectable="!!activeBlock && !!activeBlock[side]" :selectable-range="previews[side].range" :active-range="activeBlock ? previews[side].range : undefined" :selected="(side === 'ours' ? selectedOurs : selectedTheirs).map(line => line + previews[side].range.start)" @toggle="toggleLine(side, $event - previews[side].range.start)" />
                <p v-if="!(side === 'ours' ? current.oursExists : current.theirsExists)" class="deleted-message">File deleted in this version</p>
                <button v-if="current.binary" :disabled="!(side === 'ours' ? current.oursExists : current.theirsExists)" @click="resolve(side)">Keep this version & stage</button>
              </section>
            </div>
            <template v-if="!current.binary">
              <div v-if="activeBlock" class="block-actions"><span><ArrowDown :size="14" />Apply to result</span><button @click="accept('both')">Accept both blocks</button><button v-if="selectedOurs.length + selectedTheirs.length" class="primary" @click="accept('lines')">Accept {{ selectedOurs.length + selectedTheirs.length }} selected {{ selectedOurs.length + selectedTheirs.length === 1 ? 'line' : 'lines' }}</button><small v-else>Use + beside a line to select it.</small></div>
              <div class="result-heading"><div><span class="side-eyebrow">RESULT</span><h4>Changes to save</h4></div><span class="result-status" :class="{ resolved: canSave }">{{ canSave ? 'All conflicts resolved' : `${blocks.length || 'Some'} unresolved · highlighted below` }}</span></div>
              <SyntaxCode ref="resultEditor" v-model:text="current.result" :path="path" editable label="Resolved result" :active-range="resultRange" />
              <div class="result-tools"><span>You can edit the result directly.</span><details><summary>More options · whole file / ancestor</summary><div class="advanced-actions"><button :disabled="!current.oursExists" @click="current.result = current.ours">Use entire {{ oursLabel.toLowerCase() }} file</button><button :disabled="!current.theirsExists" @click="current.result = current.theirs">Use entire {{ theirsLabel.toLowerCase() }} file</button><details><summary>View common ancestor</summary><SyntaxCode :text="current.base" :path="path" label="Common ancestor" /></details></div></details></div>
            </template>
            <div v-if="current.binary || !current.oursExists || !current.theirsExists" class="special-actions"><button v-if="!current.oursExists || !current.theirsExists" @click="resolve('delete')">Delete file & stage</button><button v-if="current.binary" @click="drafts.delete(path); select(path)">Reload external edits</button><button v-if="current.binary" @click="resolve('external')">Stage external result</button></div>
          </template>
        </main>
      </div>
      <div v-else class="resolution-complete"><Check :size="32" /><h3>All files resolved</h3><p>Your resolutions are saved and staged. Continue {{ operation || 'working' }} when you’re ready.</p></div>
      <details v-if="details" class="git-output"><summary>Git output</summary><pre>{{ details }}</pre></details>
      <footer class="resolver-footer"><template v-if="abort"><span>Abort {{ operation }} and discard resolutions?</span><button @click="abort = false">Keep resolving</button><button :disabled="loading" @click="run('abort')">Confirm abort</button></template><template v-else><button v-if="operation" class="abort-action" :disabled="loading" @click="abort = true">Abort {{ operation }}</button><span class="footer-hint">{{ files.length ? canSave ? 'This file is ready. Saving also stages your changes.' : 'Resolve this file’s conflicts to save and continue.' : 'All resolutions are staged.' }}</span><button :disabled="loading" @click="close">Close</button><button v-if="files.length && current && !current.binary" class="primary save-resolution" :disabled="loading || !canSave" @click="resolve()"><Check :size="15" />{{ files.length > 1 ? 'Save & next file' : 'Save resolution' }}</button><button v-else-if="operation && !files.length" class="primary" :disabled="loading" @click="run('continue')">Continue {{ operation }}<ChevronRight :size="15" /></button></template></footer>
    </section>
  </div>
</template>

<style scoped>
.resolver-modal { width: 98vw; max-width: 98vw; height: 97vh; max-height: 97vh; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.resolver-heading { display: flex; align-items: center; gap: 14px; padding: 14px 20px 12px; flex-shrink: 0; }
.resolver-heading-icon { display: grid; place-items: center; width: 44px; height: 44px; background: #a6b3ff13; color: #b1beff; border: 1px solid #a6b3ff28; border-radius: 12px; }
h2, h3, h4, p { margin: 0; }
h2 { font-size: 18px; } h3 { font-size: 14px; } h4 { font-size: 13px; }
.resolver-heading p { margin-top: 5px; color: #98a5bb; font-size: 12px; }
.resolver-close { margin-left: auto; padding: 7px; }
.resolver-progress { display: flex; align-items: center; gap: 18px; padding: 0 20px 12px; border-bottom: 1px solid #303746; flex-shrink: 0; }
.resolver-progress > span:not(.progress-line) { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #aab6cd; }
.resolver-progress b { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #35405c; color: #ccd6ff; font-size: 11px; }
.resolver-progress em { font-style: normal; color: #8f9bb1; font-size: 11px; }
.progress-line { width: 42px; height: 1px; background: #394154; }
.resolver-progress .complete b, .resolver-progress .ready b { background: #28553e; color: #a9e8c3; }
.resolver-layout { display: grid; grid-template-columns: 210px minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; }
.resolver-files { border-right: 1px solid #303746; background: #151a2480; padding: 18px 12px; overflow: auto; }
.files-heading { display: flex; justify-content: space-between; padding: 0 8px 14px; color: #8593ab; font-size: 10px; letter-spacing: 1px; font-weight: 600; }
.files-heading span { letter-spacing: 0; }
.resolver-files button { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 12px 9px; text-align: left; white-space: normal; margin-bottom: 6px; border: 1px solid transparent; }
.resolver-files button > svg { flex-shrink: 0; margin-top: 2px; color: #9bacca; }
.resolver-files button > span:first-of-type { min-width: 0; flex: 1; }
.resolver-files strong, .resolver-files small, .resolver-files em { display: block; }
.resolver-files strong { font-size: 12px; overflow-wrap: anywhere; }
.resolver-files small { font-size: 10px; color: #8c9ab2; line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
.resolver-files em { color: #c8b277; font-size: 10px; margin-top: 5px; font-style: normal; }
.resolver-files .active { background: #a5b3ff13; border-color: #a5b3ff38; }
.file-dot { width: 6px; height: 6px; border-radius: 50%; background: #d5ad66; flex-shrink: 0; margin-top: 6px; }
.resolver-editor { min-width: 0; min-height: 0; overflow: auto; padding: 12px 18px; display: flex; flex-direction: column; }
.single-file { grid-template-columns: minmax(0, 1fr); }.single-file .resolver-files { display: none; }
.file-heading { flex-shrink: 0; display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.file-heading > span { color: #7e8ca5; font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file-heading h3 { flex-shrink: 0; }
.conflict-navigation { flex-shrink: 0; display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.conflict-status { display: flex; align-items: center; gap: 6px; color: #e5c27b; background: #d5ad6612; border: 1px solid #d5ad6628; border-radius: 5px; padding: 5px 8px; font-size: 11px; white-space: nowrap; }
.conflict-help { color: #8f9db5; font-size: 11px; }
.conflict-nav-buttons { display: flex; margin-left: auto; gap: 4px; }
.conflict-nav-buttons button { display: flex; align-items: center; gap: 3px; padding: 5px 7px; font-size: 11px; }
.resolver-sides { flex: 1; min-height: 180px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.source-card { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid #354156; border-radius: 8px; overflow: hidden; background: #141b29; }
.source-card.ours { border-top: 2px solid #899fdf; }.source-card.theirs { border-top: 2px solid #79bb9d; }
.source-card header { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; background: #ffffff03; }
.side-eyebrow { display: block; color: #8290a9; font-size: 9px; font-weight: 600; letter-spacing: 1.2px; margin-bottom: 4px; }
.ours :deep(.active-conflict) { background: #8ca4ec24; box-shadow: inset 3px 0 #8ca4ec; }.theirs :deep(.active-conflict) { background: #7bbe9b24; box-shadow: inset 3px 0 #7bbe9b; }
.ours .side-eyebrow { color: #9caee7; }.theirs .side-eyebrow { color: #8bc5a8; }
.accept-block { display: flex; align-items: center; gap: 5px; padding: 6px 9px; font-size: 11px; background: #a6b3ff12; border: 1px solid #a6b3ff33; white-space: nowrap; }
.source-card :deep(.syntax-code) { height: 100%; min-height: 120px; border: 0; border-radius: 0; }
.empty-block-note { position: absolute; left: 0; right: 0; top: 58px; z-index: 1; pointer-events: none; font-size: 10px; color: #96aac4; background: #739ac215; padding: 5px 12px; flex-shrink: 0; }
.empty-block { height: clamp(130px, 21vh, 210px); display: flex; flex-direction: column; align-items: center; justify-content: center; background: #111824; gap: 7px; text-align: center; }
.empty-block > span { font-size: 23px; color: #6c7d98; }.empty-block strong { font-size: 12px; color: #a6b4cd; }.empty-block p { font-size: 11px; color: #7e8da6; }
.block-actions { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 11px 0 15px; flex-wrap: wrap; }
.block-actions > span { display: flex; gap: 5px; align-items: center; color: #7f8da5; font-size: 10px; }.block-actions button { font-size: 11px; border: 1px solid #374158; padding: 5px 9px; }.block-actions small { margin-left: auto; font-size: 10px; color: #8797b2; }
.result-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; margin: 2px 0 10px; }
.result-status { color: #c5ab77; font-size: 10px; }.resolved { color: #8fd1ab; }
.resolver-editor > :deep(.syntax-code.editable) { height: auto; flex: 1; min-height: 180px; border-color: #46516c; }
.result-tools { flex-shrink: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding-top: 9px; font-size: 10px; color: #8797b2; }.result-tools > details { text-align: right; }.advanced-actions { display: flex; flex-direction: column; gap: 7px; padding: 10px 0; text-align: left; }.advanced-actions button { font-size: 11px; }
.resolver-footer { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-top: 1px solid #303746; flex-shrink: 0; background: #1b202b; }
.footer-hint { margin-right: auto; font-size: 11px; color: #8c9bb4; }.abort-action { font-size: 11px; color: #a7a1a8; }.save-resolution { min-width: 148px; justify-content: center; }.resolver-footer button { display: flex; align-items: center; gap: 7px; }
.resolver-alert { padding: 12px 20px; color: #ebbbc1; background: #b34d581a; font-size: 12px; }.special-actions { display: flex; gap: 8px; margin-top: 12px; }.deleted-message { padding: 12px; color: #d5b383; font-size: 11px; }
.git-output { flex-shrink: 0; padding: 8px 24px; font-size: 11px; }.git-output pre { max-height: 100px; overflow: auto; }.loading-message { color: #8b9bb4; }.resolution-complete { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #93d2ae; }.resolution-complete p { color: #95a4bb; font-size: 13px; }
@media(max-width: 1050px) { .conflict-help { display: none; }.resolver-layout { grid-template-columns: 185px minmax(0, 1fr); }.footer-hint { display: none; }.resolver-footer > .abort-action { margin-right: auto; } }
@media(max-width: 750px) { .resolver-layout { grid-template-columns: 1fr; overflow: auto; }.resolver-files { max-height: 130px; border-right: 0; }.resolver-editor { overflow: visible; padding: 14px; }.resolver-sides { grid-template-columns: 1fr; }.resolver-heading p, .resolver-progress em { display: none; }.resolver-footer { padding: 12px; }.file-heading { flex-wrap: wrap; }.block-actions small { width: 100%; margin: 0; } }
</style>
