import { Buffer } from 'buffer'
// @ts-expect-error - polyfill Buffer for isomorphic-git in browser
globalThis.Buffer = Buffer
