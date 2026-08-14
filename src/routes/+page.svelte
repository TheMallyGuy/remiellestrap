<script lang="ts">
  import type { Component } from "svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import Home from "$lib/pages/Home.svelte";
  import Appearance from "$lib/pages/Appearance.svelte";
  import Behaviour from "$lib/pages/Behaviour.svelte";
  import FastFlags from "$lib/pages/FastFlags.svelte";
  import Mods from "$lib/pages/Mods.svelte";
  import Integrations from "$lib/pages/Integrations.svelte";
  import Installation from "$lib/pages/Installation.svelte";
  import About from "$lib/pages/About.svelte";
  import { NAV_ITEMS, type PageId } from "$lib/nav";

  const views: Record<PageId, Component> = {
    home: Home,
    appearance: Appearance,
    behaviour: Behaviour,
    fastflags: FastFlags,
    mods: Mods,
    integrations: Integrations,
    installation: Installation,
    about: About,
  };

  let page = $state<PageId>("home");

  const pageLabel = $derived(NAV_ITEMS.find((n) => n.id === page)?.label ?? "Home");
</script>

<div class="flex h-screen flex-col overflow-hidden">
  <TitleBar title="RemielleStrap" subtitle={pageLabel} />

  <div class="flex min-h-0 flex-1">
    <Sidebar current={page} onNavigate={(p) => (page = p)} />

    <main class="min-w-0 flex-1 overflow-y-auto p-8">
      <div class="mx-auto max-w-[880px]">
        {#key page}
          {@const View = views[page]}
          <div class="fade-up">
            <View />
          </div>
        {/key}
      </div>
    </main>
  </div>
</div>
