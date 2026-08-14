import type { ActivityInfo } from "$lib/types";

const idle = (): ActivityInfo => ({
  status: "idle",
  job_id: "",
  place_id: 0,
  game_name: "",
  joined_at: 0,
});

export const activity = $state<ActivityInfo>(idle());

export function setActivity(next: ActivityInfo) {
  Object.assign(activity, next);
}
