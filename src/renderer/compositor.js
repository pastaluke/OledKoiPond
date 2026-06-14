// src/renderer/compositor.js
// WebGL compositing pass: uploads the Canvas2D pond texture each frame and
// draws a fullscreen quad. The Y-flip between Canvas2D (top-left origin)
// and WebGL (bottom-left origin) is baked into the vertex shader UV output.
//
// Glass effects — border edge and freeform shapes — share a physically-based
// displacement model inspired by liquidGL (MIT © NaughtyDuk):
//   • SDF edge-factor drives smooth refraction + pow(edge,10) bevel at the rim
//   • centreBlend keeps the lens centre as a clean passthrough window
//   • Our chromatic R/G/B channel-split adds fringing on top of the displacement
//   • Optional Poisson-disk frost blur, magnification, animated specular glints

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
uniform float uTime;
uniform bool  uChromaKey;
uniform float uThreshold;

// Border glass edge
uniform bool  uGlassEdge;
uniform float uBorderPx;
uniform float uGlassStr;

// Glass shapes — all geometry in height-fraction UV units (aspect-corrected in shader).
// uShapeA: (cx, cy, radius, bevelWidthFrac)
// uShapeB: (refraction, bevelDepth, chromatic_px, frost_px)
// uShapeC: (magnify, specular 0/1)
const int MAX_SHAPES = ${MAX_SHAPES};
uniform int  uShapeCount;
uniform vec4 uShapeA[MAX_SHAPES];
uniform vec4 uShapeB[MAX_SHAPES];
uniform vec2 uShapeC[MAX_SHAPES];

// ── Shared utilities ───────────────────────────────────────────────────────────

float rand2(vec2 st) {
  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);
}

// 16-sample Poisson disk frost blur.
vec4 frostSample(vec2 uv, vec2 texel, float radius) {
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float angle = rand2(uv + float(i)) * 6.2831853;
    float dist  = sqrt(rand2(uv - float(i))) * radius;
    sum += texture2D(uTex, uv + vec2(cos(angle), sin(angle)) * texel * dist);
  }
  return sum / 16.0;
}

// Border chromatic displacement (simple linear band, no bevel — screen edge look).
vec4 borderShift(vec2 uv, vec2 dir, float t, float strength, vec2 px) {
  float disp = t * strength;
  float r = texture2D(uTex, uv + dir * disp * 1.5 * px).r;
  float g = texture2D(uTex, uv + dir * disp * 1.0 * px).g;
  float b = texture2D(uTex, uv + dir * disp * 0.5 * px).b;
  return vec4(r, g, b, 1.0);
}

