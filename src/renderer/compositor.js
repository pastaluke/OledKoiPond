// src/renderer/compositor.js
// WebGL compositing pass: uploads the Canvas2D pond texture each frame and
// draws a fullscreen quad. The Y-flip between Canvas2D (top-left origin)
// and WebGL (bottom-left origin) is baked into the vertex shader UV output.
//
// Glass edge: chromatic aberration in the border band. Each color channel is
// displaced along the inward-pointing edge normal by a different amount so the
// band refracts like curved glass. Strength scales with depth into the band.

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
uniform bool  uGlassEdge;
uniform float uBorderPx;
uniform float uGlassStr;

void main() {
  vec2 uv = vUv;
  vec4 c;

  if (uGlassEdge && uBorderPx > 0.0) {
    float dL = uv.x * uRes.x;
    float dR = (1.0 - uv.x) * uRes.x;
    float dT = uv.y * uRes.y;
    float dB = (1.0 - uv.y) * uRes.y;
    float dEdge = min(min(dL, dR), min(dT, dB));

    if (dEdge < uBorderPx) {
      float t = 1.0 - dEdge / uBorderPx;
      const float eps = 0.5;
      vec2 norm = normalize(vec2(
        1.0 / (dL + eps) - 1.0 / (dR + eps),
        1.0 / (dT + eps) - 1.0 / (dB + eps)
      ));
      vec2 step1px = 1.0 / uRes;
      float disp = t * uGlassStr;
      float r = texture2D(uTex, uv + norm * disp * 1.5 * step1px).r;
      float g = texture2D(uTex, uv + norm * disp * 1.0 * step1px).g;
      float b = texture2D(uTex, uv + norm * disp * 0.5 * step1px).b;
      c = vec4(r, g, b, 1.0);
    } else {
      c = texture2D(uTex, uv);
    }
  } else {
    c = texture2D(uTex, uv);
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

    gl.uniform1i(this._uChromaKey, 0);
    gl.uniform1f(this._uThreshold, 0.01);
    gl.uniform1i(this._uGlassEdge, 0);
    gl.uniform1f(this._uBorderPx, 0);
    gl.uniform1f(this._uGlassStr, 6.0);
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
