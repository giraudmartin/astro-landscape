import { useCallback, useEffect, useRef, useState } from 'react'
import {
  horizontalToJ2000,
  j2000ToHorizontal,
  objectHorizontalAt,
  type CelestialObject,
} from './celestialObjects'
import { parallacticAngleRad } from './moonGlobe'
import {
  timelapseFieldRollDeg,
  timelapsePreviewFrameDelayMs,
  timelapseShotCount,
  timelapseShotUtcMs,
  type TimelapseEqRotation,
  type TimelapsePlan,
  type TimelapseSupport,
} from './timelapse'

export type TimelapseLook = { yaw: number; pitch: number }

export type TimelapsePreviewPhase = 'idle' | 'playing' | 'paused' | 'ended'

export type TimelapsePreviewStatus = {
  phase: TimelapsePreviewPhase
  /** True while the timeline should stay hidden (playing / paused / ended). */
  active: boolean
  shotIndex: number
  shotCount: number
  support: TimelapseSupport
  eqRotation: TimelapseEqRotation
}

type PreviewSession = {
  plan: TimelapsePlan
  startUtcMs: number
  startLook: TimelapseLook
  shotCount: number
  intervalS: number
  support: TimelapseSupport
  eqRotation: TimelapseEqRotation
  playbackFps: number
  lockRaHours: number | null
  lockDecDeg: number | null
  trackObject: CelestialObject | null
  q0Rad: number
}

type UseTimelapsePreviewArgs = {
  lat: number
  lon: number
  elevationM: number
  selectedCelestial: CelestialObject | null
  getLook: () => TimelapseLook
  getSkyUtcMs: () => number
  onSkyUtcChange: (utcMs: number) => void
  onLookChange: (yaw: number, pitch: number, rollDeg?: number) => void
  onFrameRollChange: (rollDeg: number) => void
}

const IDLE: TimelapsePreviewStatus = {
  phase: 'idle',
  active: false,
  shotIndex: 0,
  shotCount: 0,
  support: 'fixed',
  eqRotation: 'scene',
}

/**
 * Owns timelapse preview playback so the settings panel can close
 * while the sequence keeps running (HUD elsewhere).
 */
