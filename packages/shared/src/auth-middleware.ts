import type { Request, Response, NextFunction } from "express";

export function requireInternalSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    // If no secret set, only allow localhost
    const ip = req.ip || req.socket.remoteAddress || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return next();
    }
    return res.status(401).json({ error: "Unauthorized" });
  }
  const provided =
    req.headers["x-internal-secret"] ||
    req.headers["authorization"]?.replace("Bearer ", "");
  if (provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
