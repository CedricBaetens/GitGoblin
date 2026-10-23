export function historyRefs(refs: string): string {
  return refs.split(", ")
    .map(ref => ref.replace(/^HEAD -> /, ""))
    .filter(ref => !/^(?:refs\/remotes\/)?[^/]+\/HEAD$/.test(ref))
    .join(", ");
}
