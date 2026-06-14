// src/renderer/compositor.js
// WebGL compositing pass: uploads the Canvas2D pond texture each frame and
// draws a fullscreen quad. The Y-flip between Canvas2D (top-left origin)
// and WebGL (bottom-left origin) is baked into the vertex shader UV output.
//
// Glass effects share one primitive — glassShift() — a chromatic edge
// displacement: each color channel is sampled at an increasing offset along an
// inward normal so the band refracts like curved glass. It drives both the
// border edge (screen-rect band) and freeform glass shapes (circle rims).

/** Max simultaneous glass shapes the fragment shader loops over. */
export const MAX_SHAPES = 4;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
}`.trim();

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform bool  uChromaKey;
uniform float uThreshold;

// Border glass edge
uniform bool  uGlassEdge;
uniform float uBorderPx;
uniform float uGlassStr;

// Glass shapes (circles). CR = (centerX_uv, centerY_uv, radius_h);
// BS = (band_h, strength_px). radius/band are in height-fraction units so
// circles stay round regardless of aspect.
const int MAX_SHAPES = ${MAX_SHAPES};
uniform int  uShapeCount;
uniform vec3 uShapeCR[MAX_SHAPES];
uniform vec2 uShapeBS[MAX_SHAPES];

// Chromatic edge displacement shared by border + shapes. dir is a unit UV
// vector pointing inward; t∈[0,1] is depth into the band (1 at the rim);
// strength is in pixels; px = 1/uRes.
vec4 glassShift(vec2 uv, vec2 dir, float t, float strength, vec2 px) {
  float disp = t * strength;
  float r = texture2D(uTex, uv + dir * disp * 1.5 * px).r;
  float g = texture2D(uTex, uv + dir * disp * 1.0 * px).g;
  float b = texture2D(uTex, uv + dir * disp * 0.5 * px).b;
  return vec4(r, g, b, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 px = 1.0 / uRes;
  float aspect = uRes.x / uRes.y;
  vec4 c = texture2D(uTex, uv);

  // ── Border glass edge — band hugging the screen rectangle ──────────────────
  if (uGlassEdge && uBorderPx > 0.0) {
    float dL = uv.x * uRes.x;
    float dR = (1.0 - uv.x) * uRes.x;
    float dT = uv.y * uRes.y;
    float dB = (1.0 - uv.y) * uRes.y;
    float dEdge = min(min(dL, dR), min(dT, dB));
    if (dEdge < uBorderPx) {
      float t = 1.0 - dEdge / uBorderPx;
      vec2 norm = normalize(vec2(
        1.0 / (dL + 0.5) - 1.0 / (dR + 0.5),
        1.0 / (dT + 0.5) - 1.0 / (dB + 0.5)
      ));
      c = glassShift(uv, norm, t, uGlassStr, px);
    }
  }

  // ── Glass shapes — chromatic rim band on each circle ───────────────────────
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    vec3 cr = uShapeCR[i];
    vec2 bs = uShapeBS[i];
    float radius = cr.z;
    float band   = bs.x;
    vec2 toC = cr.xy - uv;                     // toward center, plain UV
    vec2 ad  = vec2(toC.x * aspect, toC.y);    // aspect-corrected for round test
    float dist = length(ad);
    if (band > 0.0 && dist < radius && dist > radius - band) {
      float t = (dist - (radius - band)) / band;   // 0 inner edge → 1 at rim
      c = glassShift(uv, normalize(toC), t, bs.y, px);
    }
  }

  float a = uChromaKey
    ? step(uThreshold, dot(c.rgb, vec3(0.299, 0.587, 0.114)))
    : 1.0;
  gl_FragColor = vec4(c.rgb, a);
}`.trim();

