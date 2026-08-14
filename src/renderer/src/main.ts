import { mount } from 'svelte'

import './assets/main.css'

import App from './App.svelte'
import BootstrapperWindow from './BootstrapperWindow.svelte'

const target = document.getElementById('app')!
const isBootstrapperWindow =
  new URLSearchParams(window.location.search).get('view') === 'bootstrapper'

const app = isBootstrapperWindow ? mount(BootstrapperWindow, { target }) : mount(App, { target })

export default app
