/// <reference lib="webworker" />
import { computeHaloField, type HaloFieldInput } from './haloFieldCore'

type Request = { id: number; input: HaloFieldInput }

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, input } = event.data
  try {
    let last = 0
    const field = computeHaloField(input, (done) => {
      if (done - last >= 0.05 || done === 1) {
        last = done
        self.postMessage({ id, progress: done })
      }
    })
    self.postMessage({ id, field }, [field.buffer])
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
