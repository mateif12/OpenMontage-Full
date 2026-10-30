import React from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { Cannon, Cavalryman, FactionKit, Flag, Headgear, Pose, Soldier } from "./figures";
import { BattleKit, BattleScene, BattleSide } from "./types";

// Code-drawn, period-aware battle illustration (original artwork, generic
// figures). Everything period-specific comes from the scene's resolved period
// kit (styles/periods/<id>.yaml via build_props.py): uniforms, headgear,
// weapons, artillery, buildings, terrain and palette. Cinematic structure:
// sky + far / mid / near depth planes with atmospheric haze, a dolly camera
// with parallax, and muzzle flashes / smoke on narrated beats (fireAt).
// Label: "ORIGINAL ILLUSTRATION" — never presented as a depiction of real units.

const W = 1080;
const H = 1920;
const HORIZON = 640;
const ease = Easing.inOut(Easing.cubic);

// depth d: 0 = horizon, 1 = at the camera. The main action band (d ≈ 0.42-0.6)
// lands at y ≈ 980-1225, just above the caption block.
const groundY = (d: number) => HORIZON + (1900 - HORIZON) * Math.pow(d, 1.5);
const scaleAt = (d: number) => 0.2 + 3.4 * Math.pow(d, 1.5);
const parallax = (d: number) => 0.12 + 0.88 * d;

const hex = (c: string) => {
  const m = c.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number) => {
  if (!a || !a.startsWith("#")) return a;
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
};
// atmospheric perspective: far figures fade toward the haze colour
const hazeKit = (k: FactionKit, haze: string, d: number): FactionKit => {
  const t = Math.max(0, Math.min(0.75, (1 - d) * 0.85 - 0.1));
  const m = (c?: string) => (c ? mix(c, haze, t) : c);
  return {
    ...k,
    coat: m(k.coat) as string,
    facings: m(k.facings),
    trousers: m(k.trousers),
    headgear_color: m(k.headgear_color),
    plume: m(k.plume),
    shield_color: m(k.shield_color),
    horse: m(k.horse),
  };
};

const Ridge: React.FC<{ seed: string; base: number; amp: number; color: string; shift: number }> = ({
  seed,
  base,
  amp,
  color,
  shift,
}) => {
  const pts = [`M -200 ${H}`];
  for (let x = -200; x <= W + 200; x += 24) {
    const xx = x + shift;
    const y =
      base -
      amp *
        (0.55 * Math.sin(xx * 0.004 + random(seed) * 6) +
          0.3 * Math.sin(xx * 0.011 + random(seed + "b") * 6) +
          0.15 * Math.sin(xx * 0.03));
    pts.push(`L ${x} ${y.toFixed(1)}`);
  }
  pts.push(`L ${W + 200} ${H} Z`);
  return <path d={pts.join(" ")} fill={color} />;
};