export function useTimelapsePreview({
  lat,
  lon,
  elevationM,
  selectedCelestial,
  getLook,
  getSkyUtcMs,
  onSkyUtcChange,
  onLookChange,
  onFrameRollChange,
}: UseTimelapsePreviewArgs) {
  const [status, setStatus] = useState<TimelapsePreviewStatus>(IDLE)
  const sessionRef = useRef<PreviewSession | null>(null)
  const timerRef = useRef<number | null>(null)
  const shotIndexRef = useRef(0)
  const phaseRef = useRef<TimelapsePreviewPhase>('idle')
  phaseRef.current = status.phase

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const resolveTarget = useCallback(
    (
      session: PreviewSession,
      utcMs: number,
    ): { yaw: number; pitch: number } | null => {
      if (session.support !== 'equatorial') return null
      if (session.trackObject) {
        const pos = objectHorizontalAt(
          session.trackObject,
          lat,
          lon,
          elevationM,
          utcMs,
        )
        return pos
          ? { yaw: pos.azimuthDeg, pitch: pos.altitudeDeg }
          : null
      }
      if (session.lockRaHours == null || session.lockDecDeg == null) return null
      const pos = j2000ToHorizontal(
        session.lockRaHours,
        session.lockDecDeg,
        lat,
        lon,
        elevationM,
        utcMs,
      )
      return { yaw: pos.azimuthDeg, pitch: pos.altitudeDeg }
    },
    [elevationM, lat, lon],
  )

  const applyShot = useCallback(
    (session: PreviewSession, index: number) => {
      const utc = timelapseShotUtcMs(
        session.startUtcMs,
        session.intervalS,
        index,
      )
      onSkyUtcChange(utc)

      if (session.support !== 'equatorial') {
        onLookChange(session.startLook.yaw, session.startLook.pitch, 0)
        onFrameRollChange(0)
        return
      }

      const target = resolveTarget(session, utc)
      if (!target) return

      const q = parallacticAngleRad(target.yaw, target.pitch, lat)
      const rollDeg = timelapseFieldRollDeg(session.q0Rad, q)

      if (session.eqRotation === 'frame') {
        onLookChange(target.yaw, target.pitch, 0)
        onFrameRollChange(rollDeg)
      } else {
        onLookChange(target.yaw, target.pitch, rollDeg)
        onFrameRollChange(0)
      }
    },
    [
      lat,
      onFrameRollChange,
      onLookChange,
      onSkyUtcChange,
      resolveTarget,
    ],
  )

  const finishToEnded = useCallback(() => {
    clearTimer()
    const session = sessionRef.current
    if (!session) return
    const last = Math.max(0, session.shotCount - 1)
    shotIndexRef.current = last
    setStatus({
      phase: 'ended',
      active: true,
      shotIndex: last,
      shotCount: session.shotCount,
      support: session.support,
      eqRotation: session.eqRotation,
    })
  }, [])

  const scheduleFrom = useCallback(
    (index: number) => {
      const session = sessionRef.current
      if (!session) return
      clearTimer()
      const delayMs = timelapsePreviewFrameDelayMs(
        session.shotCount,
        session.playbackFps,
      )

      const tick = (current: number) => {
        if (!sessionRef.current || phaseRef.current !== 'playing') return
        const next = current + 1
        if (next >= session.shotCount) {
          timerRef.current = window.setTimeout(() => {
            finishToEnded()
          }, Math.max(280, delayMs))
          return
        }
        shotIndexRef.current = next
        setStatus((prev) =>
          prev.phase === 'playing' ? { ...prev, shotIndex: next } : prev,
        )
        applyShot(session, next)
        timerRef.current = window.setTimeout(() => tick(next), delayMs)
      }

      timerRef.current = window.setTimeout(() => tick(index), delayMs)
    },
    [applyShot, finishToEnded],
  )

  const buildSession = useCallback(
    (plan: TimelapsePlan): PreviewSession => {
      const startLook = getLook()
      const startUtcMs = getSkyUtcMs()
      const shotCount = timelapseShotCount(plan.durationMin, plan.intervalS)

      let lockRaHours: number | null = null
      let lockDecDeg: number | null = null
      let trackObject: CelestialObject | null = null
      let q0Rad = 0

      if (plan.support === 'equatorial') {
        if (
          selectedCelestial &&
          (selectedCelestial.raHours != null ||
            selectedCelestial.catalogIds.body)
        ) {
          trackObject = selectedCelestial
          const pos = objectHorizontalAt(
            trackObject,
            lat,
            lon,
            elevationM,
            startUtcMs,
          )
          if (pos) {
            q0Rad = parallacticAngleRad(pos.azimuthDeg, pos.altitudeDeg, lat)
          } else {
            q0Rad = parallacticAngleRad(startLook.yaw, startLook.pitch, lat)
          }
        } else {
          const eq = horizontalToJ2000(
            startLook.pitch,
            startLook.yaw,
            lat,
            lon,
            elevationM,
            startUtcMs,
          )
          lockRaHours = eq.raHours
          lockDecDeg = eq.decDeg
          q0Rad = parallacticAngleRad(startLook.yaw, startLook.pitch, lat)
        }
      }

      return {
        plan: { ...plan },
        startUtcMs,
        startLook,
        shotCount,
        intervalS: plan.intervalS,
        support: plan.support,
        eqRotation: plan.eqRotation,
        playbackFps: plan.playbackFps,
        lockRaHours,
        lockDecDeg,
        trackObject,
        q0Rad,
      }
    },
    [elevationM, getLook, getSkyUtcMs, lat, lon, selectedCelestial],
  )

  /** Leave playback mode — restore sky / look and show the timeline again. */
  const exit = useCallback(() => {
    clearTimer()
    const session = sessionRef.current
    sessionRef.current = null
    shotIndexRef.current = 0
    setStatus(IDLE)
    onFrameRollChange(0)
    if (session) {
      onSkyUtcChange(session.startUtcMs)
      onLookChange(session.startLook.yaw, session.startLook.pitch, 0)
    }
  }, [onFrameRollChange, onLookChange, onSkyUtcChange])

  const pause = useCallback(() => {
    if (phaseRef.current !== 'playing') return
    clearTimer()
    const session = sessionRef.current
    if (!session) return
    setStatus({
      phase: 'paused',
      active: true,
      shotIndex: shotIndexRef.current,
      shotCount: session.shotCount,
      support: session.support,
      eqRotation: session.eqRotation,
    })
  }, [])

  const resume = useCallback(() => {
    const session = sessionRef.current
    if (!session || phaseRef.current !== 'paused') return
    setStatus({
      phase: 'playing',
      active: true,
      shotIndex: shotIndexRef.current,
      shotCount: session.shotCount,
      support: session.support,
      eqRotation: session.eqRotation,
    })
    scheduleFrom(shotIndexRef.current)
  }, [scheduleFrom])

  /** Classic stop: freeze on the first frame (stay in playback mode). */
  const stop = useCallback(() => {
    const session = sessionRef.current
    if (!session || phaseRef.current === 'idle') return
    clearTimer()
    shotIndexRef.current = 0
    applyShot(session, 0)
    setStatus({
      phase: 'paused',
      active: true,
      shotIndex: 0,
      shotCount: session.shotCount,
      support: session.support,
      eqRotation: session.eqRotation,
    })
  }, [applyShot])

  const startPlayback = useCallback(
    (session: PreviewSession, fromIndex = 0) => {
      sessionRef.current = session
      shotIndexRef.current = fromIndex
      setStatus({
        phase: 'playing',
        active: true,
        shotIndex: fromIndex,
        shotCount: session.shotCount,
        support: session.support,
        eqRotation: session.eqRotation,
      })
      applyShot(session, fromIndex)
      scheduleFrom(fromIndex)
    },
    [applyShot, scheduleFrom],
  )

  const start = useCallback(
    (plan: TimelapsePlan) => {
      clearTimer()
      const session = buildSession(plan)
      startPlayback(session, 0)
    },
    [buildSession, startPlayback],
  )

  const replay = useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    clearTimer()
    startPlayback(session, 0)
  }, [startPlayback])

  /** Jump to a 0-based shot while staying in playback mode. */
  const seek = useCallback(
    (index: number) => {
      const session = sessionRef.current
      if (!session || phaseRef.current === 'idle') return
      const last = Math.max(0, session.shotCount - 1)
      const next = Math.max(0, Math.min(last, Math.floor(index)))
      shotIndexRef.current = next
      applyShot(session, next)

      if (next >= last) {
        clearTimer()
        setStatus({
          phase: 'ended',
          active: true,
          shotIndex: next,
          shotCount: session.shotCount,
          support: session.support,
          eqRotation: session.eqRotation,
        })
        return
      }

      const phase =
        phaseRef.current === 'ended' ? 'paused' : phaseRef.current
      setStatus({
        phase,
        active: true,
        shotIndex: next,
        shotCount: session.shotCount,
        support: session.support,
        eqRotation: session.eqRotation,
      })

      if (phase === 'playing') {
        scheduleFrom(next)
      } else {
        clearTimer()
      }
    },
    [applyShot, scheduleFrom],
  )

  useEffect(() => () => clearTimer(), [])

  return {
    status,
    start,
    pause,
    resume,
    stop,
    replay,
    seek,
    exit,
  }
}
