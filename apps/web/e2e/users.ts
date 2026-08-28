/** The three accounts the fake server seeds (apps/server/src/fakes.ts), all members of the "Demo Lab" workspace. */
export const USERS = {
  owner: { email: "owner@marrow.local", password: "marrow-owner", name: "Ada Owner" },
  member: { email: "member@marrow.local", password: "marrow-member", name: "Max Member" },
  viewer: { email: "viewer@marrow.local", password: "marrow-viewer", name: "Vic Viewer" },
} as const;
export type Role = keyof typeof USERS;
export const WORKSPACE = { name: "Demo Lab", slug: "demo-lab" };
/** Saved cookies for a seeded account (written by global-setup). */
export const storageState = (role: Role) => `e2e/.auth/${role}.json`;
