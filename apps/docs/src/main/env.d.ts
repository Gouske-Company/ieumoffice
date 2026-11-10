/** electron-vite bundles the module as its own chunk and returns its runtime path (worker threads) */
declare module '*?modulePath' {
  const path: string
  export default path
}
