import { useEffect, useState } from 'react'
import { getFramingThumb } from './framingThumbStore'
import type { FramingViewSnapshot } from './personalFramings'
import {
  FrameModePanoIcon,
  FrameModePhotoIcon,
  TimelapseIcon,
} from './psIcons'

type FramingThumbProps = {
  thumbId: string | null
  view: FramingViewSnapshot
  className?: string
}

export function FramingThumb({ thumbId, view, className }: FramingThumbProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false
    if (!thumbId) {
      setUrl(null)
      return
    }
    void getFramingThumb(thumbId).then((blob) => {
      if (cancelled) return
      if (!blob) {
        setUrl(null)
        return
      }
      const next = URL.createObjectURL(blob)
      revoked = next
      setUrl(next)
    })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [thumbId])

  if (url) {
    return (
      <span
        className={['framings-thumb', className].filter(Boolean).join(' ')}
        aria-hidden="true"
      >
        <img src={url} alt="" className="framings-thumb__img" />
      </span>
    )
  }

  return (
    <span
      className={['framings-thumb', 'framings-thumb--placeholder', className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {view.frameMode === 'pano' ? (
        <FrameModePanoIcon size={16} />
      ) : view.frameMode === 'timelapse' ? (
        <TimelapseIcon size={16} />
      ) : (
        <FrameModePhotoIcon size={16} />
      )}
    </span>
  )
}
