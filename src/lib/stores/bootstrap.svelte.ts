import { api } from "$lib/ipc";
import type { BootstrapProgress, BootstrapStatus } from "$lib/types";

const _status = $state<BootstrapStatus>({ state: "idle", message: "" });
const _progress = $state<BootstrapProgress>({
  stage: "",
  package: null,
  pkg_progress: 0,
  total_progress: 0,
  bytes_per_sec: 0,
  detail: null,
});
let _visible = $state(false);

export function getStatus(): BootstrapStatus {
  return _status;
}
export function getProgress(): BootstrapProgress {
  return _progress;
}
export function isVisible(): boolean {
  return _visible;
}

export function setProgress(p: BootstrapProgress) {
  Object.assign(_progress, p);
}

export function setStatus(s: BootstrapStatus) {
  Object.assign(_status, s);
  _visible = s.state === "working";
}

export async function startBootstrap(uri: string | null, force: boolean) {
  await api.bootstrap_start(uri, force);
}

export async function cancelBootstrap() {
  await api.bootstrap_cancel();
}
