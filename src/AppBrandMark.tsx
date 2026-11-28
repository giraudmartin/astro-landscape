import {
  APP_BRAND,
  APP_COPYRIGHT,
  APP_PRODUCT,
  APP_VERSION,
} from './appMeta'
import { useT } from './i18n'

/** Product signature — Sphere + version / by Sadr3D / © (stacked lockup) */
export function AppBrandMark() {
  const t = useT()
  return (
    <p
      className="app-brand-mark"
      aria-label={t('common.brandMarkAria', {
        product: APP_PRODUCT,
        brand: APP_BRAND,
        version: APP_VERSION,
      })}
    >
      <span className="app-brand-mark__lockup">
        <span className="app-brand-mark__product">{APP_PRODUCT}</span>
        <span className="app-brand-mark__version">v{APP_VERSION}</span>
      </span>
      <span className="app-brand-mark__by">
        {t('common.brandBy', { brand: APP_BRAND })}
      </span>
      <span className="app-brand-mark__meta">{APP_COPYRIGHT}</span>
    </p>
  )
}
