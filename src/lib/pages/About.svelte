<script lang="ts">
  import { onMount } from "svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import { api, openInBrowser } from "$lib/ipc";
  import type { AppInfo } from "$lib/types";

  let info = $state<AppInfo | null>(null);
  onMount(async () => {
    try {
      info = await api.app_get_info();
    } catch {
      /* ignore */
    }
  });
</script>

<div class="flex flex-col gap-6">
  <PageHeader title="About" description="Credits, license and provenance." />

  <Card title="RemielleStrap">
    <div class="py-3">
      <div class="flex items-baseline gap-3">
        <span class="font-display text-2xl text-wing-50">RemielleStrap</span>
        <span class="font-mono text-sm text-wing-400">v{info?.version ?? "—"}</span>
      </div>
      <p class="mt-2 max-w-[560px] text-sm text-wing-200">
        A Roblox bootstrapper in the shape of a launcher: it replaces Roblox's official
        installer with a faster, modular, fully local deployment pipeline.
      </p>
      <p class="mt-3 text-sm text-wing-400">
        Themed after <span class="text-wing-200">Remielle Dan</span> — Zenless Zone Zero.
      </p>
      <button
        class="focus-flare mt-2 inline-block text-sm text-flare-400 hover:text-flare-300"
        onclick={() => void openInBrowser("https://wiki.hoyolab.com/pc/zzz/entry/1112")}
      >
        Character reference → wiki.hoyolab.com
      </button>
    </div>
  </Card>

  <Card title="Artwork">
    <div class="py-3 text-sm text-wing-200">
      All character artwork is fetched live from{" "}
      <button
        class="focus-flare text-flare-400 hover:text-flare-300"
        onclick={() => void openInBrowser("https://safebooru.org")}
      >
        safebooru.org
      </button>{" "}
      at runtime. All rights belong to the original artists. RemielleStrap never
      generates, embeds or redistributes artwork.
    </div>
  </Card>

  <Card title="License">
    <div class="py-3 text-sm text-wing-200">
      <p>MIT License</p>
      <p class="mt-2 text-wing-400">
        Copyright © RemielleStrap contributors. Permission is hereby granted, free of
        charge, to any person obtaining a copy of this software and associated
        documentation files, to deal in the software without restriction, including
        without limitation the rights to use, copy, modify, merge, publish, distribute,
        sublicense, and/or sell copies of the software, subject to the conditions of the
        MIT license.
      </p>
    </div>
  </Card>
</div>
