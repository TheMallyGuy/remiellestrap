<script lang="ts">
  import type { NavItem, PageId } from '../types'
  import { goTo, navigation } from '../stores/navigation.svelte'
  import { activity } from '../stores/activity.svelte'
  import { bootstrapper } from '../stores/bootstrapper.svelte'
  import ArtSlot from './ArtSlot.svelte'
  import Icon from './Icon.svelte'

  /**
   * Primary navigation.
   *
   * Kept to a single narrow column of plain labels — no nested trees, no
   * badges competing for attention. A slim Remielle portrait sits at the foot
   * of the rail as the app's only persistent piece of art.
   */

  const ITEMS: NavItem[] = [
    { id: 'home', label: 'Home', hint: 'Launch Roblox and see what you last played', icon: 'home' },
    {
      id: 'appearance',
      label: 'Appearance',
      hint: 'Theme, accent and the Remielle artwork',
      icon: 'palette'
    },
    {
      id: 'behaviour',
      label: 'Behaviour',
      hint: 'How the bootstrapper acts around a launch',
      icon: 'sliders'
    },
    { id: 'fastflags', label: 'FastFlags', hint: 'Client engine flag profiles', icon: 'flag' },
    { id: 'mods', label: 'Mods', hint: 'File overrides applied to the client', icon: 'layers' },
    {
      id: 'integrations',
      label: 'Integrations',
      hint: 'Discord presence and activity tracking',
      icon: 'plug'
    },
    {
      id: 'installation',
      label: 'Installation',
      hint: 'Channel, install location and repair',
      icon: 'download'
    },
    { id: 'about', label: 'About', hint: 'Version, credits and licences', icon: 'info' }
  ]

  function select(page: PageId): void {
    goTo(page)
  }
</script>

<nav
  class="flex w-[188px] shrink-0 flex-col border-r border-ivory-200/6 bg-ink-950/40"
  aria-label="Primary"
>
  <ul class="flex-1 space-y-0.5 overflow-y-auto p-2.5">
    {#each ITEMS as item (item.id)}
      {@const active = navigation.page === item.id}
      <li>
        <button
          type="button"
          class="group relative flex w-full items-center gap-2.5 rounded-control px-2.5 py-[7px] text-left text-[0.8125rem] transition-colors duration-150
            {active
            ? 'bg-ivory-100/7 text-ivory-50'
            : 'text-ivory-400 hover:bg-ivory-100/4 hover:text-ivory-200'}"
          onclick={() => select(item.id)}
          title={item.hint}
          aria-current={active ? 'page' : undefined}
        >
          <!-- The active marker: a single gold tick, not a filled pill. -->
          <span
            class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-gold-400 transition-opacity duration-200 {active
              ? 'opacity-100'
              : 'opacity-0'}"
            aria-hidden="true"
          ></span>

          <span class={active ? 'text-gold-300/90' : 'text-ivory-500 group-hover:text-ivory-400'}>
            <Icon name={item.icon} size={15} />
          </span>

          <span class="flex-1 truncate font-medium">{item.label}</span>

          {#if item.id === 'home' && activity.value.inGame}
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full bg-positive shadow-[0_0_6px] shadow-positive/60"
              title="In an experience"
            ></span>
          {:else if item.id === 'installation' && bootstrapper.updateCheck && !bootstrapper.updateCheck.upToDate && bootstrapper.updateCheck.installed}
            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" title="Update available"
            ></span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>

  <div class="p-2.5 pt-0">
    <ArtSlot
      slot="sidebar"
      class="aspect-[3/4] w-full"
      focus="30%"
      scrim="strong"
      shuffle={true}
      attribution={true}
      rounded="rounded-card"
    />
  </div>
</nav>
