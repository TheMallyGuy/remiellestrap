<script lang="ts">
  import type { IconName } from './icons'

  /**
   * A single stroked-geometry icon set, drawn inline so the app ships no
   * raster assets and no icon-font dependency. Every glyph lives on a 24x24
   * grid with a 1.5 stroke, which keeps the line weight consistent with the
   * hairline borders used throughout the UI.
   */

  interface Props {
    name: IconName
    /** Pixel size of the square viewport. */
    size?: number
    class?: string
    strokeWidth?: number
  }

  const { name, size = 16, class: className = '', strokeWidth = 1.5 }: Props = $props()
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'home'}
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.75 20v-5.5h4.5V20" />
  {:else if name === 'palette'}
    <path
      d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.9-.7-1.4-.7-2.2 0-.8.6-1.4 1.5-1.4H17a4 4 0 0 0 4-4c0-4.5-4-8.7-9-8.7Z"
    />
    <circle cx="7.75" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9.75" cy="7.75" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
  {:else if name === 'sliders'}
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  {:else if name === 'flag'}
    <path d="M5 21V4" />
    <path d="M5 4.5h11l-2 3.5 2 3.5H5" />
  {:else if name === 'layers'}
    <path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" />
    <path d="m3.5 12 8.5 4.5L20.5 12" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  {:else if name === 'plug'}
    <path d="M9 3v5M15 3v5" />
    <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8Z" />
    <path d="M12 16.5V21" />
  {:else if name === 'download'}
    <path d="M12 3v11" />
    <path d="m7.5 10 4.5 4.5L16.5 10" />
    <path d="M4 17.5V20h16v-2.5" />
  {:else if name === 'info'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.75" r="0.9" fill="currentColor" stroke="none" />
  {:else if name === 'play'}
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  {:else if name === 'refresh'}
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4.5h-4.5" />
  {:else if name === 'shuffle'}
    <path d="M3 7h3.5l3 5M3 17h3.5l3-5" />
    <path d="M14.5 7H21M14.5 17H21" />
    <path d="M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
  {:else if name === 'external'}
    <path d="M14 4h6v6" />
    <path d="m20 4-8.5 8.5" />
    <path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" />
  {:else if name === 'folder'}
    <path d="M3 7.5a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11Z" />
  {:else if name === 'trash'}
    <path d="M4 7h16" />
    <path d="M9.5 7V4.5h5V7" />
    <path d="M6.5 7v12.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V7" />
    <path d="M10.5 11v6M13.5 11v6" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'check'}
    <path d="m5 12.5 4.5 4.5L19 7" />
  {:else if name === 'x'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'minus'}
    <path d="M5 12h14" />
  {:else if name === 'square'}
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  {:else if name === 'copy'}
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.5" />
    <path d="M15.5 5.5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1V15a1 1 0 0 0 1 1" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  {:else if name === 'chevron-down'}
    <path d="m6 9.5 6 6 6-6" />
  {:else if name === 'chevron-right'}
    <path d="m9.5 6 6 6-6 6" />
  {:else if name === 'grip'}
    <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
  {:else if name === 'alert'}
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="16.75" r="0.9" fill="currentColor" stroke="none" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.25l3.25 2" />
  {:else if name === 'discord'}
    <path
      d="M8.5 16.5c-1.6-.4-2.9-1.1-3.6-1.8.4-4 1.6-7 2.6-7.9C8.4 6.3 9.6 6 9.6 6l.6 1.3a12 12 0 0 1 3.6 0L14.4 6s1.2.3 2.1.8c1 .9 2.2 3.9 2.6 7.9-.7.7-2 1.4-3.6 1.8l-.8-1.4"
    />
    <path d="M8.5 16.5c1 .5 2.2.8 3.5.8s2.5-.3 3.5-.8" />
    <circle cx="9.75" cy="12.25" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="14.25" cy="12.25" r="1.15" fill="currentColor" stroke="none" />
  {:else if name === 'github'}
    <path
      d="M9.5 20.5v-2.6c-2.9.6-3.6-1.3-3.6-1.3-.5-1.2-1.2-1.6-1.2-1.6-1-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.1.4-2 1-2.8-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1.1a9.4 9.4 0 0 1 5 0c1.9-1.4 2.8-1.1 2.8-1.1.5 1.4.2 2.4.1 2.7.7.8 1 1.7 1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7 1 .7 2v3.5"
    />
  {:else if name === 'spinner'}
    <path d="M12 3a9 9 0 0 1 9 9" opacity="0.9" />
    <circle cx="12" cy="12" r="9" opacity="0.18" />
  {:else if name === 'prism'}
    <path d="M12 3.5 21 19H3l9-15.5Z" />
    <path d="M12 3.5V19" opacity="0.5" />
  {:else if name === 'code'}
    <path d="m9 8-4 4 4 4" />
    <path d="m15 8 4 4-4 4" />
  {:else if name === 'user'}
    <circle cx="12" cy="8.5" r="3.6" />
    <path d="M4.8 20c.7-3.7 3.7-5.6 7.2-5.6s6.5 1.9 7.2 5.6" />
  {:else if name === 'users'}
    <circle cx="9.5" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c.6-3.2 3.1-5 6-5s5.4 1.8 6 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3" />
    <path d="M17.6 14.9c2 .5 3.4 2.1 3.9 4.6" />
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.4 12h17.2" />
    <path
      d="M12 3.4c2.4 2.6 3.6 5.4 3.6 8.6s-1.2 6-3.6 8.6c-2.4-2.6-3.6-5.4-3.6-8.6S9.6 6 12 3.4Z"
    />
  {:else if name === 'server'}
    <rect x="3.5" y="4.5" width="17" height="6" rx="1.6" />
    <rect x="3.5" y="13.5" width="17" height="6" rx="1.6" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  {:else if name === 'broom'}
    <path d="M14.5 3.5 9 9" />
    <path
      d="M11.2 7.2 6 12.4c-1.4 1.4-2 3.3-1.8 5.3.2 2 .2 2 .2 2s1.4-.4 3-.6c1.9-.2 3.6-1 4.8-2.4l4.6-5.3"
    />
    <path d="M13.5 11.5 17 15" />
  {:else if name === 'terminal'}
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="m7.5 10 2.5 2.5-2.5 2.5" />
    <path d="M13 15h4" />
  {:else if name === 'wrench'}
    <path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6l-8 8a3.2 3.2 0 0 1-4.6-4.6l8-8Z" />
    <path d="M6.5 17.5h.01" />
  {:else if name === 'shield'}
    <path d="M12 3.5 19 6v6c0 4-3 7-7 8.5C8 19 5 16 5 12V6l7-2.5Z" />
    <path d="m9.2 12 2 2 3.6-3.8" />
  {:else if name === 'star'}
    <path d="m12 4 2.5 5.2 5.5.7-4 3.9 1 5.6-5-2.8-5 2.8 1-5.6-4-3.9 5.5-.7L12 4Z" />
  {:else if name === 'heart'}
    <path
      d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7.5 2.8C19.5 15.6 12 20 12 20Z"
    />
  {:else if name === 'key'}
    <circle cx="8.5" cy="8.5" r="4" />
    <path d="m11.5 11.5 8 8" />
    <path d="m16.5 16.5 2-2M14.5 14.5l2-2" />
  {:else if name === 'link'}
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
  {:else if name === 'gauge'}
    <path d="M4.5 17a8.5 8.5 0 1 1 15 0" />
    <path d="m12 12.5 3.5-3.5" />
    <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
  {:else if name === 'save'}
    <path d="M5 4.5h10L19.5 9v10.5H5V4.5Z" />
    <path d="M8.5 4.5v5h7v-5" />
    <path d="M8.5 15.5h7" />
  {:else if name === 'image'}
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.4" />
    <path d="m5.5 17 4.2-4.2 3 3 2.6-2.6L19 16.5" />
  {:else if name === 'type'}
    <path d="M5 6.5V5h14v1.5" />
    <path d="M12 5v14" />
    <path d="M9.5 19h5" />
  {:else if name === 'music'}
    <path d="M9 18V6.5l10-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  {:else if name === 'gamepad'}
    <path
      d="M8 8.5h8a5.5 5.5 0 0 1 5.5 5.5c0 1.9-1.3 3-2.7 3-1 0-1.6-.6-2.3-1.5-.6-.8-1.3-1.5-2.5-1.5h-4c-1.2 0-1.9.7-2.5 1.5-.7.9-1.3 1.5-2.3 1.5-1.4 0-2.7-1.1-2.7-3A5.5 5.5 0 0 1 8 8.5Z"
    />
    <path d="M7.5 12h2M8.5 11v2M15.5 11.5h.01M17 13h.01" />
  {:else if name === 'map-pin'}
    <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Z" />
    <circle cx="12" cy="11" r="2.2" />
  {:else if name === 'cpu'}
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3" />
  {:else if name === 'zap'}
    <path d="M13.5 3 6 13.5h4.5L9.5 21 18 10h-5l.5-7Z" />
  {:else if name === 'eye'}
    <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  {:else if name === 'sort'}
    <path d="M7 4v16" />
    <path d="m4.5 17.5 2.5 2.5 2.5-2.5" />
    <path d="M17 20V4" />
    <path d="m14.5 6.5 2.5-2.5 2.5 2.5" />
  {:else if name === 'edit'}
    <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5v3Z" />
    <path d="m14.5 7.5 2 2" />
  {:else if name === 'arrow-left'}
    <path d="M20 12H4" />
    <path d="m9.5 6.5-5.5 5.5 5.5 5.5" />
  {/if}
</svg>