const Building: React.FC<{ type: string; pal: BattleKit["palette"]; burning: boolean; t: number }> = ({
  type,
  pal,
  burning,
  t,
}) => {
  const wall = "#d9d0bc";
  const roof = "#8a3b26";
  const stone = "#a49c8a";
  const fire = burning ? (
    <g>
      {[0, 1, 2].map((i) => (
        <ellipse
          key={i}
          cx={-30 + i * 40}
          cy={-150 - 10 * Math.sin(t * 7 + i)}
          rx={18 + 6 * Math.sin(t * 9 + i * 2)}
          ry={34 + 8 * Math.sin(t * 6 + i)}
          fill={i === 1 ? "#ffb347" : "#e2582a"}
          opacity={0.85}
        />
      ))}
    </g>
  ) : null;
  switch (type) {
    case "church":
    case "ruined-church":
      return (
        <g>
          <rect x={-90} y={-110} width={150} height={110} fill={stone} />
          <path d="M-96,-110 L-15,-170 L66,-110 Z" fill={type === "church" ? "#5d5a55" : stone} />
          <rect x={50} y={-230} width={50} height={230} fill={stone} />
          {type === "church" ? <path d="M46,-230 L75,-300 L104,-230 Z" fill="#5d5a55" /> : <path d="M50,-230 L62,-250 L80,-226 L100,-244 L100,-230 Z" fill={pal.shadow} />}
          <rect x={-60} y={-80} width={18} height={32} fill={pal.shadow} />
          <rect x={-10} y={-80} width={18} height={32} fill={pal.shadow} />
          {fire}
        </g>
      );
    case "castle":
    case "town-wall":
      return (
        <g>
          <rect x={-260} y={-120} width={520} height={120} fill={stone} />
          {Array.from({ length: 14 }).map((_, i) => (
            <rect key={i} x={-260 + i * 38} y={-138} width={22} height={20} fill={stone} />
          ))}
          <rect x={-60} y={-240} width={120} height={240} fill={mix(stone, pal.shadow, 0.15)} />
          {Array.from({ length: 4 }).map((_, i) => (
            <rect key={i} x={-60 + i * 34} y={-262} width={20} height={24} fill={mix(stone, pal.shadow, 0.15)} />
          ))}
          <rect x={-14} y={-60} width={28} height={60} rx={14} fill={pal.shadow} />
          {fire}
        </g>
      );
    case "temple":
      return (
        <g>
          <path d="M-200,-170 L0,-230 L200,-170 Z" fill="#e3dccb" />
          <rect x={-200} y={-170} width={400} height={16} fill="#d6cfbd" />
          {Array.from({ length: 8 }).map((_, i) => (
            <rect key={i} x={-190 + i * 54} y={-154} width={18} height={140} fill="#e3dccb" />
          ))}
          <rect x={-210} y={-14} width={420} height={14} fill="#cfc7b3" />
        </g>
      );
    default:
      // farmhouse with walled courtyard (generic rural building)
      return (
        <g>
          <rect x={-220} y={-60} width={440} height={60} fill={mix(wall, pal.shadow, 0.1)} />
          <rect x={-150} y={-150} width={220} height={150} fill={wall} />
          <path d="M-165,-150 L-40,-215 L85,-150 Z" fill={roof} />
          <rect x={90} y={-110} width={110} height={110} fill={mix(wall, pal.shadow, 0.12)} />
          <path d="M80,-110 L145,-150 L210,-110 Z" fill={mix(roof, pal.shadow, 0.15)} />
          {[-120, -70, -20, 30].map((x) => (
            <rect key={x} x={x} y={-120} width={22} height={30} fill={pal.shadow} />
          ))}
          <rect x={-60} y={-60} width={50} height={60} fill={pal.shadow} />
          {fire}
        </g>
      );
  }
};

const Vegetation: React.FC<{ kinds: string[]; pal: BattleKit["palette"]; camX: number; seed: string }> = ({
  kinds,
  pal,
  camX,
  seed,
}) => {
  const out: React.ReactNode[] = [];
  const d = 0.1;
  const y = groundY(d);
  const col = mix(pal.ground_far, pal.haze, 0.35);
  kinds.forEach((k, ki) => {
    for (let i = 0; i < 9; i++) {
      const x = ((random(`${seed}-${k}-${i}`) * 1800 - 300 - camX * parallax(d)) % 1800) - 200;
      const s = 0.7 + random(`${seed}-${k}-s${i}`) * 0.6;
      if (k === "poplars" || k === "cypress")
        out.push(<ellipse key={`${ki}-${i}`} cx={x} cy={y - 70 * s} rx={9 * s} ry={70 * s} fill={col} />);
      else if (k === "oaks" || k === "olive" || k === "hedgerows")
        out.push(<ellipse key={`${ki}-${i}`} cx={x} cy={y - 26 * s} rx={42 * s} ry={28 * s} fill={col} />);
      else if (k === "hedges" || k === "fences" || k === "scrub")
        out.push(<rect key={`${ki}-${i}`} x={x - 80} y={y - 10} width={160 * s} height={10} rx={5} fill={col} />);
      else if (k === "shattered-trees")
        out.push(
          <g key={`${ki}-${i}`} stroke={mix(pal.shadow, pal.haze, 0.4)} strokeWidth={4 * s}>
            <line x1={x} y1={y} x2={x + 6} y2={y - 90 * s} />
            <line x1={x + 4} y1={y - 50 * s} x2={x + 26 * s} y2={y - 70 * s} />
          </g>,
        );
    }
  });
  return <g>{out}</g>;
};

type Placed = { d: number; x: number; node: React.ReactNode };

