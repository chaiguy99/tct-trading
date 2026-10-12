"use client";

import { signIn } from "next-auth/react";
import { FormEvent, useState } from "react";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const formData = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
        callbackUrl: "/",
      });

      if (result?.error) {
        setError("Sign-in failed. Check your details and try again.");
        return;
      }

      window.location.assign(result?.url ?? "/");
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="email">Email</label>
      <input
        autoComplete="username"
        autoCapitalize="none"
        id="email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />
      <label htmlFor="password">Password</label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        required
        type="password"
      />
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-primary login-submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}
