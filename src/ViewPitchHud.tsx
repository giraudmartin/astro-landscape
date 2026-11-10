type ViewPitchHudProps = {
  /** Look pitch: 0 = horizon, + = up, − = down (deg). */
  pitchDeg: number
}

const PX_PER_DEG = 2.6
const TICK_STEP_DEG = 5
/** Visible ladder span around the caret (±). */
const HALF_SPAN_DEG = 45
const PITCH_MIN = -90
const PITCH_MAX = 90

function clampPitch(deg: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, deg))
}

function tickClassName(deg: number): string {
  if (deg === 0) return 'moon-preview-pitch-tape__mark is-horizon'
  if (deg % 30 === 0) return 'moon-preview-pitch-tape__mark is-major'
  if (deg % 15 === 0) return 'moon-preview-pitch-tape__mark is-medium'
  return 'moon-preview-pitch-tape__mark is-minor'
}

function formatPitchLabel(pitchDeg: number): string {
  const p = Math.round(clampPitch(pitchDeg))
  if (p === 0) return '0° · horizon'
  if (p > 0) return `+${p}°`
  return `${p}°`
}

/**
 * Vertical pitch ladder (aircraft-style), companion to the heading tape.
 * Track is anchored at mid-window (`top: 50%`); scroll uses px only — absolute
 * marks must not rely on `%` of the track (height collapses to 0).
 */
export function ViewPitchHud({ pitchDeg }: ViewPitchHudProps) {
  const pitch = clampPitch(pitchDeg)
  const windowH = HALF_SPAN_DEG * 2 * PX_PER_DEG

  const marks: number[] = []
  for (let deg = PITCH_MIN; deg <= PITCH_MAX; deg += TICK_STEP_DEG) {
    marks.push(deg)
  }

  return (
    <div
      className="moon-preview-pitch-tape"
      aria-label={`Site ${formatPitchLabel(pitch)}`}
    >
      <div
        className="moon-preview-pitch-tape__window"
        style={{ height: windowH }}
      >
        <div
          className="moon-preview-pitch-tape__track"
          style={{
            top: '50%',
            transform: `translateY(${pitch * PX_PER_DEG}px)`,
          }}
        >
          {marks.map((deg) => {
            const labeled = deg % 15 === 0
            return (
              <span
                key={deg}
                className={tickClassName(deg)}
                style={{ top: -deg * PX_PER_DEG }}
              >
                <i />
                {labeled ? (
                  <em>{deg === 0 ? '0' : deg > 0 ? `+${deg}` : String(deg)}</em>
                ) : null}
              </span>
            )
          })}
        </div>
        <div className="moon-preview-pitch-tape__caret" aria-hidden="true" />
      </div>
      <span className="moon-preview-pitch-tape__readout">
        {formatPitchLabel(pitch)}
      </span>
    </div>
  )
}
