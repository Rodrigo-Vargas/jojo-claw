import { createJojoClawServer } from './server.js'
const port = Number(process.env.PORT ?? 8788)
createJojoClawServer().listen(port, () => console.log(`Jojo Claw API is listening on http://localhost:${port}`))
