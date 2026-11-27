/** Product identity for chrome. Version is injected from package.json at build. */
export const APP_BRAND = 'Sadr3D'
export const APP_PRODUCT = 'Sphere'
/** Full display name: brand + product (titles, About meta). */
export const APP_NAME = `${APP_BRAND} ${APP_PRODUCT}`
export const APP_VERSION: string = __APP_VERSION__
export const APP_COPYRIGHT_YEAR = new Date().getFullYear()
export const APP_COPYRIGHT = `© ${APP_COPYRIGHT_YEAR} Martin GIRAUD`

/** Public domain inboxes (OVH redirects → personal mailbox). */
export const APP_CONTACT_EMAIL = 'contact@sadr3d.com'
/** Human inbox (docs / privacy). FormSubmit uses the opaque hash below. */
export const APP_BUG_REPORT_EMAIL = 'bugs@sadr3d.com'
/**
 * FormSubmit endpoint id (replaces the naked email in the client).
 * Issued on first activation for bugs@sadr3d.com.
 */
export const APP_BUG_REPORT_FORMSUBMIT_ID = 'bd277273e7d841eeadd4173be52b42a8'
