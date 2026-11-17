if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "isolated-unit-test-session-secret-at-least-32-characters";
}
