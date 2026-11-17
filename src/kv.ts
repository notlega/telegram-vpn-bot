import type { InstanceRecord } from "./env";

/** KV key prefix for instance records. */
const INSTANCE_PREFIX = "inst:";
/** KV key prefix for the callback-token index. */
const SECRET_PREFIX = "secret:";

/**
 * Builds the KV key for one instance record.
 *
 * @param id — Vultr instance id.
 * @returns key in the form `inst:<id>`.
 */
function instanceKey(id: string): string {
  return `${INSTANCE_PREFIX}${id}`;
}

/**
 * Builds the KV key for the callback-token index.
 *
 * @param secret — per-instance callback token.
 * @returns key in the form `secret:<token>`.
 */
function secretKey(secret: string): string {
  return `${SECRET_PREFIX}${secret}`;
}

/**
 * Persists an instance record together with its callback-token index entry.
 *
 * @param kv — KV binding.
 * @param record — record to write; overwrites any previous copy.
 */
export async function saveInstance(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([
    kv.put(instanceKey(record.id), JSON.stringify(record)),
    kv.put(secretKey(record.secret), record.id),
  ]);
}

/**
 * Reads an instance record.
 *
 * @param kv — KV binding.
 * @param id — Vultr instance id.
 * @returns the record, or `null` when unknown.
 */
export async function getInstance(kv: KVNamespace, id: string): Promise<InstanceRecord | null> {
  return kv.get<InstanceRecord>(instanceKey(id), "json");
}

/**
 * Looks up an instance by the callback token a bootstrap script presents.
 *
 * @param kv — KV binding.
 * @param secret — one-time callback token.
 * @returns the record, or `null` when the token is unknown.
 */
export async function getInstanceBySecret(
  kv: KVNamespace,
  secret: string,
): Promise<InstanceRecord | null> {
  const id = await kv.get(secretKey(secret));
  if (!id) return null;
  return getInstance(kv, id);
}

/**
 * Removes an instance record and its callback-token index entry.
 *
 * @param kv — KV binding.
 * @param record — record being destroyed.
 */
export async function deleteInstanceRecord(kv: KVNamespace, record: InstanceRecord): Promise<void> {
  await Promise.all([kv.delete(instanceKey(record.id)), kv.delete(secretKey(record.secret))]);
}

/**
 * Lists every tracked instance, oldest first.
 *
 * Handles KV pagination internally and skips index entries that no longer have
 * a body.
 *
 * @param kv — KV binding.
 * @returns all instance records sorted by creation time.
 */
export async function listInstanceRecords(kv: KVNamespace): Promise<InstanceRecord[]> {
  const records: InstanceRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list<InstanceRecord>({ prefix: INSTANCE_PREFIX, cursor });
    for (const key of page.keys) {
      const record = await getInstance(kv, key.name.slice(INSTANCE_PREFIX.length));
      if (record) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return records.sort((a, b) => a.createdAt - b.createdAt);
}
