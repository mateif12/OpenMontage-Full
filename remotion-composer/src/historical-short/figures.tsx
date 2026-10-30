import React from "react";

// Parametric period figures for code-drawn battle illustrations
// (BattleSceneView). Side view, facing +x, feet at (0, 0), height ≈ 100 units.
// Everything comes from a period kit faction (styles/periods/*.yaml): coat
// cut and colours, headgear, belts, weapon, shield, horse. Figures are generic
// — the scene label always says so — but period-correct in silhouette: a
// Napoleonic grenadier gets a bearskin and a flintlock with bayonet, a Roman
// legionary a crested helmet, scutum and spear, a 1916 soldier a steel helmet
// and a bolt-action rifle.

export interface FactionKit {
  label?: string;
  role?: "infantry" | "cavalry" | "archer" | "pike" | "crew";
  coat: string;
  facings?: string;
  trousers?: string;
  coat_style?: "tails" | "tunic" | "long" | "breastplate" | "greatcoat" | "jacket";
  headgear?: string;
  headgear_color?: string;
  plume?: string;
  belts?: "cross" | "single" | "none";
  weapon?: "musket" | "rifle" | "pike" | "spear" | "sword" | "sabre" | "lance" | "bow" | "none";
  shield?: "none" | "round" | "scutum" | "kite" | "aspis";
  shield_color?: string;
  horse?: string;
  flag?: string[];
  flag_orientation?: "vertical" | "horizontal" | "union";
}

export type Pose = "march" | "aim" | "charge" | "stand" | "fight" | "fallen-gear";

const SKIN = "#c99a78";
const DARK = "#1a1714";
const STEEL = "#9fa3a8";
const WOOD = "#5a4026";