const rank = (
  side: BattleSide,
  haze: string,
  opts: {
    d: number;
    x0: number;
    x1: number;
    n: number;
    pose: Pose;
    facing: 1 | -1;
    t: number;
    speed?: number;
    seed: string;
    recoilAt?: number[];
    flagAt?: number;
  },
): Placed[] => {
  const kit = hazeKit(side.faction, haze, opts.d);
  const out: Placed[] = [];
  for (let i = 0; i < opts.n; i++) {
    const jitter = (random(`${opts.seed}-${i}`) - 0.5) * 8;
    const x = opts.x0 + ((opts.x1 - opts.x0) * (i + 0.5)) / opts.n + jitter + (opts.speed ?? 0) * opts.t * opts.facing;
    const phase = (opts.t * 1.6 + random(`${opts.seed}-p${i}`) * 0.25) % 1;
    let recoil = 0;
    for (const f of opts.recoilAt ?? []) {
      const dt = opts.t - f - i * 0.012;
      if (dt > 0 && dt < 0.6) recoil = Math.max(recoil, Math.exp(-dt / 0.15));
    }
    const s = scaleAt(opts.d);
    out.push({
      d: opts.d,
      x,
      node: (
        <g transform={`translate(0 ${groundY(opts.d)}) scale(${s * opts.facing} ${s})`}>
          <Soldier kit={kit} pose={opts.pose} phase={phase} recoil={recoil} />
          {opts.flagAt === i && side.faction.flag ? (
            <g>
              <line x1={14} y1={0} x2={18} y2={-150} stroke="#5a4026" strokeWidth={2} />
              <g transform="translate(18 -150) scale(1.2)">
                <Flag colors={side.faction.flag} orientation={side.faction.flag_orientation} wave={Math.sin(opts.t * 3)} />
              </g>
            </g>
          ) : null}
        </g>
      ),
    });
  }
  return out;
};

