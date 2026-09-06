// Paket B (client-portal redesign, `projects.billing_model` /
// 20261105010000_project_billing_model.sql): the portal's `/hours` route
// must 404 for a fixed_price project, whoever hits it directly (bookmark,
// stale link, typed URL) -- the sidebar already omits the nav item, but
// that alone is not a real access boundary. Same real-signed-in-session +
// mocked next/navigation technique as
// tests/integration/f003b-relocate-portal-routes.test.ts (see that
// file's own header comment for why).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    notFound: () => notFoundMock(),
    usePathname: () => "",
    useRouter: () => ({
      refresh: () => {},
      push: () => {},
      replace: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
  };
});

let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

describe.skipIf(!haveCreds)(
  "Portal /hours route guard by billing_model (Paket B)",
  () => {
    let admin: SupabaseClient;
    let clientSession: SupabaseClient;

    let workspaceId: string;
    let workspaceSlug: string;
    let hourlyProjectId: string;
    let fixedPriceProjectId: string;
    let ownerId: string;
    let clientId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      workspaceSlug = `paket-b-hours-guard-${suffix}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `paket-b-hours-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const clientUser = await makeUser("client");
      ownerId = owner.id;
      clientId = clientUser.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "Paket B hours guard test", slug: workspaceSlug })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      ]);

      const insertProject = async (name: string, billingModel: "hourly" | "fixed_price") => {
        const { data, error } = await admin
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name,
            visibility: "workspace",
            created_by: ownerId,
            portal_enabled: true,
            billing_model: billingModel,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
        return data.id as string;
      };

      hourlyProjectId = await insertProject("Paket B hourly project", "hourly");
      fixedPriceProjectId = await insertProject("Paket B fixed-price project", "fixed_price");

      await admin.from("project_members").insert([
        { project_id: hourlyProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
        { project_id: fixedPriceProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      ]);

      const signIn = async (email: string) => {
        const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign in ${email}: ${error.message}`);
        return session;
      };
      clientSession = await signIn(clientUser.email);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("projects").delete().in("id", [hourlyProjectId, fixedPriceProjectId]);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    beforeEach(() => {
      notFoundMock.mockClear();
    });

    it("test_hours_guard_404s_for_a_fixed_price_project", async () => {
      activeSession = clientSession;
      const { default: PortalHoursPage } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page"
      );

      await expect(
        PortalHoursPage({
          params: Promise.resolve({ workspaceSlug, projectId: fixedPriceProjectId }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
      expect(notFoundMock).toHaveBeenCalled();
    });

    it("test_hours_guard_renders_for_an_hourly_project", async () => {
      activeSession = clientSession;
      const { default: PortalHoursPage } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page"
      );

      const element = await PortalHoursPage({
        params: Promise.resolve({ workspaceSlug, projectId: hourlyProjectId }),
      });
      expect(notFoundMock).not.toHaveBeenCalled();
      expect(element).toBeTruthy();
    });
  },
);