void main() {
  vec2 uv  = vUv;
  vec2 px  = 1.0 / uRes;
  float aspect = uRes.x / uRes.y;
  vec4 c = texture2D(uTex, uv);

  // ── Border glass edge — chromatic band hugging the screen rectangle ───────────
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
      c = borderShift(uv, norm, t, uGlassStr, px);
    }
  }

  // ── Glass shapes ──────────────────────────────────────────────────────────────
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;

    vec4 A = uShapeA[i];  // cx, cy, radius, bevelWidthFrac
    vec4 B = uShapeB[i];  // refraction, bevelDepth, chromatic_px, frost_px
    vec2 C = uShapeC[i];  // magnify, specular

    vec2  center         = A.xy;
    float radius         = A.z;
    float bevelWidthFrac = A.w;
    float refraction     = B.x;
    float bevelDepth     = B.y;
    float chromatic_px   = B.z;
    float frost_px       = B.w;
    float magnify        = max(C.x, 0.01);
    float specular       = C.y;

    // Aspect-corrected distance for a round test.
    vec2 toC = center - uv;
    vec2 ad  = vec2(toC.x * aspect, toC.y);
    float dist = length(ad);

    if (dist >= radius) continue;

    vec2 normTC = normalize(toC);

    // Edge factor: 1.0 at the rim, 0.0 inward over bevelWidthFrac*radius.
    float bevelBand = max(bevelWidthFrac * radius, 0.001);
    float edgeFact  = 1.0 - smoothstep(0.0, bevelBand, radius - dist);

    // Centre blend: 0 at exact center → 1 at 40% radius outward.
    // Keeps the lens centre as a clean passthrough window.
    float centreBlend = smoothstep(0.0, radius * 0.4, dist);

    // Displacement: smooth refraction + sharp bevel at rim (liquidGL formula).
    float dispAmt = edgeFact * refraction + pow(edgeFact, 10.0) * bevelDepth;

    // Magnification — zoom sample toward shape center.
    vec2 magUV = (uv - center) / magnify + center;

    // Final sample UV: magnified + displacement directed toward center.
    vec2 sampleUV = clamp(magUV + normTC * dispAmt * centreBlend,
                          vec2(0.001), vec2(0.999));

    vec4 refracted;
    if (frost_px > 0.0) {
      // Frost blur: Poisson disk — chromatic skipped (invisible through blur).
      refracted = frostSample(sampleUV, px, frost_px);
    } else {
      // Chromatic split: R/G/B sampled at ±offset along normTC, proportional to
      // edgeFact so fringing concentrates at the rim and fades toward centre.
      float cs = chromatic_px * edgeFact;
      refracted = vec4(
        texture2D(uTex, sampleUV + normTC * cs * 1.5 * px).r,
        texture2D(uTex, sampleUV                          ).g,
        texture2D(uTex, sampleUV - normTC * cs * 1.5 * px).b,
        1.0
      );
    }

    // Anti-halo: near the centre where centreBlend≈0, displacement is tiny but
    // magnification can still shift the sample across a hard edge → blend back
    // to the base pixel to avoid jarring seams.
    vec4  base     = texture2D(uTex, uv);
    float diff     = clamp(length(refracted.rgb - base.rgb) * 4.0, 0.0, 1.0);
    float antiHalo = (1.0 - centreBlend) * diff;
    c = mix(refracted, base, antiHalo);

    // Specular: two animated light glints orbiting with sin/cos of uTime.
    if (specular > 0.5) {
      vec2 lp1 = vec2(sin(uTime * 0.2 ), cos(uTime *  0.30      )) * 0.6 + 0.5;
      vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.25 - 0.5)) * 0.6 + 0.5;
      float h  = smoothstep(0.4, 0.0, distance(uv, lp1)) * 0.10
               + smoothstep(0.5, 0.0, distance(uv, lp2)) * 0.08;
      c.rgb += h;
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
    this._pond      = pondCanvas;
    this._glassEdge = false;
    this._startTime = performance.now();

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

    const loc = (name) => gl.getUniformLocation(this._prog, name);
    gl.uniform1i(loc('uTex'), 0);
    this._uChromaKey  = loc('uChromaKey');
    this._uThreshold  = loc('uThreshold');
    this._uRes        = loc('uRes');
    this._uTime       = loc('uTime');
    this._uGlassEdge  = loc('uGlassEdge');
    this._uBorderPx   = loc('uBorderPx');
    this._uGlassStr   = loc('uGlassStr');
    this._uShapeCount = loc('uShapeCount');
    this._uShapeA     = loc('uShapeA[0]');
    this._uShapeB     = loc('uShapeB[0]');
    this._uShapeC     = loc('uShapeC[0]');

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
    gl.uniform1f(this._uTime, (performance.now() - this._startTime) / 1000);
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
   * Upload the active glass shapes as uniforms.
   * @param {{cx,cy,radius,bevelWidth,refraction,bevelDepth,chromatic,frost,magnify,specular}[]} shapes
   */
  setShapes(shapes) {
    const gl = this._gl;
    const n  = Math.min(shapes.length, MAX_SHAPES);
    const A  = new Float32Array(MAX_SHAPES * 4);
    const B  = new Float32Array(MAX_SHAPES * 4);
    const C  = new Float32Array(MAX_SHAPES * 2);
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      A[i*4+0] = s.cx;         A[i*4+1] = s.cy;
      A[i*4+2] = s.radius;     A[i*4+3] = s.bevelWidth;
      B[i*4+0] = s.refraction; B[i*4+1] = s.bevelDepth;
      B[i*4+2] = s.chromatic;  B[i*4+3] = s.frost;
      C[i*2+0] = s.magnify;    C[i*2+1] = s.specular ? 1 : 0;
    }
    gl.uniform1i(this._uShapeCount, n);
    gl.uniform4fv(this._uShapeA, A);
    gl.uniform4fv(this._uShapeB, B);
    gl.uniform2fv(this._uShapeC, C);
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
