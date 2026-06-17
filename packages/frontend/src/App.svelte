<script lang="ts">
  import {
    clearToken,
    getToken,
    login,
    me,
    setToken,
    signup,
    type AuthUser,
  } from "./api";

  type Page = "home" | "login" | "signup";

  let page: Page = pageFromPath(location.pathname);
  let user: AuthUser | null = null;
  let email = "";
  let password = "";
  let loading = false;
  let error = "";

  function pageFromPath(path: string): Page {
    if (path === "/login") return "login";
    if (path === "/signup") return "signup";
    return "home";
  }

  function navigate(nextPage: Page) {
    page = nextPage;
    error = "";
    password = "";
    const path = nextPage === "home" ? "/" : `/${nextPage}`;
    history.pushState(null, "", path);
  }

  async function loadUser() {
    const token = getToken();
    if (!token) return;

    try {
      const response = await me(token);
      user = response.user;
    } catch {
      clearToken();
      user = null;
    }
  }

  async function submitAuth() {
    loading = true;
    error = "";

    try {
      const response =
        page === "signup"
          ? await signup(email, password)
          : await login(email, password);
      setToken(response.token);
      user = response.user;
      navigate("home");
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong";
    } finally {
      loading = false;
    }
  }

  function logout() {
    clearToken();
    user = null;
    navigate("login");
  }

  window.addEventListener("popstate", () => {
    page = pageFromPath(location.pathname);
  });

  loadUser();
</script>

<main class="shell">
  <nav class="topbar" aria-label="Primary">
    <a class="brand" href="/" on:click|preventDefault={() => navigate("home")}>
      Vidya Predictions
    </a>

    <div class="nav-actions">
      {#if user}
        <span class="session-email">{user.email}</span>
        <button class="secondary" type="button" on:click={logout}>Log out</button>
      {:else}
        <button class:active={page === "login"} type="button" on:click={() => navigate("login")}>
          Log in
        </button>
        <button class:active={page === "signup"} type="button" on:click={() => navigate("signup")}>
          Sign up
        </button>
      {/if}
    </div>
  </nav>

  {#if page === "home"}
    <section class="home">
      <div>
        <p class="eyebrow">Prediction market</p>
        <h1>Trade beliefs on upcoming outcomes.</h1>
        <p class="lede">
          The auth foundation is ready. Create an account, store the session token,
          and use it for authenticated API calls.
        </p>
      </div>

      {#if user}
        <div class="panel">
          <p class="panel-label">Signed in</p>
          <strong>{user.email}</strong>
        </div>
      {:else}
        <div class="panel auth-panel">
          <p class="panel-label">Get started</p>
          <button type="button" on:click={() => navigate("signup")}>Create account</button>
          <button class="secondary" type="button" on:click={() => navigate("login")}>Log in</button>
        </div>
      {/if}
    </section>
  {:else}
    <section class="auth-layout">
      <form class="auth-form" on:submit|preventDefault={submitAuth}>
        <p class="eyebrow">{page === "signup" ? "New account" : "Welcome back"}</p>
        <h1>{page === "signup" ? "Create your account" : "Log in"}</h1>

        <label>
          Email
          <input
            autocomplete="email"
            bind:value={email}
            name="email"
            placeholder="you@example.com"
            required
            type="email"
          />
        </label>

        <label>
          Password
          <input
            autocomplete={page === "signup" ? "new-password" : "current-password"}
            bind:value={password}
            minlength="8"
            name="password"
            required
            type="password"
          />
        </label>

        {#if error}
          <p class="error" role="alert">{error}</p>
        {/if}

        <button type="submit" disabled={loading}>
          {loading ? "Working..." : page === "signup" ? "Sign up" : "Log in"}
        </button>

        <p class="switch">
          {#if page === "signup"}
            Already have an account?
            <button type="button" on:click={() => navigate("login")}>Log in</button>
          {:else}
            Need an account?
            <button type="button" on:click={() => navigate("signup")}>Sign up</button>
          {/if}
        </p>
      </form>
    </section>
  {/if}
</main>
