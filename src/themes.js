// Board styles. Each surface = { tex: procedural texture spec, mat: material properties }.
// pa / pb are the two alternating point inlays; white / black are the checkers (engine
// sides 0 / 1); line = inlaid border, metal = hinges, leaf = rail numbers.
import { woodTextures, marbleTextures } from './textures.js';

const W = (o) => ({ kind: 'wood', ...o });
const M = (o) => ({ kind: 'marble', ...o });

const WOOD = { roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.22, bumpScale: 0.6 };
const POLISH = { roughness: 0.13, clearcoat: 1, clearcoatRoughness: 0.05, bumpScale: 0.06 };
const CLASSIC_TABLE = { tex: W({ light: 0x43291a, dark: 0x25170d, rings: 14, seed: 7, streak: 0.55, warp: 0.5 }), mat: { roughness: 0.6, clearcoat: 0, bumpScale: 0.5 } };
const IVORY = { tex: W({ light: 0xfbf4e4, dark: 0xe0d0b0, rings: 3, seed: 61, streak: 0.25 }), mat: { bumpScale: 0.15, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: 0xfff4dc } };
const EBONY = { tex: W({ light: 0x4a2c1c, dark: 0x0e0704, rings: 5, seed: 71, streak: 0.4 }), mat: { bumpScale: 0.25, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.1 } };
const NERO = (seed) => M({ base: 0x141418, base2: 0x24242b, vein: 0xe4e2dc, seed, dir: [2, 1], turb: 1.5, sharp: 12, amt: 0.8, amt2: 0.4 });

