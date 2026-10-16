import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GitRequest } from "./types";
export const desktop = () => isTauri();
export async function git<T>(request: GitRequest): Promise<T> {
  if (!desktop())
    throw new Error(
      "Open the desktop app to work with local repositories. The browser workspace is an example only.",
    );
  return invoke<T>("git_request", { request });
}
export { invoke };
