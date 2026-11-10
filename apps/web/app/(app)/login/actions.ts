"use server";
import { login } from "@proofofclaim/desk";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, callerNetwork, safeNext } from "@/lib/server/auth.ts";
import { pool } from "@/lib/server/data.ts";

export async function logIn(_prev: { error: string | null }, form: FormData): Promise<{ error: string | null }> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  if (!email || !password || email.length > 200 || password.length > 200) return { error: "Enter your email and password." };
  const r = await login(pool(), { email, password, network: await callerNetwork() });
  if (!r.ok) return { error: r.error };
  const https = (await headers()).get("x-forwarded-proto") === "https" || process.env["NODE_ENV"] === "production";
  (await cookies()).set(ADMIN_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: https, path: "/", expires: r.expiresAt });
  redirect(safeNext(String(form.get("next") ?? "")));
}
