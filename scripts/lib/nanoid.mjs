// Central config for page nanoids.
//
// nanoid docs / source: https://github.com/ai/nanoid
// The default nanoid alphabet is URL-friendly: A-Za-z0-9_- (64 symbols).
// At size 6 that is 64^6 ≈ 6.87e10 combinations. For the few thousand pages
// in this repo the collision odds are negligible, and the generator in
// scripts/generate-nanoids.mjs additionally dedupes against every id already
// in use, so a fresh id is never a repeat.
//
// Change NANOID_SIZE here to update the id length repo-wide.
import { nanoid } from "nanoid";

export const NANOID_SIZE = 6;

export function newNanoid() {
	return nanoid(NANOID_SIZE);
}
