// F001: unit tests for the migration drift guard. All subprocess calls are
// mocked — no test in this file shells out to the live Supabase project.
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

const { findDrift, runMigrationList, checkDrift, redactSecrets, buildChildEnv } = await import(
  "../../scripts/check-migration-drift.mjs"
);

describe("findDrift (pure logic)", () => {
  it("returns no drift when every local migration has a remote counterpart", () => {
    const payload = {
      migrations: [
        { local: "20260101000000", remote: "20260101000000", time: "t1" },
        { local: "20260102000000", remote: "20260102000000", time: "t2" },
      ],
    };
    expect(findDrift(payload)).toEqual([]);
  });

  it("names the exact version that is missing on remote", () => {
    const payload = {
      migrations: [
        { local: "20260101000000", remote: "20260101000000", time: "t1" },
        { local: "20260102000000", remote: "", time: "t2" },
      ],
    };
    const drift = findDrift(payload);
    expect(drift).toHaveLength(1);
    expect(drift[0].local).toBe("20260102000000");
  });

  it("treats a missing migrations array as no drift", () => {
    expect(findDrift({})).toEqual([]);
  });
});

describe("checkDrift (end-to-end guard logic, subprocess mocked)", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("AS-001: exits 0 when the fixture is clean (no drifted migrations)", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        migrations: [
          { local: "20260101000000", remote: "20260101000000" },
          { local: "20260102000000", remote: "20260102000000" },
        ],
      }),
      stderr: "",
    });

    const result = checkDrift({ accessToken: "tok", projectRef: "ref", env: {} as NodeJS.ProcessEnv });
    expect(result.code).toBe(0);
    expect(result.isError).toBe(false);
  });

  it("AS-002: exits non-zero and names the drifted version when one migration has no remote", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        migrations: [
          { local: "20260101000000", remote: "20260101000000" },
          { local: "20260103999999", remote: "" },
        ],
      }),
      stderr: "",
    });

    const result = checkDrift({ accessToken: "tok", projectRef: "ref", env: {} as NodeJS.ProcessEnv });
    expect(result.code).not.toBe(0);
    expect(result.isError).toBe(true);
    expect(result.message).toContain("20260103999999");
  });

  it("AS-004: exits 1 with a plain message (no stack trace) when required env vars are missing", () => {
    const result = checkDrift({ accessToken: undefined, projectRef: undefined, env: {} as NodeJS.ProcessEnv });
    expect(result.code).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.message).toBe("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env");
    expect(result.message).not.toMatch(/at .*:\d+:\d+/); // not a stack trace
    // The guard must return before ever spawning the subprocess.
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it("AS-003: never includes a credential value in any output, success or failure path", () => {
    const secretToken = "sbp_super-secret-token-value";
    const secretRef = "abcdefghijklmno-project-ref";

    // Failure path: missing env still must not echo whatever partial value exists.
    const missing = checkDrift({ accessToken: undefined, projectRef: secretRef, env: {} as NodeJS.ProcessEnv });
    expect(missing.message).not.toContain(secretRef);

    // Subprocess failure path.
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "cli failed", error: undefined });
    const subprocessFailure = checkDrift({ accessToken: secretToken, projectRef: secretRef, env: {} as NodeJS.ProcessEnv });
    expect(subprocessFailure.message).not.toContain(secretToken);
    expect(subprocessFailure.message).not.toContain(secretRef);

    // Success path.
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ migrations: [{ local: "20260101000000", remote: "20260101000000" }] }),
      stderr: "",
    });
    const success = checkDrift({ accessToken: secretToken, projectRef: secretRef, env: {} as NodeJS.ProcessEnv });
    expect(success.message).not.toContain(secretToken);
    expect(success.message).not.toContain(secretRef);

    // The subprocess must be invoked with the token via env, never via argv.
    const calls = spawnSyncMock.mock.calls;
    for (const [, args] of calls) {
      expect(JSON.stringify(args)).not.toContain(secretToken);
    }
  });

  it("AS-003: redacts a credential value that the CLI itself echoes into stderr", () => {
    const secretToken = "sbp_super-secret-token-value";
    const env = { SUPABASE_ACCESS_TOKEN: secretToken } as unknown as NodeJS.ProcessEnv;

    // Plant the token INSIDE the child process's stderr, as the real
    // Supabase CLI can do when it fails (e.g. echoing a connection string).
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: `fatal: could not connect using token ${secretToken}`,
      error: undefined,
    });

    const result = checkDrift({ accessToken: secretToken, projectRef: "ref", env });
    expect(result.code).not.toBe(0);
    expect(result.message).not.toContain(secretToken);
    expect(result.message).toContain("[REDACTED]");
  });

  it("redactSecrets replaces every occurrence of a configured secret value", () => {
    const env = { SUPABASE_ACCESS_TOKEN: "sbp_abc123" } as unknown as NodeJS.ProcessEnv;
    const text = "token=sbp_abc123 and again sbp_abc123";
    const redacted = redactSecrets(text, env);
    expect(redacted).not.toContain("sbp_abc123");
    expect(redacted.split("[REDACTED]")).toHaveLength(3);
  });

  it("buildChildEnv does not hand the child the full process.env (narrows to a known allowlist)", () => {
    const env = {
      SUPABASE_ACCESS_TOKEN: "tok",
      SUPABASE_PROJECT_REF: "ref",
      SOME_UNRELATED_SECRET: "should-not-be-forwarded",
    } as unknown as NodeJS.ProcessEnv;
    const childEnv = buildChildEnv(env) as Record<string, string>;
    expect(childEnv).not.toHaveProperty("SOME_UNRELATED_SECRET");
    expect(childEnv.SUPABASE_ACCESS_TOKEN).toBe("tok");
  });

  it("reports a non-zero status and surfaces stderr when the subprocess itself fails", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "network error", error: undefined });
    const result = checkDrift({ accessToken: "tok", projectRef: "ref", env: {} as NodeJS.ProcessEnv });
    expect(result.code).not.toBe(0);
    expect(result.message).toContain("Failed to list migrations");
  });
});

describe("runMigrationList (subprocess wrapper, mocked)", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("parses a clean JSON payload from stdout", () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        migrations: [{ local: "20260101000000", remote: "20260101000000" }],
      }),
      stderr: "",
    });

    const result = runMigrationList({ env: {} as NodeJS.ProcessEnv });
    expect(result.status).toBe(0);
    expect((result.payload as { migrations: unknown[] }).migrations).toHaveLength(1);
  });

  it("never echoes the spawned command line with credential values", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: JSON.stringify({ migrations: [] }), stderr: "" });
    runMigrationList({ env: { ...process.env, SUPABASE_ACCESS_TOKEN: "sbp_secret" } });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "npx",
      ["supabase", "migration", "list", "--linked", "--output-format", "json"],
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });

  it("reports a non-zero status when JSON parsing fails", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "not json", stderr: "" });
    const result = runMigrationList({ env: {} as NodeJS.ProcessEnv });
    expect(result.status).not.toBe(0);
    expect(result.payload).toBeNull();
  });
});
