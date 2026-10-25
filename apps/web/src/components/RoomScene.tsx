import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { MemoryObject } from '../types';
import './RoomScene.css';

type Category =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'office'
  | 'entryway'
  | 'dining'
  | 'studio'
  | 'custom';
type Fixture =
  | 'sofa'
  | 'table'
  | 'bed'
  | 'counter'
  | 'stove'
  | 'fridge'
  | 'bath'
  | 'sink'
  | 'desk'
  | 'shelf'
  | 'door'
  | 'rack'
  | 'chair'
  | 'easel'
  | 'plant';
type Furnishing = { kind: Fixture; x: number; y: number; scale?: number };
const piece = (kind: Fixture, x: number, y: number, scale = 1): Furnishing => ({
  kind,
  x,
  y,
  scale,
});
const THEMES: Record<
  Category,
  { emoji: string; color: string; floor: string; fixtures: Furnishing[] }
> = {
  living: {
    emoji: '🛋️',
    color: '#8eaf88',
    floor: '#647a63',
    fixtures: [
      piece('shelf', 570, 210, 0.8),
      piece('sofa', 300, 245),
      piece('plant', 185, 238),
      piece('table', 345, 325, 0.8),
    ],
  },
  kitchen: {
    emoji: '🍳',
    color: '#e2c491',
    floor: '#9c8867',
    fixtures: [
      piece('fridge', 570, 205),
      piece('counter', 230, 220),
      piece('stove', 380, 235),
      piece('table', 365, 320, 0.8),
    ],
  },
  bedroom: {
    emoji: '🛏️',
    color: '#b9a9d4',
    floor: '#776c8b',
    fixtures: [
      piece('shelf', 200, 240, 0.7),
      piece('bed', 355, 280),
      piece('table', 555, 255, 0.5),
      piece('plant', 565, 250, 0.7),
    ],
  },
  bathroom: {
    emoji: '🛁',
    color: '#9eced2',
    floor: '#688e94',
    fixtures: [
      piece('shelf', 210, 225, 0.65),
      piece('sink', 540, 230),
      piece('bath', 330, 310),
      piece('plant', 615, 255, 0.7),
    ],
  },
  office: {
    emoji: '💼',
    color: '#9ab7d0',
    floor: '#667f99',
    fixtures: [
      piece('shelf', 565, 200),
      piece('desk', 300, 250),
      piece('chair', 365, 325),
      piece('plant', 185, 235),
    ],
  },
  entryway: {
    emoji: '🚪',
    color: '#d7ad8b',
    floor: '#95795f',
    fixtures: [
      piece('door', 365, 190),
      piece('rack', 550, 255),
      piece('shelf', 235, 295, 0.65),
      piece('plant', 185, 230),
    ],
  },
  dining: {
    emoji: '🍽️',
    color: '#d6bc86',
    floor: '#958061',
    fixtures: [
      piece('chair', 345, 220),
      piece('chair', 485, 260),
      piece('table', 340, 290, 1.3),
      piece('chair', 270, 310),
      piece('chair', 415, 355),
      piece('plant', 580, 220),
    ],
  },
  studio: {
    emoji: '🎨',
    color: '#d8a4b3',
    floor: '#916a79',
    fixtures: [
      piece('easel', 310, 230),
      piece('shelf', 575, 220, 0.8),
      piece('table', 420, 320),
      piece('chair', 300, 325),
      piece('plant', 190, 245, 0.8),
    ],
  },
  custom: {
    emoji: '🏠',
    color: '#a9c2b8',
    floor: '#6d8b80',
    fixtures: [piece('shelf', 540, 215), piece('table', 300, 300), piece('plant', 195, 240)],
  },
};

export function getRoomCategory(room: string): Category {
  const name = room.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(kitchen|pantry)\b/.test(name)) return 'kitchen';
  if (/\b(bathroom|bath|washroom|restroom|toilet)\b/.test(name)) return 'bathroom';
  if (/\b(bedroom|bed|guest room|nursery)\b/.test(name)) return 'bedroom';
  if (/\b(office|study|workspace)\b/.test(name)) return 'office';
  if (/\b(entryway|entry|foyer|hallway|hall)\b/.test(name)) return 'entryway';
  if (/\b(dining|dinner)\b/.test(name)) return 'dining';
  if (/\b(studio|art|craft|workshop)\b/.test(name)) return 'studio';
  if (/\b(living|lounge|family room|sitting room)\b/.test(name)) return 'living';
  return 'custom';
}
export function roomEmoji(room: string) {
  return THEMES[getRoomCategory(room)].emoji;
}
function nameHash(name: string) {
  return Array.from(name.toLowerCase()).reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
}

