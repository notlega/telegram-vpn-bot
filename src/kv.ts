import type { InstanceRecord } from "./env";

/** KV key prefix for instance records */
const INSTANCE_PREFIX = "inst:";

/** KV key prefix for the callback-token index */
const SECRET_PREFIX = "secret:";

/** KV key holding the ids of records still provisioning */
const PENDING_KEY = "pending";

/** KV key holding the ids of records waiting for a restart confirmation */
const REBOOTING_KEY = "rebooting";

/**
 * builds the KV key for one instance record
 *
 * @param id — linode instance id
 * @returns key in the form `inst:<id>`
 */
function instanceKey(id: string): string {
  return `${INSTANCE_PREFIX}${id}`;
}

/**
 * builds the KV key for the callback-token index
 *
 * @param secret — per-instance callback token
 * @returns key in the form `secret:<token>`
 */
function secretKey(secret: string): string {
  return `${SECRET_PREFIX}${secret}`;
}

/**
 * reads the id list stored under one index key
 *
 * @param kv — KV binding
 * @param key — index key such as `pending`
 * @returns ids in insertion order; empty when the index is missing
 */
async function readIndex(kv: KVNamespace, key: string): Promise<string[]> {
  return (await kv.get<string[]>(key, "json")) ?? [];
}

/**
 * writes an id list index, deleting the key when the list empties
 *
 * @param kv — KV binding
 * @param key — index key such as `pending`
 * @param ids — ids to store
 */
async function writeIndex(kv: KVNamespace, key: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await kv.delete(key);
    return;
  }

  await kv.put(key, JSON.stringify(ids));
}

/**
 * syncs one id-list index with the state of a record
 *
 * @param kv — KV binding
 * @param key — index key
 * @param record — record being saved
 * @param member — true when the record belongs in the index
 */
async function syncIndex(
  kv: KVNamespace,
  key: string,
  record: InstanceRecord,
  member: boolean,
): Promise<void> {
  const ids = await readIndex(kv, key);
  const next = member
    ? ids.includes(record.id)
      ? ids
      : [...ids, record.id]
    : ids.filter((id) => id !== record.id);

  if (next.length !== ids.length) {
    await writeIndex(kv, key, next);
  }
}

/**
 * persists an instance record together with its index entries
 *
 * keeps the `pending` and `rebooting` indexes in sync so cron can skip a full
 * KV list when nothing needs attention. The `secret:<token>` index exists only
 * while the record is provisioning; every later save deletes it, burning the
 * token
 *
 * @param kv — KV binding
 * @param record — record to write; overwrites any previous copy
 */
export async function saveInstance(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([
    kv.put(instanceKey(record.id), JSON.stringify(record)),
    syncIndex(kv, PENDING_KEY, record, record.state === "provisioning"),
    syncIndex(kv, REBOOTING_KEY, record, record.rebootedAt !== undefined),
    record.state === "provisioning"
      ? kv.put(secretKey(record.secret), record.id)
      : kv.delete(secretKey(record.secret)),
  ]);
}

/**
 * reads an instance record
 *
 * @param kv — KV binding
 * @param id — linode instance id
 * @returns the record, or `null` when unknown
 */
export async function getInstance(kv: KVNamespace, id: string): Promise<InstanceRecord | null> {
  return kv.get<InstanceRecord>(instanceKey(id), "json");
}

/**
 * looks up an instance by the callback token a bootstrap script presents
 *
 * @param kv — KV binding
 * @param secret — callback token, valid only while the record is provisioning
 * @returns the record, or `null` when the token is unknown or burned
 */
export async function getInstanceBySecret(
  kv: KVNamespace,
  secret: string,
): Promise<InstanceRecord | null> {
  const id = await kv.get(secretKey(secret));

  if (!id) {
    return null;
  }

  return getInstance(kv, id);
}

/**
 * removes an instance record and every index entry pointing at it
 *
 * @param kv — KV binding
 * @param record — record being destroyed
 */
export async function deleteInstanceRecord(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([
    kv.delete(instanceKey(record.id)),
    kv.delete(secretKey(record.secret)),
    syncIndex(kv, PENDING_KEY, record, false),
    syncIndex(kv, REBOOTING_KEY, record, false),
  ]);
}

/**
 * lists the ids of records still provisioning
 *
 * @param kv — KV binding
 * @returns ids for {@link reconcile}; empty when nothing is pending
 */
export async function listPendingIds(kv: KVNamespace): Promise<string[]> {
  return readIndex(kv, PENDING_KEY);
}

/**
 * lists the ids of records waiting for a restart confirmation
 *
 * @param kv — KV binding
 * @returns ids for {@link reconcile}; empty when nothing is rebooting
 */
export async function listRebootingIds(kv: KVNamespace): Promise<string[]> {
  return readIndex(kv, REBOOTING_KEY);
}

/**
 * lists every tracked instance, oldest first
 *
 * handles KV pagination internally and skips index entries that no longer have
 * a body
 *
 * @param kv — KV binding
 * @returns all instance records sorted by creation time
 */
export async function listInstanceRecords(kv: KVNamespace): Promise<InstanceRecord[]> {
  const records: InstanceRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list<InstanceRecord>({ prefix: INSTANCE_PREFIX, cursor });

    for (const key of page.keys) {
      const record = await getInstance(kv, key.name.slice(INSTANCE_PREFIX.length));

      if (record) {
        records.push(record);
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records.sort((a, b) => a.createdAt - b.createdAt);
}