export const THEMES = [
  {
    id: 'walnut', name: 'Classic walnut', kind: 'Wood', sub: 'Walnut frame, honey field, cherry and wenge points',
    frame: { tex: W({ light: 0x7c4a28, dark: 0x2e1609, rings: 9, seed: 5, streak: 0.45, figure: 0.25 }), mat: { ...WOOD, roughness: 0.38, clearcoat: 0.75 } },
    field: { tex: W({ light: 0xdcae70, dark: 0x9a6236, rings: 15, seed: 17, streak: 0.38, figure: 0.15, warp: 0.85 }), mat: { ...WOOD, bumpScale: 0.45, clearcoat: 0.55 } },
    pa: { tex: W({ light: 0x4b2f1d, dark: 0x170c06, rings: 8, seed: 29, streak: 0.5 }), mat: { ...WOOD, roughness: 0.4 } },
    pb: { tex: W({ light: 0xa2402a, dark: 0x4e140a, rings: 7, seed: 37, streak: 0.45 }), mat: { ...WOOD, roughness: 0.4 } },
    white: IVORY, black: EBONY, table: CLASSIC_TABLE,
    line: 0xf0dcb0, metal: { color: 0xc89b4a, roughness: 0.28 }, leaf: 0xe9c27a,
  },
  {
    id: 'olive', name: 'Olive & ebony', kind: 'Wood', sub: 'Greek olive-wood field, ebony frame, ebony and green points',
    frame: { tex: W({ light: 0x3a2618, dark: 0x0d0805, rings: 10, seed: 43, streak: 0.5 }), mat: { ...WOOD, roughness: 0.3, clearcoat: 0.85 } },
    field: { tex: W({ light: 0xe6cf95, dark: 0x6a4e24, rings: 7, seed: 47, streak: 0.28, figure: 0.4, warp: 1.6 }), mat: { ...WOOD, bumpScale: 0.5, clearcoat: 0.6 } },
    pa: { tex: W({ light: 0x2a1a10, dark: 0x070403, rings: 9, seed: 53, streak: 0.45 }), mat: { ...WOOD, roughness: 0.32 } },
    pb: { tex: W({ light: 0x4a7a50, dark: 0x163420, rings: 7, seed: 59, streak: 0.45 }), mat: { ...WOOD, roughness: 0.38 } },
    white: { tex: W({ light: 0xf6e8c2, dark: 0xd8bf88, rings: 4, seed: 67, streak: 0.3 }), mat: { bumpScale: 0.2, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 } },
    black: EBONY, table: CLASSIC_TABLE,
    line: 0xe8d9b0, metal: { color: 0xa88443, roughness: 0.38 }, leaf: 0xe9c27a,
  },
  {
    id: 'mahogany', name: 'Mahogany & maple', kind: 'Wood', sub: 'High-gloss mahogany frame, curly maple field, rosewood and ebony points',
    frame: { tex: W({ light: 0x93402a, dark: 0x3d120a, rings: 8, seed: 73, streak: 0.4, figure: 0.3 }), mat: { ...WOOD, roughness: 0.26, clearcoat: 0.95, clearcoatRoughness: 0.08 } },
    field: { tex: W({ light: 0xf2dfb8, dark: 0xc9a674, rings: 12, seed: 79, streak: 0.3, figure: 0.35, warp: 0.7 }), mat: { ...WOOD, bumpScale: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12 } },
    pa: { tex: W({ light: 0x7e2a1c, dark: 0x2c0906, rings: 8, seed: 83, streak: 0.45 }), mat: { ...WOOD, roughness: 0.32, clearcoat: 0.8 } },
    pb: { tex: W({ light: 0x2c1e16, dark: 0x080504, rings: 9, seed: 89, streak: 0.45 }), mat: { ...WOOD, roughness: 0.32, clearcoat: 0.8 } },
    white: { tex: W({ light: 0xf8ecd2, dark: 0xe0c9a0, rings: 3, seed: 97, streak: 0.25 }), mat: { bumpScale: 0.15, roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.1 } },
    black: { tex: W({ light: 0x5a2418, dark: 0x1a0805, rings: 5, seed: 103, streak: 0.4 }), mat: { bumpScale: 0.25, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.08 } },
    table: CLASSIC_TABLE,
    line: 0xf3e6c8, metal: { color: 0xcfcfd2, roughness: 0.22 }, leaf: 0xe9c27a,
  },
  {
    id: 'burl', name: 'Burl walnut', kind: 'Wood', sub: 'Swirling burl-walnut field, gloss walnut frame, holly and ebony points',
    frame: { tex: W({ light: 0x5c3820, dark: 0x1e1008, rings: 9, seed: 181, streak: 0.45, figure: 0.25 }), mat: { ...WOOD, roughness: 0.24, clearcoat: 0.95, clearcoatRoughness: 0.06 } },
    field: { tex: W({ light: 0xc08a56, dark: 0x4a2a14, rings: 9, seed: 191, streak: 0.2, burl: true }), mat: { ...WOOD, bumpScale: 0.3, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08 } },
    pa: { tex: W({ light: 0xf4ecd8, dark: 0xd8c8a6, rings: 4, seed: 193, streak: 0.3 }), mat: { ...WOOD, roughness: 0.3, clearcoat: 0.85 } },
    pb: { tex: W({ light: 0x2a1c14, dark: 0x060403, rings: 9, seed: 197, streak: 0.45 }), mat: { ...WOOD, roughness: 0.3, clearcoat: 0.85 } },
    white: IVORY, black: EBONY, table: CLASSIC_TABLE,
    line: 0xe8d6a8, metal: { color: 0xd9b45a, roughness: 0.2 }, leaf: 0xe9c27a,
  },
  {
    id: 'zebrano', name: 'Zebrano & wenge', kind: 'Wood', sub: 'Bold striped zebrano field, wenge frame, wenge and maple points',
    frame: { tex: W({ light: 0x4a3626, dark: 0x140c07, rings: 14, seed: 199, streak: 0.55 }), mat: { ...WOOD, roughness: 0.4, clearcoat: 0.55 } },
    field: { tex: W({ light: 0xead2a0, dark: 0x4e3218, rings: 22, seed: 211, streak: 0.12, figure: 0.08, warp: 0.35 }), mat: { ...WOOD, bumpScale: 0.5, roughness: 0.4, clearcoat: 0.55 } },
    pa: { tex: W({ light: 0x3c2a1c, dark: 0x0f0905, rings: 12, seed: 223, streak: 0.55 }), mat: { ...WOOD, roughness: 0.4 } },
    pb: { tex: W({ light: 0xf3e3c0, dark: 0xd1b98c, rings: 6, seed: 227, streak: 0.3 }), mat: { ...WOOD, roughness: 0.4 } },
    white: { tex: W({ light: 0xf6e9cc, dark: 0xdcc59a, rings: 4, seed: 229, streak: 0.3 }), mat: { bumpScale: 0.2, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.18 } },
    black: { tex: W({ light: 0x3c2a1c, dark: 0x0c0704, rings: 8, seed: 233, streak: 0.5 }), mat: { bumpScale: 0.3, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.15 } },
    table: CLASSIC_TABLE,
    line: 0xf1e2bf, metal: { color: 0x8c8c90, roughness: 0.35 }, leaf: 0xe9c27a,
  },
  {
    id: 'aegean', name: 'Aegean oak', kind: 'Wood', sub: 'Pale white-oak field, smoked-oak frame, sea-blue and sea-grey points',
    frame: { tex: W({ light: 0x5e4834, dark: 0x251a11, rings: 11, seed: 239, streak: 0.5, figure: 0.15 }), mat: { ...WOOD, roughness: 0.48, clearcoat: 0.35 } },
    field: { tex: W({ light: 0xebdfc4, dark: 0xb9a07a, rings: 13, seed: 241, streak: 0.45, figure: 0.12, warp: 0.8 }), mat: { ...WOOD, bumpScale: 0.6, roughness: 0.5, clearcoat: 0.3 } },
    pa: { tex: W({ light: 0x355a86, dark: 0x0f2340, rings: 9, seed: 251, streak: 0.5 }), mat: { ...WOOD, roughness: 0.45, clearcoat: 0.4 } },
    // sea-grey wash rather than white, so the white checkers still read against these points
    pb: { tex: W({ light: 0xc9d3d8, dark: 0x8e9ca6, rings: 8, seed: 257, streak: 0.45 }), mat: { ...WOOD, roughness: 0.48, clearcoat: 0.3 } },
    white: { tex: W({ light: 0xf7f3ea, dark: 0xd9cfbd, rings: 4, seed: 263, streak: 0.35 }), mat: { bumpScale: 0.25, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.2 } },
    black: { tex: W({ light: 0x4a3828, dark: 0x140d07, rings: 7, seed: 269, streak: 0.45 }), mat: { bumpScale: 0.3, roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.2 } },
    table: CLASSIC_TABLE,
    line: 0xf4efe4, metal: { color: 0xcfd3d8, roughness: 0.3 }, leaf: 0xe9d9b0,
  },
  {
    id: 'cherry', name: 'Cherry & pear', kind: 'Wood', sub: 'Rosy pearwood field, cherry frame, walnut and sycamore points',
    frame: { tex: W({ light: 0xa4542c, dark: 0x4a1d0b, rings: 9, seed: 271, streak: 0.42, figure: 0.2 }), mat: { ...WOOD, roughness: 0.32, clearcoat: 0.8 } },
    field: { tex: W({ light: 0xeac6a6, dark: 0xb9876a, rings: 10, seed: 277, streak: 0.35, figure: 0.15, warp: 0.9 }), mat: { ...WOOD, bumpScale: 0.4, roughness: 0.38, clearcoat: 0.65 } },
    pa: { tex: W({ light: 0x4c2e1c, dark: 0x1a0c05, rings: 8, seed: 281, streak: 0.5 }), mat: { ...WOOD, roughness: 0.38 } },
    pb: { tex: W({ light: 0xf5eddb, dark: 0xd6c6a6, rings: 6, seed: 283, streak: 0.35 }), mat: { ...WOOD, roughness: 0.38 } },
    white: IVORY,
    black: { tex: W({ light: 0x5e2414, dark: 0x1c0704, rings: 5, seed: 293, streak: 0.4 }), mat: { bumpScale: 0.25, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.1 } },
    table: CLASSIC_TABLE,
    line: 0xf5e7cf, metal: { color: 0xc89b4a, roughness: 0.28 }, leaf: 0xf0d090,
  },
  {
    id: 'teak', name: 'Teak & rosewood', kind: 'Wood', sub: 'Oiled golden teak field, rosewood frame, rosewood and holly points',
    frame: { tex: W({ light: 0x6a2e28, dark: 0x1e0807, rings: 10, seed: 307, streak: 0.45, figure: 0.3 }), mat: { ...WOOD, roughness: 0.3, clearcoat: 0.85 } },
    field: { tex: W({ light: 0xcf9a55, dark: 0x7a4c22, rings: 11, seed: 311, streak: 0.55, figure: 0.15, warp: 0.6 }), mat: { ...WOOD, bumpScale: 0.55, roughness: 0.55, clearcoat: 0.25 } },
    pa: { tex: W({ light: 0x5a2620, dark: 0x1a0605, rings: 8, seed: 313, streak: 0.45 }), mat: { ...WOOD, roughness: 0.4 } },
    pb: { tex: W({ light: 0xf6efdc, dark: 0xdcceac, rings: 5, seed: 317, streak: 0.3 }), mat: { ...WOOD, roughness: 0.4 } },
    white: { tex: W({ light: 0xf6e8c2, dark: 0xd8bf88, rings: 4, seed: 331, streak: 0.3 }), mat: { bumpScale: 0.2, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.15 } },
    black: { tex: W({ light: 0x5a2620, dark: 0x180605, rings: 6, seed: 337, streak: 0.4 }), mat: { bumpScale: 0.25, roughness: 0.3, clearcoat: 0.85, clearcoatRoughness: 0.1 } },
    table: CLASSIC_TABLE,
    line: 0xf3e2b8, metal: { color: 0xb08a48, roughness: 0.32 }, leaf: 0xe9c27a,
  },
  {
    id: 'carrara', name: 'Carrara marble', kind: 'Marble', sub: 'White Carrara field, Nero Marquina frame, black and Verde Alpi points',
    frame: { tex: NERO(107), mat: POLISH },
    field: { tex: M({ base: 0xebe9e4, base2: 0xd4d3d0, vein: 0x80838b, seed: 109, dir: [2, 1], turb: 1.7, sharp: 7, amt: 0.55, amt2: 0.3 }), mat: { ...POLISH, roughness: 0.16 } },
    pa: { tex: NERO(113), mat: POLISH },
    pb: { tex: M({ base: 0x0f3326, base2: 0x1e4c39, vein: 0xbcd8c6, seed: 127, dir: [1, 2], turb: 1.5, sharp: 9, amt: 0.5, amt2: 0.3 }), mat: POLISH },
    white: { tex: M({ base: 0xf5f3ee, base2: 0xe3e1dc, vein: 0x9a9aa0, seed: 131, sharp: 9, amt: 0.35, amt2: 0.2 }), mat: { ...POLISH, roughness: 0.15 } },
    black: { tex: NERO(137), mat: POLISH },
    table: { tex: M({ base: 0x1e2124, base2: 0x2b2e32, vein: 0x3c4045, seed: 139, sharp: 3, amt: 0.3, amt2: 0.15, speck: 0.08 }), mat: { roughness: 0.75, clearcoat: 0, bumpScale: 0.4 } },
    line: 0xd4af37, metal: { color: 0xd9b45a, roughness: 0.18 }, leaf: 0xe6c46e,
  },
  {
    id: 'verde', name: 'Verde Guatemala marble', kind: 'Marble', sub: 'Green marble field, Crema Marfil frame, Rosso Levanto and cream points',
    frame: { tex: M({ base: 0xe7d9bd, base2: 0xd6c4a0, vein: 0xae9264, seed: 149, dir: [3, 1], turb: 1.3, sharp: 5, amt: 0.35, amt2: 0.25 }), mat: { ...POLISH, roughness: 0.16 } },
    field: { tex: M({ base: 0x0e2a1f, base2: 0x1c4434, vein: 0xdde8dd, seed: 151, dir: [2, 1], turb: 1.8, sharp: 9, amt: 0.6, amt2: 0.35 }), mat: POLISH },
    pa: { tex: M({ base: 0x6b1a17, base2: 0x8c2b22, vein: 0xe6d8c8, seed: 157, dir: [1, 2], turb: 1.5, sharp: 8, amt: 0.55, amt2: 0.3 }), mat: POLISH },
    pb: { tex: M({ base: 0xf1e5cb, base2: 0xe2d1ad, vein: 0xbd9f72, seed: 163, sharp: 6, amt: 0.3, amt2: 0.2 }), mat: POLISH },
    white: { tex: M({ base: 0xf6efe0, base2: 0xe9dcc2, vein: 0xbfa77d, seed: 167, sharp: 8, amt: 0.3, amt2: 0.15 }), mat: { ...POLISH, roughness: 0.15 } },
    black: { tex: NERO(173), mat: POLISH },
    table: CLASSIC_TABLE,
    line: 0xc9a24a, metal: { color: 0xc89b4a, roughness: 0.25 }, leaf: 0x8a6a2a,
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
export const SURFACES = ['frame', 'field', 'pa', 'pb', 'white', 'black', 'table'];
export const SURFACE_SIZE = { frame: 1024, field: 1024, pa: 512, pb: 512, white: 256, black: 256, table: 1024 };

export function makeSurface(spec, size) {
  return spec.kind === 'marble' ? marbleTextures({ ...spec, size }) : woodTextures({ ...spec, size });
}