// Small SVG solids provide a consistent isometric illustration without a WebGL dependency.
function Solid({
  x = 0,
  y = 0,
  width = 100,
  depth = 40,
  height = 40,
  color = 'var(--room-accent)',
}: {
  x?: number;
  y?: number;
  width?: number;
  depth?: number;
  height?: number;
  color?: string;
}) {
  const a = [x, y - height],
    b = [x + width, y + width * 0.32 - height];
  const c = [x + width - depth, y + (width + depth) * 0.32 - height],
    d = [x - depth, y + depth * 0.32 - height];
  const point = (p: number[]) => p.join(',');
  const lower = (p: number[]) => point([p[0], p[1] + height]);
  return (
    <g stroke="#142620" strokeOpacity=".18" strokeWidth="1.5" strokeLinejoin="round">
      <polygon points={[point(d), point(c), lower(c), lower(d)].join(' ')} fill={color} />
      <polygon
        points={[point(b), point(c), lower(c), lower(b)].join(' ')}
        fill={color}
        style={{ filter: 'brightness(.76)' }}
      />
      <polygon
        points={[point(a), point(b), point(c), point(d)].join(' ')}
        fill={color}
        style={{ filter: 'brightness(1.15)' }}
      />
    </g>
  );
}
function Furniture({ kind, x, y, scale = 1 }: Furnishing) {
  let shape;
  switch (kind) {
    case 'sofa':
      shape = (
        <>
          <Solid width={180} depth={55} height={35} />
          <Solid y={-35} width={180} depth={12} height={42} />
          <Solid x={-40} y={15} width={20} depth={38} height={40} />
          <Solid x={150} y={75} width={20} depth={38} height={40} />
          {[8, 65, 122].map((x) => (
            <Solid
              key={x}
              x={x}
              y={x * 0.32 - 34}
              width={52}
              depth={38}
              height={8}
              color="#bfd0ac"
            />
          ))}
        </>
      );
      break;
    case 'table':
    case 'desk':
      shape = (
        <>
          {[
            [-32, 7],
            [93, 47],
            [0, -6],
          ].map(([x, y], i) => (
            <Solid key={i} x={x} y={y + 30} width={8} depth={8} height={58} color="#6d5b46" />
          ))}
          <Solid y={-26} width={135} depth={50} height={12} color="#bd9d72" />
          {kind === 'desk' && (
            <>
              <path d="M40 -46v-38l60 19v38Z" fill="#203a42" stroke="#adc5c7" strokeWidth="5" />
              <path d="M70 -33v18m-18 -4l35 11" stroke="#c6d5cf" strokeWidth="5" />
              <path d="m10 -26 35 11 -15 5 -35 -11Z" fill="#e1dfca" />
            </>
          )}
        </>
      );
      break;
    case 'chair':
      shape = (
        <>
          <Solid width={45} depth={35} height={40} color="#435c51" />
          <Solid y={-40} width={45} depth={8} height={40} />
        </>
      );
      break;
    case 'bed':
      shape = (
        <>
          <Solid width={135} depth={115} height={24} color="#634f62" />
          <Solid y={-24} width={135} depth={115} height={12} color="#e8e3d9" />
          <Solid y={-36} width={135} depth={12} height={50} />
          <Solid x={-15} y={-12} width={115} depth={65} height={7} />
          <Solid x={5} y={-34} width={48} depth={25} height={10} color="#f3efdf" />
          <Solid x={66} y={-15} width={48} depth={25} height={10} color="#f3efdf" />
        </>
      );
      break;
    case 'counter':
    case 'stove':
      shape = (
        <>
          <Solid width={125} depth={45} height={65} color="#718f80" />
          <Solid y={-65} width={130} depth={50} height={7} color="#e4d7bd" />
          {kind === 'stove' ? (
            <>
              <path d="m2 -39 70 22v35L2 -4Z" fill="#263a3a" stroke="#c8d5c7" strokeWidth="3" />
              {[
                [10, -69],
                [52, -56],
                [-5, -57],
                [37, -44],
              ].map(([cx, cy], i) => (
                <ellipse key={i} cx={cx} cy={cy} rx={10} ry={4} fill="#273c36" />
              ))}
            </>
          ) : (
            <path d="m0 -42 35 11m12 4 35 11m-45 -1v28" stroke="#d6e0cc" strokeWidth="3" />
          )}
        </>
      );
      break;
    case 'fridge':
      shape = (
        <>
          <Solid width={65} depth={40} height={115} color="#d3dfd9" />
          <path d="m-33 -48 55 17m-5 -29v25m0 20v28" stroke="#6b827b" strokeWidth="4" />
        </>
      );
      break;
    case 'bath':
      shape = (
        <>
          <Solid width={150} depth={75} height={45} color="#d5e7e4" />
          <ellipse
            cx={35}
            cy={-15}
            rx={75}
            ry={22}
            transform="rotate(18 35 -15)"
            fill="#8cbec6"
            stroke="#e8f3ea"
            strokeWidth="12"
          />
          <path d="M110 -3v-35q0-17-17-17" fill="none" stroke="#d4dcd5" strokeWidth="7" />
        </>
      );
      break;
    case 'sink':
      shape = (
        <>
          <Solid width={80} depth={45} height={65} color="#597b7a" />
          <Solid y={-65} width={85} depth={50} height={7} color="#e5ede4" />
          <ellipse cx={17} cy={-55} rx={22} ry={8} fill="#91b9b9" />
          <path d="M33 -68v-17q0-8-8-8" fill="none" stroke="#d1d9d7" strokeWidth="5" />
          <path d="m5 -93 65 20v-70l-65 -20Z" fill="#adcbd1" stroke="#e2e6d9" strokeWidth="5" />
        </>
      );
      break;
    case 'shelf':
      shape = (
        <>
          <Solid width={85} depth={28} height={100} color="#94775b" />
          <path d="m-24 -62 80 26m-80 6 80 26" stroke="#c7aa84" strokeWidth="5" />
          {[0, 15, 30, 45].map((x, i) => (
            <path
              key={x}
              d={`m${x - 18} ${-84 + x * 0.32} 9 3v22l-9 -3Z`}
              fill={['#bdcba5', '#cfa08d', '#8eacb8', '#d2bd7e'][i]}
            />
          ))}
        </>
      );
      break;
    case 'door':
      shape = (
        <>
          <path d="m0 0 90 29V-140L0 -169Z" fill="#9c8265" stroke="#d0bd95" strokeWidth="8" />
          <path d="m13 -11 63 20v-134l-63 -20Z" fill="#52685c" />
          <circle cx={65} cy={-48} r={4} fill="#e4d19c" />
        </>
      );
      break;
    case 'rack':
      shape = (
        <>
          <path
            d="M0 30v-120m0 15 65 21m0-15V50m-65-10 65 20"
            fill="none"
            stroke="#d6c19e"
            strokeWidth="7"
          />
          <path d="m15 -64 -10 20 10 4v50l32 11v-50l10 2 -10 -27Z" fill="#9ab6ac" />
        </>
      );
      break;
    case 'easel':
      shape = (
        <>
          <path
            d="m-12 40 35 -170L80 62M17 -85l57 129"
            stroke="#bf9a72"
            strokeWidth="7"
            fill="none"
          />
          <path d="m-15 -95 90 28v87l-90 -28Z" fill="#f0e2c5" stroke="#d0b88d" strokeWidth="6" />
          <path d="m0 -32 20 -31 22 45 21 -14v32Z" fill="#82a997" />
          <ellipse cx={45} cy={-39} rx={12} ry={14} fill="#d7a774" />
        </>
      );
      break;
    case 'plant':
      shape = (
        <>
          <Solid width={30} depth={25} height={30} color="#c3a582" />
          <path
            d="M0 -10v-80m0 42q-40 1-30-35 32 4 30 35m1-9q37-2 27-32-29 4-27 32m-1-23q-24-7-14-35 24 8 14 35"
            fill="#88ac83"
            stroke="#5b856b"
            strokeWidth="3"
          />
        </>
      );
      break;
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} data-furniture={kind}>
      {shape}
    </g>
  );
}