export const Headgear: React.FC<{ type?: string; color: string; plume?: string }> = ({ type, color, plume }) => {
  const p = plume || undefined;
  switch (type) {
    case "shako":
      return (
        <g>
          <path d="M-7.5,-93 L-8.5,-108 L8.5,-109 L7.5,-93 Z" fill={color} />
          <rect x={-8.5} y={-109} width={17} height={2.4} fill="#e8dfc8" opacity={0.5} />
          <path d="M2,-94 L13,-92 L12,-90 L2,-91.5 Z" fill={DARK} />
          {p ? <ellipse cx={0} cy={-113} rx={2.6} ry={4.5} fill={p} /> : null}
        </g>
      );
    case "bearskin":
      return (
        <g>
          <path d="M-9,-92 C-12,-110 -7,-124 1,-124 C9,-124 12,-110 9,-92 Z" fill={color} />
          {p ? <path d="M-9,-104 l-3,-9 l3,1 Z" fill={p} /> : null}
        </g>
      );
    case "bicorne":
      return <path d="M-14,-95 C-8,-110 8,-110 14,-95 C6,-99 -6,-99 -14,-95 Z" fill={color} />;
    case "tricorne":
      return <path d="M-12,-94 L-3,-105 L6,-104 L12,-95 L2,-97 Z" fill={color} />;
    case "mitre":
      return <path d="M-7,-93 L-2,-118 L7,-93 Z" fill={color} />;
    case "dragoon-helmet":
      return (
        <g>
          <path d="M-8,-92 C-9,-104 8,-106 8,-92 Z" fill={color} />
          <path d="M-9,-101 C-2,-114 10,-110 12,-96" stroke={p ?? DARK} strokeWidth={3.2} fill="none" />
          <path d="M-12,-95 C-14,-80 -10,-74 -6,-72" stroke={DARK} strokeWidth={3} fill="none" />
        </g>
      );
    case "kepi":
      return (
        <g>
          <path d="M-7,-93 L-8,-103 L7,-101 L7,-93 Z" fill={color} />
          <path d="M3,-94 L12,-93 L11,-91 L3,-92 Z" fill={DARK} />
        </g>
      );
    case "pickelhaube":
      return (
        <g>
          <path d="M-8,-92 C-8,-104 8,-104 8,-92 Z" fill={color} />
          <path d="M-1,-103 L0,-111 L1,-103 Z" fill="#c9a24a" />
          <path d="M3,-93 L11,-92 L10,-90 L3,-91 Z" fill={DARK} />
        </g>
      );
    case "galea":
    case "montefortino":
      return (
        <g>
          <path d="M-8,-90 C-9,-104 8,-104 8,-90 Z" fill={color} />
          <path d="M-9,-90 L-10,-84 L-6,-84 Z" fill={color} />
          {type === "galea" ? (
            <path d="M-9,-100 C-4,-112 6,-112 9,-100" stroke={p ?? "#8e1f18"} strokeWidth={4} fill="none" />
          ) : (
            <rect x={-1} y={-108} width={2} height={5} fill={color} />
          )}
        </g>
      );
    case "corinthian":
      return (
        <g>
          <path d="M-8,-80 L-9,-98 C-6,-106 6,-106 8,-98 L8,-88 L3,-88 L3,-82 Z" fill={color} />
          <path d="M-10,-101 C-3,-115 8,-113 10,-101" stroke={p ?? "#8e1f18"} strokeWidth={5} fill="none" />
        </g>
      );
    case "nasal-helmet":
      return (
        <g>
          <path d="M-8,-91 L0,-108 L8,-91 Z" fill={color} />
          <rect x={4} y={-92} width={2} height={8} fill={color} />
        </g>
      );
    case "great-helm":
      return (
        <g>
          <path d="M-8,-80 L-8,-102 L8,-102 L9,-80 Z" fill={color} />
          <rect x={2} y={-93} width={7} height={1.6} fill={DARK} />
          {p ? <path d="M-6,-102 C-2,-112 4,-112 6,-102 Z" fill={p} /> : null}
        </g>
      );
    case "kettle-hat":
      return (
        <g>
          <path d="M-7,-94 C-7,-106 7,-106 7,-94 Z" fill={color} />
          <ellipse cx={0} cy={-94} rx={14} ry={2.6} fill={color} />
        </g>
      );
    case "morion":
      return (
        <g>
          <path d="M-7,-94 C-7,-106 7,-106 7,-94 Z" fill={color} />
          <path d="M-15,-90 C-10,-96 10,-96 15,-90 C8,-94 -8,-94 -15,-90 Z" fill={color} />
          <path d="M-6,-100 C-2,-110 2,-110 6,-100" stroke={color} strokeWidth={2.5} fill="none" />
          {p ? <path d="M-6,-104 l-5,-6 l2,7 Z" fill={p} /> : null}
        </g>
      );
    case "wide-brim":
      return (
        <g>
          <path d="M-6,-94 L-5,-106 L6,-106 L7,-94 Z" fill={color} />
          <ellipse cx={0} cy={-94} rx={16} ry={3} fill={color} />
          {p ? <path d="M-5,-105 C-14,-112 -16,-104 -12,-100" stroke={p} strokeWidth={3} fill="none" /> : null}
        </g>
      );
    case "bork":
      return <path d="M-7,-93 L-6,-116 C-12,-114 -16,-104 -14,-92 Z M-7,-93 L7,-93 L6,-104 L-6,-116 Z" fill={color} />;
    case "brodie":
      return (
        <g>
          <ellipse cx={0} cy={-95} rx={14} ry={2.4} fill={color} />
          <path d="M-7,-95 C-7,-104 7,-104 7,-95 Z" fill={color} />
        </g>
      );
    case "adrian":
      return (
        <g>
          <path d="M-8,-93 C-8,-105 8,-105 8,-93 Z" fill={color} />
          <path d="M-11,-93 L11,-93 L10,-91 L-10,-91 Z" fill={color} />
          <path d="M-2,-104 L0,-106 L2,-104 Z" fill={color} />
        </g>
      );
    case "stahlhelm":
      return <path d="M-9,-86 L-9,-95 C-9,-106 9,-106 9,-95 L9,-91 L12,-89 L10,-87 L5,-88 Z" fill={color} />;
    case "m1":
    case "ssh40":
      return <path d="M-9,-90 C-10,-106 10,-106 9,-90 Z" fill={color} />;
    default:
      return null;
  }
};

