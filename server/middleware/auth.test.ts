import { describe, it, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { requireAccessToken } from "./auth";
import { env } from "../config";

function makeApp() {
  const app = express();
  app.use("/api", requireAccessToken);
  app.get("/api/auth/check", (_req, res) => res.status(204).end());
  return app;
}

describe("access gate", () => {
  const original = env.ACCESS_TOKEN;
  afterEach(() => {
    env.ACCESS_TOKEN = original;
  });

  it("lets everything through when no token is configured", async () => {
    env.ACCESS_TOKEN = "";
    await request(makeApp()).get("/api/auth/check").expect(204);
  });

  it("rejects requests without the token", async () => {
    env.ACCESS_TOKEN = "sekrit";
    await request(makeApp()).get("/api/auth/check").expect(401);
  });

  it("rejects a wrong token", async () => {
    env.ACCESS_TOKEN = "sekrit";
    await request(makeApp()).get("/api/auth/check").set("x-access-token", "nope").expect(401);
  });

  it("accepts the right token", async () => {
    env.ACCESS_TOKEN = "sekrit";
    await request(makeApp()).get("/api/auth/check").set("x-access-token", "sekrit").expect(204);
  });

  it("rejects a same-length wrong token (timing-safe compare path)", async () => {
    env.ACCESS_TOKEN = "sekrit";
    await request(makeApp()).get("/api/auth/check").set("x-access-token", "sekrat").expect(401);
  });
});
