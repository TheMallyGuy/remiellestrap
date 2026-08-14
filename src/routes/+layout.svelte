<script lang="ts">
  import "../app.css";

  // Bundled fonts (offline, served from the app's own assets).
  import "@fontsource/cormorant-garamond/500.css";
  import "@fontsource/cormorant-garamond/600.css";
  import "@fontsource/cormorant-garamond/700.css";
  import "@fontsource/inter/400.css";
  import "@fontsource/inter/500.css";
  import "@fontsource/inter/600.css";
  import "@fontsource/inter/700.css";
  import "@fontsource/jetbrains-mono/400.css";
  import "@fontsource/jetbrains-mono/500.css";

  import { onMount } from "svelte";
  import Toast from "$lib/components/Toast.svelte";
  import CurtainCall from "$lib/components/CurtainCall.svelte";
  import { api, onBootstrapProgress, onBootstrapStatus, onActivity, onDeeplink } from "$lib/ipc";
  import { loadSettings } from "$lib/stores/settings.svelte";
  import { loadAppState } from "$lib/stores/app-state.svelte";
  import { setProgress, setStatus, startBootstrap } from "$lib/stores/bootstrap.svelte";
  import { setActivity } from "$lib/stores/activity.svelte";
  import { toast } from "$lib/stores/toasts.svelte";

  let { children } = $props();

  onMount(async () => {
    // Load persisted state before the first paint of data-driven pages.
    await Promise.all([loadSettings(), loadAppState()]);

    void onBootstrapProgress(setProgress);
    void onBootstrapStatus((s) => {
      setStatus(s);
      if (s.state === "error") toast.err("Bootstrap failed", s.message);
      if (s.state === "done") toast.ok("Curtain call", "Roblox is ready.");
    });
    void onActivity(setActivity);
    void onDeeplink((urls) => {
      if (urls.length > 0) void startBootstrap(urls[0], false);
    });

    // Cold-start deep link (app launched via roblox:// while closed).
    api
      .deeplink_pending()
      .then((urls) => {
        if (urls && urls.length > 0) void startBootstrap(urls[0], false);
      })
      .catch(() => {});
  });
</script>

{@render children()}

<Toast />
<CurtainCall />
