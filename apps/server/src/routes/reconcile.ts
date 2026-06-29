import { Router, type Request, type Response } from "express";
import { applyReconcile, collectDrift } from "../services/reconcile.service.js";

const router = Router();

const RECONCILE_SECRET = process.env.RECONCILE_SECRET ?? "";

function authorize(req: Request): boolean {
  if (!RECONCILE_SECRET) return false;
  const header = req.header("x-reconcile-secret");
  return Boolean(header) && header === RECONCILE_SECRET;
}

router.get("/drift", async (_req: Request, res: Response) => {
  try {
    const drift = await collectDrift();
    res.json(drift);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  if (!authorize(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    const drift = await collectDrift();
    const result = await applyReconcile(drift);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;