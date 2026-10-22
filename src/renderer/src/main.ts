import { mount } from 'svelte'

import './assets/main.css'

import App from './App.svelte'
import BootstrapperWindow from './BootstrapperWindow.svelte'
import OverlayWindow from './OverlayWindow.svelte'

const target = document.getElementById('app')!
const view = new URLSearchParams(window.location.search).get('view')

/**
 * One bundle, three surfaces: the launcher, the compact install/launch window
 * and the in-game overlay. The window decides which it is by its own URL, so
 * there is no second build and no second copy of the theme to drift.
 */
if (view === 'overlay') {
  // The overlay is transparent down to the desktop: the card it draws is the
  // only thing that may have a background.
  document.documentElement.classList.add('overlay-view')
}

const app =
  view === 'bootstrapper'
    ? mount(BootstrapperWindow, { target })
    : view === 'overlay'
      ? mount(OverlayWindow, { target })
      : mount(App, { target })

export default app
