// src/renderer/compositor.js
// WebGL compositing pass: uploads the Canvas2D pond texture each frame and
// draws a fullscreen quad. Pass-through by default; future effect shaders
// extend the fragment shader. The Y-flip between Canvas2D (top-left origin)
// and WebGL (bottom-left origin) is baked into the vertex shader UV output.

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
uniform bool uChromaKey;
uniform float uThreshold;
void main() {
  vec4 c = texture2D(uTex, vUv);
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

    const gl = this._gl = glCanvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL unavailable');

    // Compile and link the pass-through program.
    this._prog = _link(gl, VERT, FRAG);
    gl.useProgram(this._prog);

    // Fullscreen quad: four clip-space corners drawn as a TRIANGLE_STRIP.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1,  1,-1,  -1,1,  1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this._prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Texture that receives the pond canvas each frame.
    const tex = this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Uniforms — sampler bound to unit 0; chroma-key off by default.
    gl.uniform1i(gl.getUniformLocation(this._prog, 'uTex'), 0);
    this._uChromaKey = gl.getUniformLocation(this._prog, 'uChromaKey');
    this._uThreshold = gl.getUniformLocation(this._prog, 'uThreshold');
    gl.uniform1i(this._uChromaKey, 0);
    gl.uniform1f(this._uThreshold, 0.01);
  }

  /** Upload the pond canvas as a texture and draw the fullscreen quad. */
  frame() {
    const gl = this._gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._pond);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Key out pure-black pixels (alpha → 0). threshold: luminance floor, default 0.01. */
  setChromaKey(enabled, threshold = 0.01) {
    const gl = this._gl;
    gl.uniform1i(this._uChromaKey, enabled ? 1 : 0);
    gl.uniform1f(this._uThreshold, threshold);
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