const Weapon: React.FC<{ kit: FactionKit; pose: Pose; recoil: number }> = ({ kit, pose, recoil }) => {
  const w = kit.weapon ?? "none";
  if (w === "none") return null;
  const level = pose === "aim" || pose === "charge";
  if (w === "musket" || w === "rifle") {
    const len = w === "musket" ? 64 : 56;
    const bay = w === "musket" || pose === "charge" ? 14 : 0;
    if (level) {
      const y = pose === "aim" ? -80 : -64;
      const x0 = pose === "aim" ? -6 - recoil * 4 : -10;
      return (
        <g>
          <path d={`M${x0},${y + 2} L${x0 + 14},${y + 1} L${x0 + len},${y - 1} L${x0 + len},${y + 1} L${x0 + 14},${y + 4} Z`} fill={WOOD} />
          <line x1={x0 + 12} y1={y} x2={x0 + len} y2={y - 1} stroke={DARK} strokeWidth={1.6} />
          {bay ? <line x1={x0 + len} y1={y - 1} x2={x0 + len + bay} y2={y - 1.5} stroke={STEEL} strokeWidth={1.1} /> : null}
        </g>
      );
    }
    // shouldered / sloped
    return (
      <g transform="rotate(-62 -2 -70)">
        <path d={`M-12,-70 L${len - 12},-72 L${len - 12},-70 L-12,-66 Z`} fill={WOOD} />
        <line x1={-2} y1={-71} x2={len - 12} y2={-71.5} stroke={DARK} strokeWidth={1.4} />
        {bay ? <line x1={len - 12} y1={-71.5} x2={len - 12 + bay} y2={-72} stroke={STEEL} strokeWidth={1} /> : null}
      </g>
    );
  }
  if (w === "pike") {
    return level ? (
      <line x1={-40} y1={-70} x2={150} y2={-80} stroke={WOOD} strokeWidth={2} />
    ) : (
      <line x1={4} y1={0} x2={10} y2={-190} stroke={WOOD} strokeWidth={2} />
    );
  }
  if (w === "spear" || w === "lance") {
    const L = w === "lance" ? 130 : 95;
    return level ? (
      <g>
        <line x1={-24} y1={-72} x2={L - 24} y2={-76} stroke={WOOD} strokeWidth={2.2} />
        <path d={`M${L - 26},-78 L${L - 14},-76 L${L - 26},-73.5 Z`} fill={STEEL} />
      </g>
    ) : (
      <g>
        <line x1={9} y1={2} x2={11} y2={-L + 4} stroke={WOOD} strokeWidth={2.2} />
        <path d={`M8.5,${-L + 6} L11,${-L - 8} L13.5,${-L + 6} Z`} fill={STEEL} />
      </g>
    );
  }
  if (w === "sword" || w === "sabre") {
    const raised = pose === "fight" || pose === "charge";
    return raised ? (
      <path d="M8,-80 C14,-96 18,-108 20,-118" stroke={STEEL} strokeWidth={2} fill="none" />
    ) : (
      <line x1={-2} y1={-48} x2={-10} y2={-20} stroke={STEEL} strokeWidth={2} />
    );
  }
  if (w === "bow") {
    return pose === "aim" ? (
      <g>
        <path d="M18,-108 C30,-88 30,-68 18,-48" stroke={WOOD} strokeWidth={2.2} fill="none" />
        <line x1={18} y1={-108} x2={-2} y2={-78} stroke="#d8d0bc" strokeWidth={0.7} />
        <line x1={18} y1={-48} x2={-2} y2={-78} stroke="#d8d0bc" strokeWidth={0.7} />
        <line x1={-2} y1={-78} x2={30} y2={-78} stroke={WOOD} strokeWidth={1} />
      </g>
    ) : (
      <path d="M-6,-100 C4,-82 4,-60 -6,-42" stroke={WOOD} strokeWidth={2.2} fill="none" />
    );
  }
  return null;
};

const Shield: React.FC<{ kit: FactionKit }> = ({ kit }) => {
  const c = kit.shield_color ?? "#8e2a1f";
  switch (kit.shield) {
    case "round":
    case "aspis":
      return (
        <g>
          <circle cx={9} cy={-66} r={kit.shield === "aspis" ? 19 : 16} fill={c} stroke={DARK} strokeWidth={1.2} />
          <circle cx={9} cy={-66} r={4} fill="#d8c9a0" opacity={0.5} />
        </g>
      );
    case "scutum":
      return <rect x={4} y={-86} width={13} height={44} rx={4} fill={c} stroke="#c9a24a" strokeWidth={1.4} />;
    case "kite":
      return <path d="M2,-86 C14,-88 18,-84 18,-78 C18,-62 12,-48 9,-40 C4,-50 1,-64 2,-86 Z" fill={c} stroke={DARK} strokeWidth={1} />;
    default:
      return null;
  }
};

