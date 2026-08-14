import type { RemielleApi } from './index'

declare global {
  interface Window {
    remielle: RemielleApi
  }
}

export {}