export class Compositor {
  /**
   * @param {HTMLCanvasElement} pondCanvas - Canvas2D render target (hidden).
   * @param {HTMLCanvasElement} glCanvas   - WebGL output canvas (visible).
   */
  constructor(pondCanvas, glCanvas) {
    this._pond = pondCanvas;
    this._glassEdge = false;

    const gl = this._gl = glCanvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL unavailable');

    this._prog = _link(gl, VERT, FRAG);
    gl.useProgram(this._prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1,  1,-1,  -1,1,  1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this._prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.uniform1i(gl.getUniformLocation(this._prog, 'uTex'), 0);
    this._uChromaKey  = gl.getUniformLocation(this._prog, 'uChromaKey');
    this._uThreshold  = gl.getUniformLocation(this._prog, 'uThreshold');
    this._uRes        = gl.getUniformLocation(this._prog, 'uRes');
    this._uGlassEdge  = gl.getUniformLocation(this._prog, 'uGlassEdge');
    this._uBorderPx   = gl.getUniformLocation(this._prog, 'uBorderPx');
    this._uGlassStr   = gl.getUniformLocation(this._prog, 'uGlassStr');
    this._uShapeCount = gl.getUniformLocation(this._prog, 'uShapeCount');
    this._uShapeCR    = gl.getUniformLocation(this._prog, 'uShapeCR[0]');
    this._uShapeBS    = gl.getUniformLocation(this._prog, 'uShapeBS[0]');

    gl.uniform1i(this._uChromaKey, 0);
    gl.uniform1f(this._uThreshold, 0.01);
    gl.uniform1i(this._uGlassEdge, 0);
    gl.uniform1f(this._uBorderPx, 0);
    gl.uniform1f(this._uGlassStr, 6.0);
    gl.uniform1i(this._uShapeCount, 0);
  }

  /** Aspect ratio (width / height) of the output framebuffer. */
  get aspect() {
    const gl = this._gl;
    return gl.drawingBufferWidth / gl.drawingBufferHeight;
  }

  /**
   * Upload the pond canvas as a texture and draw the fullscreen quad.
   * @param {number} [bandPx=0] - Border band width in physical pixels for the glass effect.
   */
  frame(bandPx = 0) {
    const gl = this._gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(this._uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this._uBorderPx, bandPx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._pond);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Key out pure-black pixels (alpha → 0). threshold: luminance floor, default 0.01. */
  setChromaKey(enabled, threshold = 0.01) {
    const gl = this._gl;
    gl.uniform1i(this._uChromaKey, enabled ? 1 : 0);
    gl.uniform1f(this._uThreshold, threshold);
  }

  /**
   * Enable/disable the glass edge chromatic aberration effect.
   * @param {boolean} enabled
   * @param {number}  [strength=6] - Displacement in pixels at the wall; R shifts 1.5×, B 0.5×.
   */
  setGlassEdge(enabled, strength = 6) {
    const gl = this._gl;
    this._glassEdge = enabled;
    gl.uniform1i(this._uGlassEdge, enabled ? 1 : 0);
    gl.uniform1f(this._uGlassStr, strength);
  }

  get glassEdge() { return this._glassEdge; }

  /**
   * Upload the active glass shapes as uniforms. Extra slots past the count are
   * ignored by the shader's count guard.
   * @param {{cx:number, cy:number, radius:number, band:number, strength:number}[]} shapes
   */
  setShapes(shapes) {
    const gl = this._gl;
    const n = Math.min(shapes.length, MAX_SHAPES);
    const cr = new Float32Array(MAX_SHAPES * 3);
    const bs = new Float32Array(MAX_SHAPES * 2);
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      cr[i * 3 + 0] = s.cx;
      cr[i * 3 + 1] = s.cy;
      cr[i * 3 + 2] = s.radius;
      bs[i * 2 + 0] = s.band;
      bs[i * 2 + 1] = s.strength;
    }
    gl.uniform1i(this._uShapeCount, n);
    gl.uniform3fv(this._uShapeCR, cr);
    gl.uniform2fv(this._uShapeBS, bs);
  }
}

function _link(gl, vertSrc, fragSrc) {
  const vert = _shader(gl, gl.VERTEX_SHADER,   vertSrc);
  const frag = _shader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog));
  return prog;
}

function _shader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