// One foot soldier. phase: 0..1 walk cycle; recoil: 0..1 after firing.
export const Soldier: React.FC<{ kit: FactionKit; pose: Pose; phase?: number; recoil?: number }> = ({
  kit,
  pose,
  phase = 0,
  recoil = 0,
}) => {
  const swing = pose === "march" || pose === "charge" ? Math.sin(phase * Math.PI * 2) * (pose === "charge" ? 26 : 16) : 0;
  const lean = pose === "charge" ? 12 : pose === "aim" ? 4 : 0;
  const coat = kit.coat;
  const face = kit.facings ?? coat;
  const legs = kit.trousers ?? coat;
  const style = kit.coat_style ?? "jacket";
  const hem = style === "tails" ? -40 : style === "tunic" ? -36 : style === "long" ? -28 : style === "greatcoat" ? -22 : -44;
  const aimLeg = pose === "aim" ? 14 : 0;
  return (
    <g transform={`rotate(${lean} 0 -40)`}>
      {/* legs */}
      <g transform={`rotate(${-swing - aimLeg} 0 -46)`}>
        <rect x={-4} y={-46} width={8} height={44} fill={legs} />
        <rect x={-4.2} y={-16} width={8.4} height={15} fill={DARK} />
      </g>
      <g transform={`rotate(${swing + aimLeg * 0.4} 0 -46)`}>
        <rect x={-4} y={-46} width={8} height={44} fill={legs} />
        <rect x={-4.2} y={-16} width={8.4} height={15} fill={DARK} />
        <path d="M-4,-2 L8,-2 L8,1 L-4,1 Z" fill={DARK} />
      </g>
      {/* coat */}
      {style === "tails" ? <path d="M-11,-48 L-16,-34 L-10,-33 L-4,-46 Z" fill={coat} /> : null}
      <path d={`M-10,-80 L10,-80 L11,${hem} L-11,${hem} Z`} fill={coat} />
      {/* form shading: light from the upper left, shadow side and lower body */}
      <path d={`M2,-80 L10,-80 L11,${hem} L3,${hem} Z`} fill="#000" opacity={0.18} />
      {style === "breastplate" ? <path d="M-9,-79 L9,-79 L10,-54 C3,-50 -3,-50 -10,-54 Z" fill={STEEL} /> : null}
      {style === "long" && kit.facings ? <rect x={-10.5} y={-60} width={21} height={3} fill={face} /> : null}
      <rect x={-10} y={-81} width={20} height={4} fill={face} />
      {kit.belts === "cross" ? (
        <g stroke="#ece6d6" strokeWidth={2.6}>
          <line x1={-9} y1={-79} x2={9} y2={-50} />
          <line x1={9} y1={-79} x2={-9} y2={-50} />
        </g>
      ) : kit.belts === "single" ? (
        <line x1={-9} y1={-79} x2={9} y2={-50} stroke="#4a3a28" strokeWidth={2.4} />
      ) : null}
      {/* back arm */}
      <line x1={-4} y1={-76} x2={pose === "aim" ? 14 : -6} y2={pose === "aim" ? -78 : -52} stroke={coat} strokeWidth={6} strokeLinecap="round" />
      {/* head */}
      <rect x={-3} y={-86} width={6} height={6} fill={SKIN} />
      <circle cx={1} cy={-90} r={7} fill={SKIN} />
      <Headgear type={kit.headgear} color={kit.headgear_color ?? DARK} plume={kit.plume} />
      <Weapon kit={kit} pose={pose} recoil={recoil} />
      <Shield kit={kit} />
      {/* front arm */}
      <line
        x1={2}
        y1={-76}
        x2={pose === "aim" ? 22 : pose === "charge" ? 18 : pose === "fight" ? 9 : 6}
        y2={pose === "aim" ? -79 : pose === "charge" ? -66 : pose === "fight" ? -82 : -56}
        stroke={coat}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </g>
  );
};

