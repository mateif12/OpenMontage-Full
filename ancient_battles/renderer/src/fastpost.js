// Fused, resolution-independent post-process (optimised pipeline).
// The 3D scene renders into an internal-resolution HDR target; ONE full-screen
// pass at the output resolution (1080x1920) does: ACES tone map + sRGB (same as
// OutputPass), tilt-shift (2-D Gaussian equivalent to the legacy separable
// 9-tap blur), warm grade, vignette, grain, and composites the text overlay
// (labels/captions drawn with Canvas2D at full output resolution, so text is
// never upscaled). Replaces 4 legacy passes + the DOM screenshot.
import * as THREE from 'three';

const ACES = `
vec3 RRTAndODTFit(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
vec3 aces(vec3 c){
  const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));
  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));
  c *= exposure/0.6; c = I*c; c = RRTAndODTFit(c); c = O*c; return clamp(c,0.0,1.0); }
vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(vec3(0.0031308), c)); }
vec3 outc(vec2 uv){ return srgb(aces(texture2D(tScene, uv).rgb)); }`;

export function makeFastPost(renderer, scene, camera, out, internal, samples) {
  const rt = new THREE.WebGLRenderTarget(internal.w, internal.h, { type: THREE.HalfFloatType, samples });
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  const ov = document.createElement('canvas'); ov.width = out.w; ov.height = out.h;
  const ovTex = new THREE.CanvasTexture(ov); ovTex.colorSpace = THREE.NoColorSpace; ovTex.flipY = true;
  const mat = new THREE.ShaderMaterial({
    toneMapped: false, depthTest: false, depthWrite: false,
    uniforms: { tScene: { value: rt.texture }, tOv: { value: ovTex }, res: { value: new THREE.Vector2(out.w, out.h) }, exposure: { value: renderer.toneMappingExposure },
      focus: { value: 0.5 }, band: { value: 0.12 }, amount: { value: 9 }, seed: { value: 0 }, vig: { value: 0.32 }, grain: { value: 0.035 }, warm: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tScene, tOv; uniform vec2 res; uniform float exposure, focus, band, amount, seed, vig, grain, warm; varying vec2 vUv;
      ${ACES}
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))+seed)*43758.5453); }
      void main(){
        float r = amount*smoothstep(band, band+0.32, abs(vUv.y-focus));
        vec3 col;
        if (r < 0.25) col = outc(vUv);
        else {
          // 2-D Gaussian, sigma = 2r/3 px (matches legacy separable 9-tap blur with step r/3)
          float s = 2.0*r/3.0; vec2 px = 1.0/res; vec3 acc = outc(vUv); float w = 1.0;
          for (int i=0;i<8;i++){ float a = float(i)*0.7853982; vec2 d = vec2(cos(a),sin(a));
            float w1 = exp(-0.5*0.81); acc += outc(vUv + d*s*0.9*px)*w1; w += w1;
            vec2 d2 = vec2(cos(a+0.3927),sin(a+0.3927)); float w2 = exp(-0.5*3.61); acc += outc(vUv + d2*s*1.9*px)*w2; w += w2; }
          col = acc/w;
        }
        float l = dot(col, vec3(0.299,0.587,0.114));
        col = mix(col, col*vec3(1.03,1.0,0.94), warm*0.6);
        col = mix(vec3(l), col, 0.97);
        col = (col-0.5)*1.06+0.5;
        vec2 q = vUv-0.5; col *= 1.0 - vig*dot(q*vec2(1.25,1.0),q*vec2(1.25,1.0))*2.2;
        col += (h(vUv*1000.0)-0.5)*grain;
        vec4 o = texture2D(tOv, vUv); col = mix(col, o.rgb, o.a);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    overlay: ov, ovTex,
    set({ focus = 0.5, blur = 1, band = 0.12, frame = 0, vig = 0.32 }) { const u = mat.uniforms; u.focus.value = focus; u.amount.value = 9 * blur * (out.h / 1920); u.band.value = band; u.seed.value = frame * 1.37; u.vig.value = vig; },
    _sceneOnly() { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); },
    _quadOnly() { renderer.setRenderTarget(null); renderer.render(qs, qc); },
    render() {
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      renderer.setRenderTarget(null); renderer.render(qs, qc);
    },
  };
}

// ---- Canvas2D overlay mirroring the DOM styles in index.html
export function drawOverlay(cv, s) {
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  // label chip
  g.font = "600 25px 'Space Grotesk'"; g.letterSpacing = '4px';
  const cw = g.measureText(s.chip).width + 32;
  g.fillStyle = 'rgba(14,11,8,0.62)'; g.fillRect(54, 120, cw + 4, 50); g.fillStyle = '#c9a24a'; g.fillRect(54, 120, 4, 50);
  g.fillStyle = '#f4ead6'; g.textBaseline = 'middle'; g.fillText(s.chip, 74, 146);
  g.letterSpacing = '0px';
  g.font = "44px 'Playfair'"; g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 12; g.shadowOffsetY = 2; g.textBaseline = 'alphabetic';
  g.fillText(s.title, 54, 236); g.shadowColor = 'transparent';
  if (s.notes) {
    g.font = "23px 'Space Grotesk'"; g.letterSpacing = '1px';
    const lines = wrap(g, s.notes, 852); const lh = 29;
    g.fillStyle = 'rgba(14,11,8,0.5)'; g.fillRect(54, 262, Math.max(...lines.map((l) => g.measureText(l).width)) + 28, lines.length * lh + 14);
    g.fillStyle = '#efe2c4'; lines.forEach((l, i) => g.fillText(l, 68, 262 + 7 + 22 + i * lh)); g.letterSpacing = '0px';
  }
  if (s.words && s.words.length) {
    g.font = "700 62px 'Space Grotesk'"; const space = g.measureText(' ').width; const maxW = 940;
    const lines = [[]]; let w = 0;
    for (const wd of s.words) { const ww = g.measureText(wd.w).width; if (w && w + space + ww > maxW) { lines.push([]); w = 0; } lines[lines.length - 1].push({ ...wd, ww }); w += (w ? space : 0) + ww; }
    const lh = 62 * 1.15; let y = 1920 - 555 - (lines.length - 1) * lh - 14;
    for (const line of lines) {
      const tw = line.reduce((a, x) => a + x.ww, 0) + space * (line.length - 1); let x = 540 - tw / 2;
      for (const wd of line) {
        g.fillStyle = wd.on ? '#f2c46a' : '#f4ead6';
        g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 14; g.shadowOffsetY = 3; g.fillText(wd.w, x, y);
        g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 3; g.shadowOffsetY = 0; g.fillText(wd.w, x, y);
        x += wd.ww + space;
      }
      y += lh;
    }
    g.shadowColor = 'transparent';
  }
}
function wrap(g, text, maxW) { const out = []; let cur = ''; for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }
