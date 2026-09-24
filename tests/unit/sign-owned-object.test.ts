import { describe, expect, it, vi } from "vitest";
import {
  isOwnedObjectPath,
  removeOwnedObject,
  signOwnedObject,
  storageOwnerPrefix,
} from "@/lib/storage/sign-owned-object";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

function makeStorage() {
  const calls: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: vi.fn(async (path: string) => {
          calls.push(`sign:${bucket}:${path}`);
          return { data: { signedUrl: `https://signed/${path}` }, error: null };
        }),
        remove: vi.fn(async (paths: string[]) => {
          calls.push(`remove:${bucket}:${paths.join(",")}`);
          return { data: [], error: null };
        }),
      }),
    },
  };
  return { admin: admin as unknown as Parameters<typeof signOwnedObject>[0], calls };
}

describe("isOwnedObjectPath", () => {
  const prefix = storageOwnerPrefix.taskAttachment(TASK_ID);

  it("accepts a key under the owner folder", () => {
    expect(isOwnedObjectPath(`${TASK_ID}/123-report.pdf`, prefix)).toBe(true);
    expect(isOwnedObjectPath(`${TASK_ID}/nested/report..pdf`, prefix)).toBe(true);
  });

  it("rejects another owner's folder", () => {
    expect(isOwnedObjectPath(`${OTHER_TASK_ID}/report.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`${TASK_ID}0/report.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`improvements/${TASK_ID}/x.png`, prefix)).toBe(false);
  });

  it("rejects traversal, absolute, backslash and empty-segment keys", () => {
    expect(isOwnedObjectPath(`${TASK_ID}/../${OTHER_TASK_ID}/x.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`${TASK_ID}/./x.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`/${TASK_ID}/x.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`${TASK_ID}/a\\..\\x.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`${TASK_ID}//x.pdf`, prefix)).toBe(false);
    expect(isOwnedObjectPath(`${TASK_ID}/`, prefix)).toBe(false);
    expect(isOwnedObjectPath(null, prefix)).toBe(false);
  });

  it("rejects a malformed owner prefix", () => {
    expect(isOwnedObjectPath(`${TASK_ID}/x.pdf`, TASK_ID)).toBe(false);
    expect(isOwnedObjectPath("x.pdf", "/")).toBe(false);
    expect(isOwnedObjectPath("../x.pdf", "../")).toBe(false);
  });
});

describe("signOwnedObject / removeOwnedObject", () => {
  it("signs an owned object", async () => {
    const { admin, calls } = makeStorage();
    const result = await signOwnedObject(
      admin,
      {
        bucket: "task-attachments",
        path: `improvements/${PROJECT_ID}/a.png`,
        ownerPrefix: storageOwnerPrefix.improvementImage(PROJECT_ID),
      },
      60,
    );
    expect(result).toEqual({ ok: true, signedUrl: `https://signed/improvements/${PROJECT_ID}/a.png` });
    expect(calls).toEqual([`sign:task-attachments:improvements/${PROJECT_ID}/a.png`]);
  });

  it("never reaches storage for a foreign or traversal path", async () => {
    const { admin, calls } = makeStorage();
    const foreign = await signOwnedObject(
      admin,
      { bucket: "task-attachments", path: `${OTHER_TASK_ID}/secret.pdf`, ownerPrefix: `${TASK_ID}/` },
      60,
    );
    const traversal = await removeOwnedObject(admin, {
      bucket: "chat-attachments",
      path: `${TASK_ID}/../${OTHER_TASK_ID}/secret.pdf`,
      ownerPrefix: `${TASK_ID}/`,
    });
    expect(foreign).toEqual({ ok: false, reason: "not_owned" });
    expect(traversal).toEqual({ ok: false, reason: "not_owned" });
    expect(calls).toEqual([]);
  });

  it("removes an owned object", async () => {
    const { admin, calls } = makeStorage();
    const result = await removeOwnedObject(admin, {
      bucket: "scope-documents",
      path: `${PROJECT_ID}/doc.pdf`,
      ownerPrefix: storageOwnerPrefix.scopeDocument(PROJECT_ID),
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([`remove:scope-documents:${PROJECT_ID}/doc.pdf`]);
  });
});
