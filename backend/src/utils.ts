import type { Context } from 'hono'

export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 5000): Promise<Response> {
  return withTimeout(ms, signal => fetch(url, { ...init, signal }))
}

export async function parseJsonBody<T>(c: Context): Promise<T | Response> {
  try {
    return await c.req.json<T>()
  } catch {
    return c.json({ success: false, message: 'invalid body' }, 400)
  }
}

export function fail(c: Context, err: unknown) {
  return c.json({ success: false, message: String(err) }, 500)
}
