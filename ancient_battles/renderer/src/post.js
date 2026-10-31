// Post-processing for the miniature look: tilt-shift (vertical-gradient blur
// around a focus band), warm grade, vignette and fine grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const blurShader = (dir) => ({
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(1080, 1920) }, focus: { value: 0.5 }, band: { value: 0.12 }, amount: { value: 6 }, dir: { value: new THREE.Vector2(...dir) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res,dir; uniform float focus,band,amount; varying vec2 vUv;
    void main(){ float d = abs(vUv.y-focus); float r = amount*smoothstep(band, band+0.32, d);
      if(r<0.25){ gl_FragColor = texture2D(tDiffuse,vUv); return; }
      vec2 st = dir/res*r/3.0; vec4 c = vec4(0.0); float w = 0.0;
      for(int i=-4;i<=4;i++){ float f=float(i); float g=exp(-f*f/8.0); c += texture2D(tDiffuse, vUv+st*f)*g; w+=g; }
      gl_FragColor = c/w; }`,
});
const gradeShader = {
  uniforms: { tDiffuse: { value: null }, seed: { value: 0 }, vig: { value: 0.32 }, grain: { value: 0.035 }, warm: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float seed,vig,grain,warm; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))+seed)*43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse,vUv); vec3 col=c.rgb;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, col*vec3(1.03,1.0,0.94), warm*0.6);                 // warm
      col = mix(vec3(l), col, 0.97);                                   // slight saturation
      col = (col-0.5)*1.06+0.5;                                        // contrast
      vec2 q = vUv-0.5; col *= 1.0 - vig*dot(q*vec2(1.25,1.0),q*vec2(1.25,1.0))*2.2;
      col += (h(vUv*1000.0)-0.5)*grain;
      gl_FragColor = vec4(col, c.a); }`,
};

export function makePost(renderer, scene, camera, w, h, samples = 4) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.renderTarget2.samples = 0; // MSAA only where the scene is rasterised
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass()); // tone map + sRGB before blur/grade
  const bh = new ShaderPass(blurShader([1, 0])), bv = new ShaderPass(blurShader([0, 1]));
  for (const p of [bh, bv]) p.uniforms.res.value.set(w, h);
  const grade = new ShaderPass(gradeShader);
  composer.addPass(bh); composer.addPass(bv); composer.addPass(grade);
  return {
    composer,
    set({ focus = 0.5, blur = 1, band = 0.12, frame = 0, vig = 0.32 }) {
      for (const p of [bh, bv]) { p.uniforms.focus.value = focus; p.uniforms.amount.value = 9 * blur * (h / 1920); p.uniforms.band.value = band; }
      grade.uniforms.seed.value = frame * 1.37; grade.uniforms.vig.value = vig;
    },
  };
}
