import { getAdminMonitor } from "../db-admin-monitor";
import { adminProcedure, router } from "./trpc";

// 📊 The admin's monitoring page (app/admin/monitor). adminProcedure refuses
// anyone whose session role is not exactly "admin" before the handler runs;
// what it returns is numbers and short reasons only (lib/db-admin-monitor.ts
// says exactly what leaves that module).
export const adminMonitorRouter = router({
  overview: adminProcedure.query(() => getAdminMonitor()),
});
