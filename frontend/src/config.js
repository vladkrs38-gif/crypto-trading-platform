/** API base URL. Uses BASE_URL for /hh deployment on proplatforma.ru */
const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
export const API = base ? base + '/api' : '/api'
