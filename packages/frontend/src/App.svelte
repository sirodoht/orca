<script lang="ts">
  import { onMount } from "svelte";
  import {
    clearToken,
    commentOnMarket,
    confirmEmail,
    createMarket,
    deleteMarket,
    getMarket,
    getToken,
    leaderboard,
    listMarkets,
    login,
    me,
    previewTrade,
    profile,
    resetBalance,
    requestVerification,
    resolveMarket,
    setToken,
    signup,
    tradeMarket,
    updateMarket,
    verifyDev,
    type AuthUser,
    type Comment,
    type Market,
    type Preview,
    type Trade,
  } from "./api";

  type Page = "home" | "login" | "signup" | "create" | "market" | "leaderboard" | "profile" | "verify-email";

  const categories = ["politics", "tech", "climate", "community"];

  let page: Page = "home";
  let user: AuthUser | null = null;
  let markets: Market[] = [];
  let selectedMarket: Market | null = null;
  let selectedTrades: Trade[] = [];
  let selectedComments: Comment[] = [];
  let leaders: any[] = [];
  let profileData: any = null;
  let loading = false;
  let error = "";
  let notice = "";
  let verificationToken = "";
  let verificationBusy = false;
  let emailConfirmed = false;

  let email = "";
  let username = "";
  let password = "";

  let sort = "active";
  let category = "";
  let leaderboardTab = "balance";
  let darkMode = false;
  let searchDialog: HTMLDialogElement;
  let searchQuery = "";
  let searchMarkets: Market[] = [];
  let searchLoading = false;
  let searchError = "";
  $: searchResults = searchMarkets.filter((market) =>
    `${market.question} ${market.category}`.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  function toggleTheme() {
    darkMode = !darkMode;
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    localStorage.setItem("orca_theme", darkMode ? "dark" : "light");
  }

  async function openSearch() {
    searchQuery = "";
    searchError = "";
    searchLoading = true;
    if (!searchDialog.open) searchDialog.showModal();
    try {
      searchMarkets = (await listMarkets()).markets;
    } catch (err) {
      searchError = err instanceof Error ? err.message : "Could not search markets";
    } finally {
      searchLoading = false;
    }
  }

  function handleShortcut(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (searchDialog.open) searchDialog.close();
      else void openSearch();
    }
  }

  let marketForm = {
    question: "",
    category: "politics",
    closeAt: "",
    resolutionCriteria: "",
    sourceOfTruth: "",
    fallbackRule: "",
  };
  let editMode = false;
  let editForm = { ...marketForm };

  let tradeForm = {
    action: "buy" as "buy" | "sell",
    side: "yes" as "yes" | "no",
    amount: 100,
  };
  let commentBody = "";
  let tradePreview: Preview | null = null;

  function formatCredits(value: number | string | undefined) {
    return Number(value ?? 0).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }

  function formatDate(value: string) {
    return new Date(value).toLocaleString();
  }

  function toDateTimeLocal(value: string) {
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function statusLabel(market: Market) {
    if (market.status === "resolved_yes") return "Resolved Yes";
    if (market.status === "resolved_no") return "Resolved No";
    if (market.status === "expired") return "Expired / refunded";
    return new Date(market.close_at).getTime() <= Date.now() ? "Closed" : "Open";
  }

  function routeFromPath() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "login") return { page: "login" as Page };
    if (parts[0] === "signup") return { page: "signup" as Page };
    if (parts[0] === "verify-email") return { page: "verify-email" as Page };
    if (parts[0] === "create") return { page: "create" as Page };
    if (parts[0] === "leaderboard") return { page: "leaderboard" as Page };
    if (parts[0] === "markets" && parts[1]) {
      return { page: "market" as Page, id: Number(parts[1]) };
    }
    if (parts[0] === "users" && parts[1]) {
      return { page: "profile" as Page, username: parts[1] };
    }
    return { page: "home" as Page };
  }

  async function navigate(nextPage: Page, path = "/") {
    history.pushState(null, "", path);
    window.scrollTo(0, 0);
    await loadRoute();
  }

  async function loadRoute() {
    error = "";
    notice = "";
    const route = routeFromPath();
    page = route.page;

    if (page === "verify-email" && location.hash) {
      verificationToken = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
      history.replaceState(null, "", location.pathname);
    }

    if (page === "home") await loadMarkets();
    if (page === "leaderboard") await loadLeaderboard();
    if (page === "market" && "id" in route && route.id) await loadMarket(route.id);
    if (page === "profile" && "username" in route && route.username) {
      await loadProfile(route.username);
    }
  }

  async function loadUser() {
    if (!getToken()) return;
    try {
      const response = await me();
      user = response.user;
    } catch {
      clearToken();
      user = null;
    }
  }

  async function loadMarkets() {
    loading = true;
    try {
      markets = (await listMarkets(sort, category)).markets;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load markets";
    } finally {
      loading = false;
    }
  }

  async function loadMarket(id: number) {
    loading = true;
    try {
      const response = await getMarket(id);
      selectedMarket = response.market;
      selectedTrades = response.trades;
      selectedComments = response.comments;
      editMode = false;
      editForm = {
        question: response.market.question,
        category: response.market.category,
        closeAt: toDateTimeLocal(response.market.close_at),
        resolutionCriteria: response.market.resolution_criteria,
        sourceOfTruth: response.market.source_of_truth,
        fallbackRule: response.market.fallback_rule,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not load market";
    } finally {
      loading = false;
    }
  }

  async function loadLeaderboard() {
    leaders = (await leaderboard(leaderboardTab)).leaders;
  }

  async function loadProfile(name: string) {
    profileData = await profile(name);
  }

  async function submitAuth() {
    loading = true;
    error = "";

    try {
      const response =
        page === "signup"
          ? await signup(email, username, password)
          : await login(email, password);
      setToken(response.token);
      user = response.user;
      email = "";
      username = "";
      password = "";
      await navigate("home", "/");
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong";
    } finally {
      loading = false;
    }
  }

  async function verifyEmail() {
    try {
      user = (await verifyDev()).user;
      notice = "Email marked verified for local development.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not verify email";
    }
  }

  async function sendVerification() {
    verificationBusy = true;
    error = "";
    notice = "";
    try {
      await requestVerification();
      notice = "Check your inbox for a verification link. It expires in one hour.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not send verification email";
    } finally {
      verificationBusy = false;
    }
  }

  async function submitEmailVerification() {
    verificationBusy = true;
    error = "";
    try {
      await confirmEmail(verificationToken);
      verificationToken = "";
      emailConfirmed = true;
      await loadUser();
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not verify email";
    } finally {
      verificationBusy = false;
    }
  }

  async function submitMarket() {
    loading = true;
    error = "";
    try {
      const market = (await createMarket(marketForm)).market;
      marketForm = {
        question: "",
        category: "politics",
        closeAt: "",
        resolutionCriteria: "",
        sourceOfTruth: "",
        fallbackRule: "",
      };
      await navigate("market", `/markets/${market.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not create market";
    } finally {
      loading = false;
    }
  }

  async function submitMarketEdit() {
    if (!selectedMarket) return;
    loading = true;
    error = "";
    try {
      const response = await updateMarket(selectedMarket.id, editForm);
      selectedMarket = response.market;
      editMode = false;
      await loadMarket(selectedMarket.id);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not update market";
    } finally {
      loading = false;
    }
  }

  async function removeMarket() {
    if (!selectedMarket) return;
    error = "";
    try {
      await deleteMarket(selectedMarket.id);
      await navigate("home", "/");
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not delete market";
    }
  }

  async function submitTrade() {
    if (!selectedMarket) return;
    error = "";
    try {
      await tradeMarket(selectedMarket.id, tradeForm);
      await loadUser();
      await loadMarket(selectedMarket.id);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not trade";
    }
  }

  async function loadTradePreview() {
    if (!selectedMarket) return;
    error = "";
    tradePreview = null;
    try {
      tradePreview = (await previewTrade(selectedMarket.id, tradeForm)).preview;
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not preview trade";
    }
  }

  async function submitComment() {
    if (!selectedMarket) return;
    error = "";
    try {
      await commentOnMarket(selectedMarket.id, commentBody);
      commentBody = "";
      await loadMarket(selectedMarket.id);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not comment";
    }
  }

  async function submitResolution(outcome: "yes" | "no") {
    if (!selectedMarket) return;
    error = "";
    try {
      await resolveMarket(selectedMarket.id, outcome);
      await loadUser();
      await loadMarket(selectedMarket.id);
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not resolve market";
    }
  }

  async function resetAccount() {
    error = "";
    try {
      user = (await resetBalance()).user;
      notice = "Balance and leaderboard stats reset.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Could not reset balance";
    }
  }

  function logout() {
    clearToken();
    user = null;
    navigate("login", "/login");
  }

  onMount(() => {
    darkMode = localStorage.getItem("orca_theme") === "dark";
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    void (async () => {
      await loadUser();
      await loadRoute();
    })();
    window.addEventListener("popstate", loadRoute);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("popstate", loadRoute);
      window.removeEventListener("keydown", handleShortcut);
    };
  });
</script>

<main class="shell">
  <a class="skip-link" href="#page-content">Skip to content</a>
  <nav class="topbar" aria-label="Primary">
    <a class="brand" href="/" on:click|preventDefault={() => navigate("home", "/")}>
      <span class="brand-mark" aria-hidden="true">o.</span> orca
    </a>

    <div class="nav-actions">
      <button class:current={page === "home" || page === "market"} type="button" on:click={() => navigate("home", "/")}>Markets</button>
      <button class:current={page === "leaderboard"} type="button" on:click={() => navigate("leaderboard", "/leaderboard")}>
        Leaderboard
      </button>
      <button class="search-trigger" type="button" on:click={openSearch} aria-label="Search markets">
        <span class="search-icon" aria-hidden="true"></span><span>Search</span><kbd>⌘ K</kbd>
      </button>
      {#if user}
        <button type="button" on:click={() => navigate("create", "/create")}>Create</button>
        <button type="button" on:click={() => navigate("profile", `/users/${user.username}`)}>
          @{user.username}
        </button>
        <span class="balance">{formatCredits(user.balance)} credits</span>
        <button class="secondary" type="button" on:click={logout}>Log out</button>
      {:else}
        <button type="button" on:click={() => navigate("login", "/login")}>Log in</button>
        <button class="join-button" type="button" on:click={() => navigate("signup", "/signup")}>Sign up ↗</button>
      {/if}
      <button class="theme-toggle" type="button" on:click={toggleTheme} aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"}>{darkMode ? "☀" : "☾"}</button>
    </div>
  </nav>

  {#if error}
    <p class="banner error" role="alert">{error}</p>
  {/if}
  {#if notice}
    <p class="banner notice">{notice}</p>
  {/if}
  {#if user && !user.isEmailVerified && page !== "verify-email"}
    <section class="verification">
      <strong>Email verification required</strong>
      <span>Browsing is open, but creating markets, trading, and commenting require verification.</span>
      <button type="button" disabled={verificationBusy} on:click={sendVerification}>
        {verificationBusy ? "Sending..." : "Send verification email"}
      </button>
      {#if import.meta.env.DEV}
        <button type="button" on:click={verifyEmail}>Verify in dev</button>
      {/if}
    </section>
  {/if}

  <div id="page-content" tabindex="-1">
  {#if page === "home"}
    <section class="market-list">
      <div class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span class="status-dot"></span> A community prediction market</p>
          <h1>The future is<br />an open question.</h1>
          <p class="hero-description">What do you think happens next? Explore ideas, trade your conviction, and see what the community believes.</p>
          <div class="hero-actions">
            <a class="button" href="#markets">Explore markets <span>↓</span></a>
            <button class="secondary" type="button" on:click={() => navigate(user ? "create" : "signup", user ? "/create" : "/signup")}>{user ? "Create a market" : "Make your first prediction"} <span>↗</span></button>
          </div>
          <p class="hero-note">Play-money credits. Real-world questions.</p>
        </div>
        <div class="hero-art" aria-hidden="true">
          <svg viewBox="0 0 360 310" fill="none">
            <path class="orbit" d="M30 155h300M180 15v280" stroke-dasharray="3 6" />
            <circle cx="180" cy="150" r="103" />
            <ellipse cx="180" cy="150" rx="66" ry="103" />
            <ellipse cx="180" cy="150" rx="27" ry="103" />
            <ellipse cx="180" cy="150" rx="103" ry="37" />
            <path d="M91 99c48 26 130 26 178 0M91 201c48-26 130-26 178 0M77 150h206" />
            <ellipse cx="180" cy="150" rx="151" ry="49" transform="rotate(-32 180 150)" />
            <circle class="orbit-point" cx="304" cy="78" r="6" />
            <circle class="orbit-point" cx="75" cy="232" r="4" />
            <path d="M35 57h12m-6-6v12M304 233h12m-6-6v12" />
            <path d="M142 275h76" />
          </svg>
          <span>Many perspectives. One shared future.</span>
        </div>
      </div>
      <div class="market-workspace" id="markets">
        <aside class="market-sidebar">
          <p class="sidebar-label">Explore by topic</p>
          <div class="category-nav" aria-label="Market categories">
            <button class:active={category === ""} aria-pressed={category === ""} type="button" on:click={() => { category = ""; loadMarkets(); }}>All markets <span>↗</span></button>
            {#each categories as item, index}
              <button class:active={category === item} aria-pressed={category === item} type="button" on:click={() => { category = item; loadMarkets(); }}>{item}<span>0{index + 1}</span></button>
            {/each}
          </div>
          <div class="sidebar-note">
            <span class="little-star" aria-hidden="true">✳</span>
            <h3>A little knowledge.<br />A different perspective.</h3>
            <p>Good predictions start with a question. Bring yours to the community.</p>
            <button class="text-button" type="button" on:click={() => navigate(user ? "create" : "signup", user ? "/create" : "/signup")}>Create a market <span>↗</span></button>
          </div>
        </aside>
        <div class="market-feed">
          <div class="section-head feed-head">
            <div><p class="eyebrow">The collective outlook</p><h2>{category ? category.charAt(0).toUpperCase() + category.slice(1) : "All markets"}<span class="result-count">{markets.length.toString().padStart(2, "0")}</span></h2></div>
            <label class="sort-label">Sort by<select bind:value={sort} on:change={loadMarkets}>
              <option value="active">Most active</option><option value="newest">Newest</option><option value="closing">Closing soon</option>
            </select></label>
          </div>
          <div class="market-columns" aria-hidden="true"><span>Question / market</span><span>Yes</span><span>No</span><span></span></div>
      {#if loading}
        <div class="empty-state" role="status"><p class="eyebrow">One moment</p><h3>Gathering the outlook...</h3></div>
      {:else if markets.length === 0}
        <div class="empty-state"><span class="empty-symbol" aria-hidden="true">[ ? ]</span><h3>{category ? "This topic is an open question." : "The next question could be yours."}</h3><p>{category ? "No markets in this category yet. Start the conversation with your own prediction." : "There are no markets yet. Bring a question to the community and see where conviction lands."}</p><button type="button" on:click={() => navigate(user ? "create" : "signup", user ? "/create" : "/signup")}>Create the first market ↗</button></div>
      {:else}
        <div class="markets">
          {#each markets as market}
            <a class="market-row" href={`/markets/${market.id}`} on:click|preventDefault={() => navigate("market", `/markets/${market.id}`)}>
              <div>
                <span class="pill">{market.category}</span>
                <h2>{market.question}</h2>
                <p>{statusLabel(market)} · closes {formatDate(market.close_at)} · by @{market.creator_username}</p>
              </div>
              <div class="price-box">
                <strong>{market.yesPercent}%</strong>
                <span>Yes</span>
              </div>
              <div class="price-box no">
                <strong>{market.noPercent}%</strong>
                <span>No</span>
              </div>
              <span class="market-arrow" aria-hidden="true">↗</span>
            </a>
          {/each}
        </div>
      {/if}
          <div class="feed-foot"><span>Independent opinions. Collective insight.</span><span>YES / NO</span></div>
        </div>
      </div>
      <section class="how-it-works" aria-labelledby="how-title">
        <div class="how-intro"><p class="eyebrow">From a hunch to a forecast</p><h2 id="how-title">Put your perspective<br />to the test.</h2><p>A place for curious minds to think ahead, together.</p></div>
        <div class="how-step"><span>01 / Explore</span><h3>Find your question.</h3><p>Browse markets on politics, technology, climate, and community.</p></div>
        <div class="how-step"><span>02 / Predict</span><h3>Take a position.</h3><p>Use play-money credits to trade Yes or No based on what you believe.</p></div>
        <div class="how-step"><span>03 / Learn</span><h3>See how it unfolds.</h3><p>Follow the outcome, compare perspectives, and sharpen your judgment.</p></div>
      </section>
    </section>
  {:else if page === "verify-email"}
    <section class="content-narrow">
      <div class="form-panel">
        <h1>{emailConfirmed ? "Email verified" : "Verify your email"}</h1>
        {#if emailConfirmed}
          <p>Your email is verified. You can now create markets, trade, and comment.</p>
          <button type="button" on:click={() => navigate(user ? "home" : "login", user ? "/" : "/login")}>
            {user ? "Browse markets" : "Log in"}
          </button>
        {:else if verificationToken}
          <button type="button" disabled={verificationBusy} on:click={submitEmailVerification}>
            {verificationBusy ? "Verifying..." : "Confirm email address"}
          </button>
        {:else}
          <p>Open the verification link from your email, or log in to request another.</p>
        {/if}
      </div>
    </section>
  {:else if page === "login" || page === "signup"}
    <section class="auth-layout">
      <form class="form-panel" on:submit|preventDefault={submitAuth}>
        <p class="eyebrow">{page === "signup" ? "New account" : "Welcome back"}</p>
        <h1>{page === "signup" ? "Create account" : "Log in"}</h1>
        <p class="form-description">{page === "signup" ? "A new perspective belongs here. Join the community and start exploring what comes next." : "Your next prediction is waiting. Pick up where you left off."}</p>

        {#if page === "signup"}
          <label>
            Username
            <input bind:value={username} autocomplete="username" required />
          </label>
        {/if}

        <label>
          Email
          <input bind:value={email} autocomplete="email" required type="email" />
        </label>

        <label>
          Password
          <input
            bind:value={password}
            autocomplete={page === "signup" ? "new-password" : "current-password"}
            minlength="8"
            required
            type="password"
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "Working..." : page === "signup" ? "Sign up" : "Log in"}
        </button>
        <p class="auth-switch">{page === "signup" ? "Already have an account?" : "New to Orca?"} <a href={page === "signup" ? "/login" : "/signup"} on:click|preventDefault={() => navigate(page === "signup" ? "login" : "signup", page === "signup" ? "/login" : "/signup")}>{page === "signup" ? "Log in" : "Create an account"} ↗</a></p>
      </form>
    </section>
  {:else if page === "create"}
    <section class="content-narrow">
      <form class="form-panel" on:submit|preventDefault={submitMarket}>
        <p class="eyebrow">Create market</p>
        <h1>Ask the next question.</h1>
        <p class="form-description">Make it clear, make it measurable, and give the community something to think about.</p>

        <label>
          Question
        <input bind:value={marketForm.question} placeholder="Will something happen by a specific date?" required />
        </label>
        <label>
          Category
          <select bind:value={marketForm.category}>
            {#each categories as item}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </label>
        <label>
          Close date/time
          <input bind:value={marketForm.closeAt} required type="datetime-local" />
        </label>
        <label>
          Resolution criteria
          <textarea bind:value={marketForm.resolutionCriteria} required></textarea>
        </label>
        <label>
          Source of truth
          <input bind:value={marketForm.sourceOfTruth} required />
        </label>
        <label>
          Fallback source or rule
          <textarea bind:value={marketForm.fallbackRule} required></textarea>
        </label>
        <button type="submit" disabled={loading}>Create market</button>
      </form>
    </section>
  {:else if page === "market" && selectedMarket}
    <section class="market-detail">
      <div class="question-panel">
        <span class="pill">{selectedMarket.category}</span>
        <h1>{selectedMarket.question}</h1>
        <p>
          {statusLabel(selectedMarket)} · closes {formatDate(selectedMarket.close_at)} · created by
          <a href={`/users/${selectedMarket.creator_username}`} on:click|preventDefault={() => navigate("profile", `/users/${selectedMarket.creator_username}`)}>
            @{selectedMarket.creator_username}
          </a>
        </p>
        <p>
          Creator stats: {selectedMarket.creator_markets_created} created ·
          {selectedMarket.creator_markets_resolved} resolved ·
          {selectedMarket.creator_markets_expired} expired unresolved
        </p>
        <div class="probabilities">
          <div><strong>{selectedMarket.yesPercent}%</strong><span>Yes</span></div>
          <div><strong>{selectedMarket.noPercent}%</strong><span>No</span></div>
        </div>
        {#if selectedMarket.creator_id === user?.id && selectedMarket.trade_count === 0}
          <div class="creator-actions">
            <button class="secondary" type="button" on:click={() => (editMode = !editMode)}>
              {editMode ? "Cancel edit" : "Edit market"}
            </button>
            <button class="danger" type="button" on:click={removeMarket}>Delete market</button>
          </div>
        {/if}
      </div>

      <aside class="trade-panel">
        <h2>Trade</h2>
        <div class="segmented">
          <button class:active={tradeForm.action === "buy"} type="button" on:click={() => { tradeForm.action = "buy"; tradePreview = null; }}>Buy</button>
          <button class:active={tradeForm.action === "sell"} type="button" on:click={() => { tradeForm.action = "sell"; tradePreview = null; }}>Sell</button>
        </div>
        <div class="segmented">
          <button class:yes={tradeForm.side === "yes"} type="button" on:click={() => { tradeForm.side = "yes"; tradePreview = null; }}>Yes</button>
          <button class:no={tradeForm.side === "no"} type="button" on:click={() => { tradeForm.side = "no"; tradePreview = null; }}>No</button>
        </div>
        <label>
          {tradeForm.action === "buy" ? "Credits to spend" : "Shares to sell"}
          <input bind:value={tradeForm.amount} min="0.01" on:input={() => (tradePreview = null)} step="0.01" type="number" />
        </label>
        <button class="secondary" type="button" on:click={loadTradePreview}>Preview trade</button>
        {#if tradePreview}
          <dl class="preview">
            <div><dt>Spend/receive</dt><dd>{formatCredits(tradePreview.credits)}</dd></div>
            <div><dt>Shares</dt><dd>{formatCredits(tradePreview.shares)}</dd></div>
            <div><dt>Average price</dt><dd>{Math.round(tradePreview.averagePrice * 100)}%</dd></div>
            <div><dt>New market price</dt><dd>{Math.round(tradePreview.priceAfter * 100)}%</dd></div>
            <div><dt>Price impact</dt><dd>{Math.round(tradePreview.priceImpact * 100)} pts</dd></div>
          </dl>
        {/if}
        <button type="button" on:click={submitTrade}>Submit trade</button>

        {#if selectedMarket.creator_id === user?.id && selectedMarket.status === "open" && new Date(selectedMarket.close_at).getTime() <= Date.now()}
          <div class="resolution">
            <h3>Resolve market</h3>
            <button type="button" on:click={() => submitResolution("yes")}>Resolve Yes</button>
            <button type="button" on:click={() => submitResolution("no")}>Resolve No</button>
          </div>
        {/if}
      </aside>

      <div class="info-grid">
        {#if editMode}
          <section class="edit-market">
            <form class="inline-form" on:submit|preventDefault={submitMarketEdit}>
              <h2>Edit market</h2>
              <label>
                Question
                <input bind:value={editForm.question} required />
              </label>
              <label>
                Category
                <select bind:value={editForm.category}>
                  {#each categories as item}
                    <option value={item}>{item}</option>
                  {/each}
                </select>
              </label>
              <label>
                Close date/time
                <input bind:value={editForm.closeAt} required type="datetime-local" />
              </label>
              <label>
                Resolution criteria
                <textarea bind:value={editForm.resolutionCriteria} required></textarea>
              </label>
              <label>
                Source of truth
                <input bind:value={editForm.sourceOfTruth} required />
              </label>
              <label>
                Fallback source or rule
                <textarea bind:value={editForm.fallbackRule} required></textarea>
              </label>
              <button type="submit" disabled={loading}>Save changes</button>
            </form>
          </section>
        {/if}
        <section>
          <h2>Resolution criteria</h2>
          <p>{selectedMarket.resolution_criteria}</p>
        </section>
        <section>
          <h2>Source of truth</h2>
          <p>{selectedMarket.source_of_truth}</p>
        </section>
        <section>
          <h2>Fallback rule</h2>
          <p>{selectedMarket.fallback_rule}</p>
        </section>
      </div>

      <section class="activity">
        <div>
          <h2>Recent trades</h2>
          {#each selectedTrades as trade}
            <p>
              <a href={`/users/${trade.username}`} on:click|preventDefault={() => navigate("profile", `/users/${trade.username}`)}>@{trade.username}</a>
              {trade.action} {trade.side} at {Math.round(trade.price_after * 100)}%
              for {formatCredits(trade.credits)} credits
            </p>
          {:else}
            <p class="empty">No trades yet.</p>
          {/each}
        </div>
        <div>
          <h2>Comments</h2>
          {#each selectedComments as comment}
            <article class="comment">
              <strong>@{comment.username}</strong>
              <p>{comment.body}</p>
            </article>
          {:else}
            <p class="empty">No comments yet.</p>
          {/each}
          <form class="comment-form" on:submit|preventDefault={submitComment}>
            <textarea bind:value={commentBody} placeholder="Add a comment"></textarea>
            <button type="submit">Comment</button>
          </form>
        </div>
      </section>
    </section>
  {:else if page === "leaderboard"}
    <section class="content-narrow">
      <div class="section-head">
        <div>
          <p class="eyebrow">Leaderboard</p>
          <h1>Public standing</h1>
        </div>
        <select aria-label="Rank leaderboard by" bind:value={leaderboardTab} on:change={loadLeaderboard}>
          <option value="balance">Total balance</option>
          <option value="profit">Total profit</option>
          <option value="accuracy">Prediction accuracy</option>
        </select>
      </div>
      <div class="table">
        {#each leaders as leader, index}
          <a href={`/users/${leader.username}`} on:click|preventDefault={() => navigate("profile", `/users/${leader.username}`)}>
            <span>{index + 1}</span>
            <strong>@{leader.username}</strong>
            <span>{leaderboardTab === "accuracy" ? `${Math.round(leader.accuracy * 100)}%` : `${formatCredits(leaderboardTab === "profit" ? leader.profit : leader.balance)} credits`}</span>
          </a>
        {:else}
          <div class="empty-state"><h3>A place for the thoughtful.</h3><p>The community leaderboard will appear here as people join.</p></div>
        {/each}
      </div>
    </section>
  {:else if page === "profile" && profileData}
    <section class="profile">
      <div class="question-panel">
        <p class="eyebrow">Profile</p>
        <h1>@{profileData.profile.username}</h1>
        <p>
          Balance {formatCredits(profileData.profile.balance)} · profit
          {formatCredits(profileData.profile.profit)} · accuracy
          {Math.round(profileData.profile.accuracy * 100)}%
        </p>
        <p>
          Created {profileData.profile.creatorStats.markets_created ?? 0} markets · resolved
          {profileData.profile.creatorStats.markets_resolved ?? 0} · expired unresolved
          {profileData.profile.creatorStats.markets_expired ?? 0}
        </p>
        {#if user?.username === profileData.profile.username}
          <button type="button" on:click={resetAccount}>Reset balance</button>
        {/if}
      </div>
      <div class="activity">
        <section>
          <h2>Created markets</h2>
          {#each profileData.markets as market}
            <p><a href={`/markets/${market.id}`} on:click|preventDefault={() => navigate("market", `/markets/${market.id}`)}>{market.question}</a></p>
          {/each}
        </section>
        <section>
          <h2>Trade history</h2>
          {#each profileData.trades as trade}
            <p>{trade.action} {trade.side} on {trade.question} at {Math.round(trade.price_after * 100)}%</p>
          {/each}
        </section>
        <section>
          <h2>Current positions</h2>
          {#each profileData.positions as position}
            <p>{position.question}: {formatCredits(position.yes_shares)} Yes · {formatCredits(position.no_shares)} No</p>
          {:else}
            <p class="empty">No current public positions.</p>
          {/each}
        </section>
      </div>
    </section>
  {/if}
  </div>
  <footer class="footer">
    <a class="footer-brand" href="/" on:click|preventDefault={() => navigate("home", "/")}>orca</a>
    <a href="/" on:click|preventDefault={() => navigate("home", "/")}>Markets</a>
    <a href="/leaderboard" on:click|preventDefault={() => navigate("leaderboard", "/leaderboard")}>Leaderboard</a>
    <span class="footer-note">A little curiosity goes a long way.</span>
    <span class="footer-credits">Play money. Shared knowledge.</span>
  </footer>
</main>

<dialog class="search-dialog" bind:this={searchDialog} aria-labelledby="search-title" on:click={(event) => { if (event.target === searchDialog) searchDialog.close(); }} on:keydown={(event) => { if (event.key === "Escape") searchDialog.close(); }}>
  <div class="search-dialog-inner">
    <form class="search-input-row" on:submit|preventDefault={() => { if (searchResults[0] && !searchLoading && !searchError) { searchDialog.close(); navigate("market", `/markets/${searchResults[0].id}`); } }}>
      <span class="search-icon" aria-hidden="true"></span>
      <label class="sr-only" id="search-title" for="market-search">Search markets</label>
      <input id="market-search" bind:value={searchQuery} placeholder="Search markets..." autocomplete="off" />
      <button class="search-close" type="button" on:click={() => searchDialog.close()} aria-label="Close search">✕</button>
    </form>
    <div class="search-results" aria-live="polite">
      {#if searchLoading}<p class="search-message">Searching the collective outlook...</p>
      {:else if searchError}<p class="search-message" role="alert">{searchError}</p>
      {:else}
        <p class="search-caption">{searchQuery ? `${searchResults.length} matching markets` : "Explore markets"}</p>
        {#each searchResults as market}
          <a href={`/markets/${market.id}`} on:click|preventDefault={() => { searchDialog.close(); navigate("market", `/markets/${market.id}`); }}><span><small>{market.category}</small>{market.question}</span><strong>{market.yesPercent}% <small>Yes ↗</small></strong></a>
        {:else}<p class="search-message">{searchQuery ? "No matching markets. Try a different question or topic." : "No markets yet. Every forecast starts with a question."}</p>
        {/each}
      {/if}
    </div>
    <div class="search-foot"><span><kbd>↵</kbd> Open first result</span><span><kbd>esc</kbd> to close</span></div>
  </div>
</dialog>
