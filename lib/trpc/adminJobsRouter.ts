import {
  listAdminMaterialJobsForAdmin,
  listBookJobsForAdmin,
  listMirrorJobsForAdmin,
} from "../db-admin-jobs";
import { adminProcedure, router } from "./trpc";

// Admin-only Jobs monitoring surface (Phase 0's developer-visibility
// requirement) — every query here uses adminProcedure, which rejects
// anyone whose session role isn't exactly "admin" (see lib/trpc/trpc.ts)
// before the handler body ever runs. The underlying queries
// (lib/db-admin-jobs.ts) are themselves scoped to never return S3 keys/URLs
// or full book/card text, on top of this role gate — see that file's
// header comment for the exact contract.
export const adminJobsRouter = router({
  books: adminProcedure.query(async () => listBookJobsForAdmin()),
  mirrorJobs: adminProcedure.query(async () => listMirrorJobsForAdmin()),
  adminMaterialJobs: adminProcedure.query(async () =>
    listAdminMaterialJobsForAdmin()
  ),
});