// Horse + rider. phase drives a gallop cycle.
export const Cavalryman: React.FC<{ kit: FactionKit; phase: number; galloping: boolean }> = ({ kit, phase, galloping }) => {
  const horse = kit.horse ?? "#4a3322";
  const a = galloping ? phase * Math.PI * 2 : 0;
  const leg = (dx: number, off: number) => {
    const s = galloping ? Math.sin(a + off) * 28 : 0;
    return (
      <g transform={`rotate(${s} ${dx} -58)`}>
        <rect x={dx - 3} y={-58} width={6} height={40} fill={horse} />
        <rect x={dx - 3.3} y={-22} width={6.6} height={5} fill={DARK} />
      </g>
    );
  };
  const bob = galloping ? Math.sin(a * 2) * 3 : 0;
  return (
    <g transform={`translate(0 ${bob})`}>
      {leg(-30, 0)}
      {leg(-22, 0.8)}
      {leg(26, 2.6)}
      {leg(34, 3.4)}
      <path d="M-42,-72 C-46,-60 -50,-54 -56,-48" stroke={horse} strokeWidth={6} fill="none" strokeLinecap="round" />
      <ellipse cx={0} cy={-70} rx={40} ry={17} fill={horse} />
      <path d="M28,-80 L46,-108 L58,-104 L44,-74 Z" fill={horse} />
      <path d="M46,-108 L70,-98 L68,-90 L50,-94 Z" fill={horse} />
      <path d="M40,-108 L46,-116 L48,-106 Z" fill={horse} />
      <path d="M30,-86 C38,-100 42,-106 46,-110" stroke={DARK} strokeWidth={3} fill="none" opacity={0.6} />
      {/* rider (seated): reuse the soldier with legs hidden by the saddle cloth */}
      <g transform="translate(-4 -38) scale(0.92)">
        <Soldier kit={{ ...kit, trousers: kit.trousers ?? kit.coat }} pose={galloping ? "charge" : "stand"} />
      </g>
      <path d="M-20,-86 L14,-86 L18,-62 L-22,-62 Z" fill={kit.facings ?? kit.coat} opacity={0.9} />
    </g>
  );
};

export const Cannon: React.FC<{ barrel: string; carriage: string; recoil: number; modern?: boolean }> = ({
  barrel,
  carriage,
  recoil,
  modern,
}) => (
  <g transform={`translate(${-recoil * 14} 0)`}>
    <path d="M-60,-6 L-6,-26 L0,-20 L-56,0 Z" fill={carriage} />
    <circle cx={-4} cy={-18} r={18} fill="none" stroke={carriage} strokeWidth={4} />
    {Array.from({ length: 6 }).map((_, i) => (
      <line
        key={i}
        x1={-4}
        y1={-18}
        x2={-4 + 18 * Math.cos((i * Math.PI) / 3)}
        y2={-18 + 18 * Math.sin((i * Math.PI) / 3)}
        stroke={carriage}
        strokeWidth={2}
      />
    ))}
    {modern ? (
      <g>
        <rect x={-14} y={-48} width={22} height={24} fill={carriage} />
        <path d="M-8,-36 L70,-44 L70,-38 L-8,-30 Z" fill={barrel} />
      </g>
    ) : (
      <path d="M-24,-30 L40,-38 L40,-32 L-24,-22 C-30,-22 -30,-30 -24,-30 Z" fill={barrel} />
    )}
  </g>
);

export const Flag: React.FC<{ colors: string[]; orientation?: string; wave: number }> = ({ colors, orientation, wave }) => {
  const w = 34;
  const h = 24;
  const d = (y: number) => `M0,${y} C${w * 0.3},${y - 3 + wave * 3} ${w * 0.6},${y + 3 - wave * 3} ${w},${y}`;
  if (orientation === "vertical") {
    const sw = w / colors.length;
    return (
      <g>
        {colors.map((c, i) => (
          <path
            key={i}
            d={`M${i * sw},${-h + wave * (i % 2 ? 1.5 : -1.5)} L${(i + 1) * sw},${-h + wave * (i % 2 ? -1.5 : 1.5)} L${(i + 1) * sw},0 L${i * sw},0 Z`}
            fill={c}
          />
        ))}
      </g>
    );
  }
  if (orientation === "union") {
    // simplified saltire + cross on blue — generic, small at screen size
    return (
      <g>
        <path d={`${d(-h)} L${w},0 L0,0 Z`} fill={colors[0] ?? "#1f3a7a"} />
        <line x1={0} y1={-h} x2={w} y2={0} stroke={colors[1] ?? "#fff"} strokeWidth={3} />
        <line x1={w} y1={-h} x2={0} y2={0} stroke={colors[1] ?? "#fff"} strokeWidth={3} />
        <rect x={w / 2 - 3} y={-h} width={6} height={h} fill={colors[2] ?? "#b3261e"} />
        <rect x={0} y={-h / 2 - 3} width={w} height={6} fill={colors[2] ?? "#b3261e"} />
      </g>
    );
  }
  const sh = h / colors.length;
  return (
    <g>
      {colors.map((c, i) => (
        <rect key={i} x={0} y={-h + i * sh + wave * (i % 2 ? 1 : -1)} width={w} height={sh + 0.5} fill={c} />
      ))}
    </g>
  );
};
