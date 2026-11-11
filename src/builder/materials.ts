import * as THREE from 'three';
import type { RoomType } from '../schema/house';

/** Room type drives floor finish. Flat colours for now; textures come in the polish step. */
export const ROOM_COLORS: Record<RoomType, number> = {
  living: 0xb08a5e,
  dining: 0xa9825a,
  kitchen: 0xd8d2c4,
  bedroom: 0xc19a6b,
  bathroom: 0xcfdde3,
  wc: 0xcfdde3,
  hall: 0x9c8e7c,
  study: 0xb5926a,
  utility: 0xc8c3b8,
  garage: 0x9a9a9a,
  other: 0xbdb5a8,
};

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

export function createMaterials() {
  const roomFloors = new Map<RoomType, THREE.Material>();
  for (const [type, color] of Object.entries(ROOM_COLORS)) roomFloors.set(type as RoomType, std(color));
  return {
    wall: std(0xf1ede6),
    exterior: std(0xe4dccf, { side: THREE.DoubleSide }),
    slab: std(0xf7f5f0),
    stair: std(0x8a6a48),
    rail: std(0x3b3b3b, { roughness: 0.5, metalness: 0.4 }),
    roof: std(0x8c4a3a, { side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xa9d4ea,
      transparent: true,
      opacity: 0.3,
      roughness: 0.05,
      depthWrite: false,
    }),
    ground: std(0x7da05a),
    roomFloors,
  };
}

export type Materials = ReturnType<typeof createMaterials>;
