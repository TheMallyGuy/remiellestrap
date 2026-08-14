<script lang="ts">
  import { Dices, Trash2, RefreshCw } from "lucide-svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import SettingRow from "$lib/components/SettingRow.svelte";
  import Select from "$lib/components/Select.svelte";
  import TextField from "$lib/components/TextField.svelte";
  import { api } from "$lib/ipc";
  import { settings, saveSettings } from "$lib/stores/settings.svelte";
  import { refreshArt } from "$lib/stores/art.svelte";
  import { toast } from "$lib/stores/toasts.svelte";
  import { ACCENTS, BOOTSTRAP_STYLES, ART_SLOTS, ART_SLOT_LABELS, DEFAULT_SLOT_TAGS } from "$lib/const";

  async function setAccent(id: string) {
    settings.appearance.accent = id as typeof settings.appearance.accent;
    await saveSettings();
  }

  async function setStyle(id: string) {
    settings.appearance.bootstrap_style = id as typeof settings.appearance.bootstrap_style;
    await saveSettings();
  }

  async function setTag(slot: string, value: string) {
    settings.appearance.booru_tags[slot] = value;
    await saveSettings();
  }

  async function shuffleSlot(slot: string) {
    try {
      await api.booru_get_art_for_slot(slot, true);
      refreshArt();
      toast.ok("Shuffled", `${ART_SLOT_LABELS[slot as keyof typeof ART_SLOT_LABELS]} art re-rolled.`);
    } catch (e) {
      toast.err("Shuffle failed", String(e));
    }
  }

  async function clearCache() {
    try {
      await api.booru_clear_cache();
      refreshArt();
      toast.ok("Cache cleared", "Artwork will be re-fetched on demand.");
    } catch (e) {
      toast.err("Clear failed", String(e));
    }
  }
</script>

<div class="flex flex-col gap-6">
  <PageHeader
    title="Appearance"
    description="Theme accents, bootstrapper style and artwork sources."
  />

  <Card title="Theme accent" description="The single disciplined accent of the Cathedral of Light.">
    <div class="grid grid-cols-3 gap-3 py-3">
      {#each ACCENTS as a (a.id)}
        <button
          class="card-hover focus-flare flex flex-col gap-2 rounded-md p-3 text-left hairline transition-colors hover:bg-void-700 {settings.appearance.accent === a.id
            ? 'bg-void-700'
            : 'bg-void-800'}"
          onclick={() => setAccent(a.id)}
        >
          <span
            class="h-1.5 w-8 rounded-full"
            style="background: {a.id === 'voidflare' ? 'var(--color-flare-500)' : a.id === 'lumen' ? 'var(--color-wing-50)' : 'var(--gradient-prism)'};"
            aria-hidden="true"
          ></span>
          <span class="text-sm text-wing-50">{a.name}</span>
          <span class="text-xs text-wing-400 leading-snug">{a.desc}</span>
        </button>
      {/each}
    </div>
  </Card>

  <Card title="Bootstrapper style" description="How the Curtain Call overlay presents itself.">
    <div class="py-3">
      <Select
        value={settings.appearance.bootstrap_style}
        options={BOOTSTRAP_STYLES.map((s) => ({ value: s.id, label: `${s.name} — ${s.desc}` }))}
        onChange={(v) => setStyle(v)}
      />
    </div>
  </Card>

  <Card
    title="Artwork"
    description="Remielle Dan artwork is fetched live from Safebooru at runtime. Customize the search tags per slot."
  >
    <div class="divide-y divide-white/[0.06]">
      {#each ART_SLOTS as slot (slot)}
        <SettingRow
          label={ART_SLOT_LABELS[slot]}
          description={`Default: “${DEFAULT_SLOT_TAGS[slot]}”`}
        >
          <div class="flex items-center gap-2">
            <TextField
              value={settings.appearance.booru_tags[slot] ?? ""}
              placeholder={DEFAULT_SLOT_TAGS[slot]}
              onChange={(v) => setTag(slot, v)}
            />
            <button
              class="btn-secondary focus-flare h-10 w-10 rounded-md"
              aria-label={`Shuffle ${ART_SLOT_LABELS[slot]}`}
              title="Shuffle"
              onclick={() => shuffleSlot(slot)}
            >
              <Dices size={16} class="mx-auto" />
            </button>
          </div>
        </SettingRow>
      {/each}
    </div>

    <div class="flex items-center justify-between gap-4 border-t border-white/[0.06] py-3">
      <div class="text-sm text-wing-400">
        Cached artwork is kept under 200 MB. Clear it to re-fetch everything.
      </div>
      <button class="btn-destructive focus-flare flex items-center gap-2 rounded-md px-3 py-2 text-sm" onclick={clearCache}>
        <Trash2 size={14} />
        Clear art cache
      </button>
    </div>
  </Card>
</div>