export const BattleSceneView: React.FC<{ scene: BattleScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps; // seconds into the scene
  const T = scene.start + t; // absolute narration time
  const dur = Math.max(0.1, scene.end - scene.start);
  const p = ease(Math.min(1, t / dur));
  const kit = scene.kit;
  const pal = kit.palette;
  const seed = scene.seed ?? scene.id;
  const camX = interpolate(p, [0, 1], [scene.camera?.from ?? 0, scene.camera?.to ?? 160]);
  const zoom = interpolate(p, [0, 1], [1.0, scene.camera?.zoom ?? 1.06]);
  const fire = (scene.fireAt ?? []).map((f) => f - scene.start);
  const left = scene.left;
  const right = scene.right;
  const placed: Placed[] = [];
  const flashes: { x: number; y: number; s: number; at: number; d: number }[] = [];
  const tpl = scene.template;

  // --- figures per template -------------------------------------------------
  if (tpl === "line-advance" || tpl === "armies-facing" || tpl === "volley") {
    const pose: Pose = tpl === "line-advance" ? "march" : tpl === "volley" ? "aim" : "stand";
    const speed = tpl === "line-advance" ? 34 : 0;
    const n = left.count ?? 20;
    // reserve column far back, for depth
    placed.push(
      ...rank(left, pal.haze, { d: 0.27, x0: -300, x1: 300, n: 14, pose: tpl === "line-advance" ? "march" : "stand",
        facing: 1, t, speed: speed * 0.6, seed: `${seed}-B` }),
    );
    [0.44, 0.5, 0.56].forEach((d, r) =>
      placed.push(
        ...rank(left, pal.haze, {
          d, x0: -180 + r * 24, x1: 820 + r * 30, n: n - r, pose: r === 2 || pose !== "aim" ? pose : "stand",
          facing: 1, t, speed, seed: `${seed}-L${r}`, recoilAt: r === 2 ? fire : undefined, flagAt: r === 1 ? Math.floor(n / 2) : undefined,
        }),
      ),
    );
    if (tpl === "volley") {
      const s = scaleAt(0.56);
      for (let i = 0; i < n - 2; i++) {
        const x = -132 + ((1032 - 0) * (i + 0.5)) / (n - 2);
        for (const f of fire) flashes.push({ x: x + 76 * s, y: groundY(0.56) - 80 * s, s: 0.8, at: f + i * 0.012, d: 0.56 });
      }
    }
    if (right) {
      placed.push(
        ...rank(right, pal.haze, {
          d: 0.3, x0: 560, x1: 1300, n: right.count ?? 16, pose: tpl === "volley" ? "aim" : "stand", facing: -1, t,
          seed: `${seed}-R`, recoilAt: fire.map((f) => f + 1.4), flagAt: 6,
        }),
      );
      for (let i = 0; i < 6; i++)
        for (const f of fire) flashes.push({ x: 620 + i * 110, y: groundY(0.3) - 72 * scaleAt(0.3), s: 0.3, at: f + 1.4 + i * 0.05, d: 0.3 });
    }
    // near foreground: large figures of the left side passing through frame
    placed.push(
      ...rank(left, pal.haze, {
        d: 0.8, x0: -380, x1: 640, n: 3, pose: tpl === "volley" ? "aim" : pose, facing: 1, t, speed: speed * 1.5,
        seed: `${seed}-N`, recoilAt: fire.map((f) => f + 0.15),
      }),
    );
  } else if (tpl === "cavalry-charge") {
    const cav = left.cavalry ?? left.faction;
    const ckit = (d: number) => hazeKit(cav, pal.haze, d);
    [0.4, 0.5, 0.62].forEach((d, r) => {
      const n = (left.count ?? 9) - r * 2;
      for (let i = 0; i < n; i++) {
        const x = -620 + i * (160 + r * 40) + r * 60 + random(`${seed}-c${r}${i}`) * 50 + 210 * t;
        const s = scaleAt(d) * 0.85;
        placed.push({
          d,
          x,
          node: (
            <g transform={`translate(0 ${groundY(d)}) scale(${s} ${s})`}>
              <Cavalryman kit={ckit(d)} phase={(t * 2.2 + random(`${seed}-g${r}${i}`)) % 1} galloping />
            </g>
          ),
        });
      }
    });
    if (right)
      placed.push(
        ...rank(right, pal.haze, { d: 0.32, x0: 640, x1: 1320, n: right.count ?? 14, pose: "aim", facing: -1, t, seed: `${seed}-R` }),
      );
  } else if (tpl === "artillery") {
    const art = kit.artillery;
    const crew = art.crew ?? left.faction;
    [0.48, 0.58, 0.72].forEach((d, i) => {
      const x = 160 + i * 250;
      const s = scaleAt(d) * 1.1;
      let recoil = 0;
      for (const f of fire) {
        const dt = t - f - i * 0.35;
        if (dt > 0 && dt < 1.2) recoil = Math.max(recoil, dt < 0.08 ? dt / 0.08 : Math.exp(-(dt - 0.08) / 0.3));
        flashes.push({ x: x + 45 * s, y: groundY(d) - 36 * s, s: 1.1 + d, at: f + i * 0.35, d });
      }
      placed.push({
        d,
        x,
        node: (
          <g transform={`translate(0 ${groundY(d)}) scale(${s} ${s})`}>
            <Cannon barrel={art.barrel ?? "#8c6d3f"} carriage={art.carriage ?? "#4e4636"} recoil={recoil} modern={art.type === "modern"} />
          </g>
        ),
      });
      [-90, -60].forEach((dx, k) =>
        placed.push({
          d: d + 0.01,
          x: x + dx * s,
          node: (
            <g transform={`translate(0 ${groundY(d)}) scale(${scaleAt(d) * 0.95} ${scaleAt(d) * 0.95})`}>
              <Soldier kit={hazeKit({ ...crew, weapon: k === 0 ? "none" : crew.weapon }, pal.haze, d)} pose="stand" />
            </g>
          ),
        }),
      );
    });
  } else if (tpl === "assault") {
    [0.46, 0.54, 0.66].forEach((d, r) =>
      placed.push(
        ...rank(left, pal.haze, {
          d, x0: -420 + r * 40, x1: 420, n: (left.count ?? 9) - r, pose: "charge", facing: 1, t, speed: 70, seed: `${seed}-A${r}`,
          flagAt: r === 1 ? 3 : undefined,
        }),
      ),
    );
    if (right) {
      for (let i = 0; i < 5; i++) {
        for (const f of fire.length ? fire : [0.6, 1.8, 2.9]) {
          flashes.push({ x: 660 + i * 70, y: groundY(0.34) - 150 - (i % 2) * 50, s: 0.4, at: f + i * 0.2, d: 0.34 });
        }
      }
    }
  }
  // aftermath: dropped equipment only (no bodies) — drawn below

  // --- render -----------------------------------------------------------------
  placed.sort((a, b) => a.d - b.d);
  const buildings = kit.environment.buildings ?? [];
  const buildingType = scene.building ?? (tpl === "assault" ? buildings[0] : buildings[1] ?? buildings[0]);
  const vegetation = kit.environment.vegetation ?? [];
  const terrain = kit.environment.terrain;

  return (
    <AbsoluteFill style={{ backgroundColor: pal.shadow, overflow: "hidden" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id={`${seed}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={pal.sky_top} />
            <stop offset="100%" stopColor={pal.sky_bottom} />
          </linearGradient>
          <linearGradient id={`${seed}-ground`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={pal.ground_far} />
            <stop offset="100%" stopColor={pal.ground_near} />
          </linearGradient>
          <radialGradient id={`${seed}-sun`} cx="30%" cy="35%" r="45%">
            <stop offset="0%" stopColor={pal.light} stopOpacity={0.75} />
            <stop offset="100%" stopColor={pal.light} stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${seed}-flash`}>
            <stop offset="0%" stopColor="#fff6d6" />
            <stop offset="25%" stopColor="#ffc35a" />
            <stop offset="60%" stopColor="#ff7a2a" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#ff7a2a" stopOpacity={0} />
          </radialGradient>
          <radialGradient id={`${seed}-puff`}>
            <stop offset="0%" stopColor={pal.smoke} stopOpacity={0.9} />
            <stop offset="55%" stopColor={pal.smoke} stopOpacity={0.45} />
            <stop offset="100%" stopColor={pal.smoke} stopOpacity={0} />
          </radialGradient>
        </defs>
        <g transform={`translate(${W / 2} ${H / 2}) scale(${zoom}) translate(${-W / 2} ${-H / 2})`}>
          <rect x={-200} y={-200} width={W + 400} height={HORIZON + 260} fill={`url(#${seed}-sky)`} />
          <rect x={-200} y={-200} width={W + 400} height={HORIZON + 260} fill={`url(#${seed}-sun)`} />
          {/* cloud banks */}
          {[0, 1, 2, 3, 4].map((i) => (
            <ellipse
              key={i}
              cx={((random(`${seed}-cl${i}`) * 1600 + t * 6 - camX * 0.05) % 1600) - 260}
              cy={160 + random(`${seed}-cy${i}`) * 420}
              rx={260 + random(`${seed}-cr${i}`) * 220}
              ry={60 + random(`${seed}-ch${i}`) * 50}
              fill={mix(pal.sky_bottom, pal.sky_top, 0.25)}
              opacity={0.45}
            />
          ))}
          <g transform={`translate(${-camX * 0.04} 0)`}>
            <Ridge seed={`${seed}-r1`} base={HORIZON - 40} amp={terrain === "hills" ? 90 : 34} color={mix(pal.haze, pal.sky_top, 0.25)} shift={0} />
          </g>
          <g transform={`translate(${-camX * 0.08} 0)`}>
            <Ridge seed={`${seed}-r2`} base={HORIZON} amp={terrain === "plain" ? 8 : 22} color={mix(pal.ground_far, pal.haze, 0.45)} shift={300} />
          </g>
          <rect x={-200} y={HORIZON} width={W + 400} height={H - HORIZON + 200} fill={`url(#${seed}-ground)`} />
          <Vegetation kinds={vegetation} pal={pal} camX={camX} seed={seed} />
          {buildingType && tpl !== "cavalry-charge" ? (
            <g
              transform={`translate(${(tpl === "assault" ? 800 : 900) - camX * parallax(0.34)} ${groundY(tpl === "assault" ? 0.36 : 0.22)}) scale(${
                tpl === "assault" ? 1.35 : 0.55
              })`}
            >
              <Building type={buildingType} pal={pal} burning={tpl === "assault" || tpl === "aftermath"} t={T} />
            </g>
          ) : null}
          {terrain === "trenches" ? (
            <g>
              {[0.3, 0.62].map((d) => (
                <path
                  key={d}
                  d={`M -200 ${groundY(d)} ${Array.from({ length: 14 })
                    .map((_, i) => `L ${i * 100 - 150 - camX * parallax(d)} ${groundY(d) + (i % 2 ? 14 : -6) * scaleAt(d)}`)
                    .join(" ")}`}
                  stroke={pal.shadow}
                  strokeWidth={10 * scaleAt(d)}
                  fill="none"
                  opacity={0.8}
                />
              ))}
            </g>
          ) : null}
          <rect x={-200} y={HORIZON - 30} width={W + 400} height={groundY(0.4) - HORIZON + 30} fill={pal.haze} opacity={0.18} />
          {/* figures, far to near, each depth plane with its own parallax */}
          {placed.map((pl, i) => (
            <g key={i} transform={`translate(${pl.x - camX * parallax(pl.d)} 0)`}>
              <ellipse cx={0} cy={groundY(pl.d)} rx={16 * scaleAt(pl.d)} ry={3.5 * scaleAt(pl.d)} fill="#000" opacity={0.28} />
              {pl.node}
            </g>
          ))}
          {/* lingering powder-smoke bank along the firing line (volley / artillery) */}
          {(tpl === "volley" || tpl === "artillery" || tpl === "assault") && fire.length
            ? Array.from({ length: 9 }).map((_, i) => {
                const since = t - fire[0];
                if (since < 0.2) return null;
                const a = Math.min(1, since / 1.5) * 0.55;
                const d = tpl === "artillery" ? 0.55 : tpl === "assault" ? 0.36 : 0.56;
                const x = i * 150 - 100 + since * 14 - camX * parallax(d);
                const y = groundY(d) - (tpl === "assault" ? 260 : 120) * Math.min(1.4, scaleAt(d) / 1.6) - (i % 3) * 30;
                return (
                  <ellipse key={`sb${i}`} cx={x} cy={y - since * 6} rx={200 + (i % 4) * 40} ry={90 + (i % 3) * 25}
                    fill={`url(#${seed}-puff)`} opacity={a} />
                );
              })
            : null}
          {tpl === "aftermath" ? (
            <g>
              {Array.from({ length: 14 }).map((_, i) => {
                const d = 0.35 + random(`${seed}-af${i}`) * 0.55;
                const x = random(`${seed}-ax${i}`) * 1300 - 100 - camX * parallax(d);
                const s = scaleAt(d);
                const left0 = scene.left.faction;
                const gear = hazeKit(left0, pal.haze, d);
                const long = gear.weapon === "pike" || gear.weapon === "spear" || gear.weapon === "lance";
                return (
                  <g key={i} transform={`translate(${x} ${groundY(d)}) scale(${s}) rotate(${(random(`${seed}-ar${i}`) - 0.5) * 24})`}>
                    {i % 3 === 0 ? (
                      // dropped weapon lying in the grass
                      <path d={long ? "M-70,0 L70,-4 L70,-1 L-70,3 Z" : "M-34,0 L34,-3 L34,0 L-34,3 Z"} fill="#5a4026" />
                    ) : i % 3 === 1 ? (
                      // dropped headgear of the period, on its side
                      <g transform="translate(0 6) rotate(-75)">
                        <g transform="translate(0 100)">
                          <Headgear type={gear.headgear} color={gear.headgear_color ?? "#1a1714"} plume={gear.plume} />
                        </g>
                      </g>
                    ) : kit.artillery.type !== "none" ? (
                      // broken gun-carriage wheel
                      <g>
                        <circle cx={0} cy={-14} r={14} fill="none" stroke="#4e4636" strokeWidth={3} />
                        <line x1={-14} y1={-14} x2={14} y2={-14} stroke="#4e4636" strokeWidth={2} />
                        <line x1={0} y1={-28} x2={0} y2={0} stroke="#4e4636" strokeWidth={2} />
                      </g>
                    ) : (
                      <ellipse cx={0} cy={-4} rx={16} ry={5} fill={gear.shield_color ?? "#5a4026"} />
                    )}
                  </g>
                );
              })}
            </g>
          ) : null}
          {/* muzzle flashes + the smoke they leave */}
          {flashes.map((f, i) => {
            const dt = T - (scene.start + f.at);
            if (dt < 0 || dt > 5) return null;
            const fl = dt < 0.05 ? dt / 0.05 : Math.exp(-(dt - 0.05) / 0.1);
            const puff = Math.min(1, dt / 0.3) * Math.exp(-dt / 2.6);
            const x = f.x - camX * parallax(f.d);
            const r = 60 * f.s * (0.6 + 1.6 * (1 - Math.exp(-dt / 1.1)));
            return (
              <g key={i}>
                <ellipse cx={x + dt * 22} cy={f.y - dt * 16} rx={r * 1.4} ry={r} fill={`url(#${seed}-puff)`} opacity={puff * 0.85} />
                {fl > 0.02 ? <circle cx={x} cy={f.y} r={42 * f.s} fill={`url(#${seed}-flash)`} opacity={fl} /> : null}
              </g>
            );
          })}
          {/* low ground mist + foreground grass band */}
          <rect x={-200} y={groundY(0.5)} width={W + 400} height={120} fill={pal.haze} opacity={0.12} />
          <rect x={-200} y={groundY(0.95)} width={W + 400} height={400} fill={pal.shadow} opacity={0.35} />
        </g>
      </svg>
      {/* warm/cool grade */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(200deg, ${pal.light}22 0%, rgba(0,0,0,0) 45%, ${pal.shadow}66 100%)`,
          mixBlendMode: "multiply",
        }}
      />
    </AbsoluteFill>
  );
};
