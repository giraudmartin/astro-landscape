/** Product identity for chrome. Version is injected from package.json at build. */
export const APP_NAME = 'Astro Landscape'
export const APP_VERSION: string = __APP_VERSION__
export const APP_COPYRIGHT_YEAR = new Date().getFullYear()
export const APP_COPYRIGHT = `© ${APP_COPYRIGHT_YEAR} Martin GIRAUD`
