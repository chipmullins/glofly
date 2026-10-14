import { createBridge } from './bridge'

// Must run before any of the desktop screens' modules: some read window.glofly as they load.
window.glofly = createBridge()
