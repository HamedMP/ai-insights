/**
 * The signed-in owner's device routes: list their computers, rename one (and choose whether its name is public),
 * remove one. Written against injected dependencies like lib/publish.ts, so the package tests drive every path.
 * A device id is not a secret and grants nothing: every route acts only on the caller's own account, found from
 * their session, and an id from another account is simply "not on your profile".
 */
import { aggregate, deviceLabel, DEVICE_KEY, LEGACY_DEVICE, MAX_DEVICES, ordered, type DeviceRecord } from "./devices.ts"
import { ERRORS, fail, gate, isReply, readJsonObject, readLimited, type HandlerDeps, type Reply } from "./publish.ts"
import { cleanText, LIMITS } from "./share.ts"

/** A rename body is {device, name, public}: a few hundred bytes. */
export const MAX_DEVICE_BODY_BYTES = 1024

export type DeviceChange = "ok" | "not_found" | "last_device" | "no_entry"

export interface DeviceSummary {
  key: string
  label: string
  name: string
  public: boolean
  legacy: boolean
  createdAt: string
  updatedAt: string
  /** The label of the device this one duplicates exactly; it is counted once. */
  duplicateOf: string | null
  stats: { from: string; to: string; sessions: number; tokens: number; usd: number | null; activeDays: number; streak: number; cards: number; days: boolean }
}

export type DeviceListBody = { ok: true; handle: string; max: number; exactDays: boolean; devices: DeviceSummary[] } | { ok: false; error?: string }

export function summarise(devices: DeviceRecord[]): { exactDays: boolean; devices: DeviceSummary[] } {
  const list = ordered(devices)
  const total = aggregate(list)
  const labels = new Map(list.map((d, i) => [d.key, deviceLabel(d, i, "owner")]))
  return {
    exactDays: total.exactDays,
    devices: list.map((d) => {
      const dup = total.duplicates.find((x) => x.key === d.key)
      const s = d.stats
      return {
        key: d.key,
        label: labels.get(d.key)!,
        name: d.name,
        public: d.namePublic,
        legacy: d.key === LEGACY_DEVICE,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        duplicateOf: dup ? (labels.get(dup.of) ?? null) : null,
        stats: { from: s.from, to: s.to, sessions: s.sessions, tokens: s.tokens, usd: s.usd, activeDays: s.activeDays, streak: s.streak, cards: s.cards?.length ?? 0, days: Boolean(s.days) },
      }
    }),
  }
}

export interface DeviceListDeps {
  userId: string | null
  allow: (key: string) => boolean
  list: (userId: string) => Promise<{ handle: string; devices: DeviceRecord[] } | null>
  log: (message: string, error?: unknown) => void
}

/** GET: the caller's own devices, or 404 when they have not published. */
export async function handleDeviceList(deps: DeviceListDeps): Promise<{ status: number; body: DeviceListBody }> {
  if (!deps.userId) return { status: 401, body: { ok: false } }
  if (!deps.allow(`devices:${deps.userId}`)) return { status: 429, body: { ok: false } }
  try {
    const mine = await deps.list(deps.userId)
    if (!mine) return { status: 404, body: { ok: false } }
    return { status: 200, body: { ok: true, handle: mine.handle, max: MAX_DEVICES, ...summarise(mine.devices) } }
  } catch (error) {
    deps.log("device list failed", error)
    return { status: 500, body: { ok: false } }
  }
}

const changeReply = (change: DeviceChange): Reply =>
  change === "ok" ? { status: 200, body: { ok: true } } : change === "last_device" ? fail(409, ERRORS.lastDevice) : change === "no_entry" ? fail(404, ERRORS.noEntry) : fail(404, ERRORS.device)

export interface RenameDeps extends HandlerDeps {
  rename: (userId: string, key: string, name: string, namePublic: boolean) => Promise<DeviceChange>
}

/** PATCH {device, name, public}: rename one of the caller's devices and choose whether the name is public. */
export async function handleDeviceRename(deps: RenameDeps): Promise<Reply> {
  const gated = gate(deps)
  if (typeof gated !== "string") return gated
  const raw = await readJsonObject(deps, MAX_DEVICE_BODY_BYTES)
  if (isReply(raw)) return raw
  const keys = Object.keys(raw)
  if (keys.length !== 3 || !keys.includes("device") || !keys.includes("name") || !keys.includes("public")) return fail(400, ERRORS.body)
  if (typeof raw.device !== "string" || !DEVICE_KEY.test(raw.device) || typeof raw.name !== "string" || raw.name.length > LIMITS.deviceName * 8 || typeof raw.public !== "boolean") return fail(400, ERRORS.body)
  try {
    return changeReply(await deps.rename(gated, raw.device, cleanText(raw.name, LIMITS.deviceName), raw.public))
  } catch (error) {
    deps.log("device rename failed", error)
    return fail(500, ERRORS.server)
  }
}

export interface RemoveDeviceDeps extends HandlerDeps {
  /** The `device` query parameter, unvalidated. */
  device: string | null
  remove: (userId: string, key: string) => Promise<DeviceChange>
}

/** DELETE ?device=<key>: remove one of the caller's devices; the total is recomputed without it. No body. */
export async function handleDeviceRemove(deps: RemoveDeviceDeps): Promise<Reply> {
  const gated = gate(deps)
  if (typeof gated !== "string") return gated
  const text = await readLimited(deps.body, 0)
  if (text === null) return fail(413, ERRORS.size)
  if (!deps.device || !DEVICE_KEY.test(deps.device)) return fail(400, ERRORS.body)
  try {
    return changeReply(await deps.remove(gated, deps.device))
  } catch (error) {
    deps.log("device remove failed", error)
    return fail(500, ERRORS.server)
  }
}
