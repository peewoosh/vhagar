import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/bun'
import healthRouter from './routers/health'
import statusRouter from './routers/status'
import mediaRouter from './routers/media'
import torrentsRouter from './routers/torrents'
import { serveRouter } from './routers/media/share'

const app = new Hono()

app.use('*', logger())

app.route('/api/health', healthRouter)
app.route('/api/status', statusRouter)
app.route('/api/media', mediaRouter)
app.route('/api/torrents', torrentsRouter)
app.route('/f', serveRouter)

// Frontend is a prebuilt static SPA bundled into the same image — no separate
// nginx container, no CORS needed (same origin). Falls through to index.html
// for any path the API/share routes above didn't already claim.
app.use('/*', serveStatic({ root: './public' }))
app.use('/*', serveStatic({ path: './public/index.html' }))

export default {
  port: 8000,
  fetch: app.fetch,
  idleTimeout: 120,
}
