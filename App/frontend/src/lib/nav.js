// Navigation indirection (allows navigation from any module without importing router)
let _nav = () => {}
export const setNav = fn => { _nav = fn }
// Navigate to a route
export const nav = to => _nav(to)
