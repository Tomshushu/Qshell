// 空模块，用于在浏览器端构建时替换 Node.js 专用的 @napi-rs/canvas 原生二进制模块
export default {}
export const createCanvas = () => null
export const loadImage = () => Promise.resolve(null)
export const Image = class {}