export default function RoomScene({
  room,
  objects,
  selectedObjectId,
  onSelect,
  onRoomSelect,
  variant = 'interactive',
}: {
  room: string;
  objects: MemoryObject[];
  selectedObjectId?: string | null;
  onSelect?: (object: MemoryObject) => void;
  onRoomSelect?: (room: string) => void;
  variant?: 'interactive' | 'overview' | 'detail';
}) {
  const caption = useId();
  if (room === 'All spaces') {
    const rooms = [...new Set(objects.map((object) => object.latest.room))].sort();
    return (
      <div className="household-room-scenes" aria-label="Household room illustrations">
        {rooms.length ? (
          rooms.map((name) => (
            <section className="household-room-tile" key={name}>
              <h3>
                <button type="button" onClick={() => onRoomSelect?.(name)}>
                  {roomEmoji(name)} {name}
                  <span>Explore room →</span>
                </button>
              </h3>
              <RoomScene
                room={name}
                objects={objects.filter((object) => object.latest.room === name)}
                selectedObjectId={selectedObjectId}
                onSelect={onSelect}
                variant="overview"
              />
            </section>
          ))
        ) : (
          <p className="room-empty">Scan a room to start your household view.</p>
        )}
      </div>
    );
  }
  const category = getRoomCategory(room);
  const theme = THEMES[category];
  const hash = nameHash(room);
  const customLayouts = [
    theme.fixtures,
    [piece('desk', 265, 260), piece('rack', 565, 235), piece('plant', 450, 325)],
    [piece('shelf', 210, 245), piece('table', 440, 305), piece('plant', 575, 200)],
  ];
  const fixtures =
    category === 'custom' ? customLayouts[hash % customLayouts.length] : theme.fixtures;
  const customColors = ['#a9c2b8', '#c4b594', '#a8b6d2', '#c2a6c6'];
  const style = {
    '--room-accent': category === 'custom' ? customColors[hash % customColors.length] : theme.color,
    '--room-floor': theme.floor,
  } as CSSProperties;
  const sorted = [...objects].sort((a, b) => a.id.localeCompare(b.id));
  const shown = sorted.slice(0, variant === 'overview' ? 2 : 4);
  const selected = sorted.find((object) => object.id === selectedObjectId);
  if (selected && !shown.some((object) => object.id === selected.id))
    shown[shown.length - 1] = selected;
  const slots =
    category === 'kitchen' || category === 'office'
      ? [
          [17, 24],
          [60, 31],
          [25, 64],
          [62, 65],
        ]
      : [
          [21, 23],
          [58, 35],
          [16, 65],
          [60, 67],
        ];
  return (
    <figure
      className={`category-room-scene category-room-${variant}`}
      style={style}
      data-room-category={category}
      data-room-name={room}
      aria-describedby={caption}
    >
      <div className="category-room-stage">
        <svg viewBox="0 0 800 420" role="img" aria-label={`${room} illustration`}>
          <path d="m100 245 300-95 300 95-300 110Z" fill="var(--room-floor)" opacity=".9" />
          <path d="M100 100 400 5v145l-300 95Z" fill="var(--room-accent)" opacity=".3" />
          <path d="m400 5 300 95v145l-300-95Z" fill="var(--room-accent)" opacity=".18" />
          <path
            d="M100 245 400 150 700 245M400 5v145m-300 95 300 110 300-110"
            fill="none"
            stroke="var(--room-accent)"
            strokeOpacity=".6"
            strokeWidth="2"
          />
          <path
            d="m180 270 300-95m-220 124 300-95m-220 124 300-95m-460-10 300 108m-220-132 300 108m-220-133 300 108"
            stroke="#dbe7d5"
            strokeOpacity=".1"
            fill="none"
          />
          {fixtures.map((fixture, index) => (
            <Furniture key={index} {...fixture} />
          ))}
        </svg>
        {shown.map((object, index) => {
          const content = (
            <>
              <span className="room-pin-dot" />
              <span>
                <strong>{object.label}</strong>
                <small>{object.latest.location}</small>
              </span>
            </>
          );
          const props = {
            className: `room-object-pin ${object.id === selectedObjectId ? 'selected' : ''}`,
            style: { left: `${slots[index][0]}%`, top: `${slots[index][1]}%` },
          };
          return onSelect ? (
            <button
              type="button"
              key={object.id}
              {...props}
              aria-pressed={object.id === selectedObjectId}
              aria-label={`Select ${object.label} in ${room}`}
              onClick={() => onSelect(object)}
            >
              {content}
            </button>
          ) : (
            <div key={object.id} {...props}>
              {content}
            </div>
          );
        })}
        {!objects.length && (
          <p className="room-empty-overlay">No objects remembered in this room yet.</p>
        )}
      </div>
      <figcaption id={caption}>
        <span>
          {roomEmoji(room)} {room}
        </span>
        <span>
          Illustrated layout · Pins are not measured positions
          {objects.length > shown.length
            ? ` · ${objects.length - shown.length} more items below`
            : ''}
        </span>
      </figcaption>
    </figure>
  );
}
