import { Hono } from 'hono'
import searchRouter  from './search'
import grabRouter    from './grab'
import libraryRouter from './library'
import queueRouter   from './queue'
import { createRouter } from './share'

const router = new Hono()

router.route('/', searchRouter)
router.route('/', grabRouter)
router.route('/', libraryRouter)
router.route('/', queueRouter)
router.route('/', createRouter)

export default router
