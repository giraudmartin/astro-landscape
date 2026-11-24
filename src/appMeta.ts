/** Product identity for chrome. Version is injected from package.json at build. */
export const APP_BRAND = 'Sadr3D'
export const APP_PRODUCT = 'Sphere'
/** Full display name: brand + product (titles, About meta). */
export const APP_NAME = `${APP_BRAND} ${APP_PRODUCT}`
export const APP_VERSION: string = __APP_VERSION__
export const APP_COPYRIGHT_YEAR = new Date().getFullYear()
export const APP_COPYRIGHT = `© ${APP_COPYRIGHT_YEAR} Martin GIRAUD`
