import { useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { api } from "../api";
import type { AuthResponse } from "@rome/shared";

export function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const body = isRegister
        ? { username, email, password }
        : { username, password };
      const path = isRegister ? "/auth/register" : "/auth/login";
      const res = await api<AuthResponse>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setAuth(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <h1 style={styles.title}>Rome</h1>
        <p style={styles.subtitle}>{isRegister ? "Create account" : "Sign in"}</p>

        {error && <div style={styles.error}>{error}</div>}

        <input
          style={styles.input}
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        {isRegister && (
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}

        <input
          style={styles.input}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />

        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? "..." : isRegister ? "Register" : "Login"}
        </button>

        <button
          style={styles.toggle}
          type="button"
          onClick={() => {
            setIsRegister(!isRegister);
            setError("");
          }}
        >
          {isRegister ? "Have an account? Sign in" : "Need an account? Register"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "var(--rome-bg)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "320px",
    padding: "32px",
    background: "var(--rome-surface)",
    borderRadius: "8px",
    border: "1px solid var(--rome-border)",
  },
  title: {
    fontFamily: "var(--font-family)",
    fontSize: "28px",
    fontWeight: 700,
    color: "var(--rome-red)",
    textAlign: "center",
    margin: 0,
  },
  subtitle: {
    color: "var(--rome-text-muted)",
    textAlign: "center",
    marginBottom: "8px",
  },
  input: {
    padding: "10px 12px",
    background: "#FFFFFF",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    color: "var(--rome-text)",
    outline: "none",
  },
  button: {
    padding: "10px",
    background: "var(--rome-red)",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 600,
  },
  toggle: {
    background: "none",
    border: "none",
    color: "var(--rome-text-muted)",
    cursor: "pointer",
    fontSize: "13px",
  },
  error: {
    padding: "8px",
    background: "rgba(184, 25, 23, 0.15)",
    border: "1px solid var(--rome-red)",
    borderRadius: "4px",
    color: "var(--rome-red)",
    fontSize: "13px",
  },
};
