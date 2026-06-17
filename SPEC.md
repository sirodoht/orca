# Prediction Market Product Spec

## 1. Product Summary

A play-money prediction market for students at London College of Political Technology, Newspeak House, and the wider Newspeak community.

Users create and trade on binary prediction markets about politics, technology, climate, and community events. The product is educational, social, and reputational. It does not use real money and has no cash value.

## 2. Core Audience

Primary users:

* London College of Political Technology students
* Newspeak House residents and alumni
* Wider Newspeak community members

The product should feel lightweight, social, and intellectually serious rather than financialised or gambling-oriented.

## 3. Market Scope

Markets may cover:

* Politics
* Technology
* Climate
* Community events

Each market must belong to exactly one category.

Policy is not a separate category in v1; policy-related markets can fit under politics, tech, climate, or community.

## 4. Account Model

Users must sign up with:

* email
* username
* password

Email verification is required before a user can:

* create markets
* trade
* comment

Public visitors and unverified users can browse:

* markets
* market comments
* profiles
* leaderboards

Users may use real names or pseudonyms.

## 5. Play-Money System

Each new user receives **10,000 play-money credits** on signup.

Credits:

* have no cash value
* cannot be deposited
* cannot be withdrawn
* cannot be transferred between users
* are used only inside the app

Users may reset their balance back to 10,000 credits whenever they want, but only if they have no open positions.

When a user resets:

* their balance returns to 10,000
* their leaderboard stats reset
* their historical public trades remain visible as history, but no longer count toward leaderboard stats

## 6. Market Type

V1 supports only binary markets:

* Yes
* No

No multi-choice markets.
No scalar markets.
No partial resolution.

Possible final states:

* Resolved Yes
* Resolved No
* Expired / refunded

## 7. Market Creation

Any verified user can create a market.

Markets go live immediately after creation.

Market creation uses a structured form, not a free-text post.

Required fields:

* question
* category
* close date/time
* resolution criteria
* source of truth
* fallback source or fallback rule

Example:

> Will Labour win the next UK general election?

Category: Politics
Close date: Polls close on election day
Resolution criteria: Resolves Yes if Labour wins the most seats in the next UK general election.
Source of truth: Electoral Commission or BBC election results page.
Fallback rule: If the primary source is unavailable, use official parliamentary election results.

Markets must close:

* at least 1 hour after creation
* at most 1 year after creation

There is no limit on how many markets a user can create.

Duplicate or similar markets are allowed.

## 8. Market Editing and Deletion

Before the first trade:

* creator may edit the market
* creator may delete/cancel the market

After the first trade:

* market is locked
* question cannot change
* category cannot change
* close date cannot change
* resolution criteria cannot change
* source of truth cannot change
* creator cannot delete or cancel the market

This prevents unfair changes after users have traded.

## 9. Trading Model

V1 uses an automated market maker.

Users do not place limit orders.
Users do not trade directly with each other.
The app acts as the market counterparty.

Each market starts at:

* Yes: 50%
* No: 50%

Each market starts with **1,000 credits of virtual liquidity**.

Users trade by entering the amount of credits they want to spend.

Example:

> Buy Yes with 500 credits.

The trade preview shows:

* side: Yes or No
* spend amount
* average execution price
* resulting market price
* estimated price impact

Prices are displayed to users as percentages only.

Example:

* Yes: 63%
* No: 37%

Internally, 63% corresponds to a share price of 0.63 credits.

Recommended implementation: use a simple binary LMSR-style AMM with liquidity parameter equivalent to 1,000 credits. Product requirement is that small trades move prices slightly and large trades move prices visibly.

## 10. Positions

Users can:

* buy Yes
* buy No
* sell Yes
* sell No

Users can change their mind by selling existing shares and buying the other side.

Users cannot:

* borrow
* use leverage
* go negative
* short beyond owned shares

Users may put their entire available balance into one market.

## 11. Payout Model

Use fixed payout shares.

When a market resolves:

* winning shares pay 1 credit each
* losing shares pay 0 credits

Examples:

If a user owns 300 Yes shares:

* market resolves Yes → user receives 300 credits
* market resolves No → user receives 0 credits

Profit/loss is calculated from what the user paid for the shares.

There are no trading fees.

## 12. Market Close and Resolution

Each market has a fixed close date/time set at creation.

When the close time arrives:

* trading stops
* users can no longer buy or sell shares
* market waits for creator resolution

The creator resolves the market.

Resolution options:

* Yes
* No

There are no disputes in v1.

After market close, the creator has 7 days to resolve the market.

If the creator does not resolve within 7 days:

* market expires
* all users are refunded

## 13. Expired Markets

A market expires if the creator does not resolve it within 7 days after close.

On expiry:

* users are refunded
* no one wins or loses
* the market appears as expired
* the creator’s profile records the market as expired unresolved

## 14. Creator Trust

Because creators resolve their own markets, profiles should show creator-resolution stats.

Each profile shows:

* markets created
* markets resolved
* markets expired unresolved

This lets users judge whether a creator is reliable before trading in their markets.

## 15. Comments

Users can comment on markets.

Comments are plain discussion only.

V1 does not support:

* pinned evidence
* official updates
* threaded evidence sections
* creator announcements
* comment moderation

Only verified users can comment.

Comments are public.

## 16. Profiles

Each user has a public profile.

Profile shows:

* username
* created markets
* public trade history
* current positions where public
* resolved-market performance
* creator-resolution stats

Trade history is public by default.

Example visible trade:

> Alice bought Yes on “Will X happen?” at 62%.

## 17. Homepage

Homepage shows public markets.

Default sort:

* most active

Most active means:

* highest number of trades in the last 24 hours

Other sort tabs:

* newest
* closing soon

Users can filter by category:

* politics
* tech
* climate
* community

No text search in v1.

## 18. Leaderboards

Public leaderboard with tabs:

* total balance
* total profit
* prediction accuracy

Prediction accuracy:

* counts resolved markets where the user held a position at close
* correct if the user held the winning side
* weighted by stake size

When a user resets their balance, their leaderboard stats reset.

## 19. Moderation

V1 has no admin/moderator removal system.

No moderation for:

* markets
* comments
* users
* duplicate markets
* bad market wording

This is a deliberate v1 simplification.

Risk: spam, abuse, and bad-faith markets may appear.
Mitigation: email verification, public creator stats, and social reputation.

## 20. Notifications

No notifications in v1.

Users cannot:

* follow markets
* watch markets
* receive close reminders
* receive resolution alerts

## 21. Out of Scope for V1

Not included:

* real money
* deposits or withdrawals
* crypto integration
* order book
* limit orders
* leverage
* shorting
* private markets
* market approval queue
* disputes
* moderation tools
* partial resolution
* multi-choice markets
* scalar markets
* market search
* notifications
* avatars
* evidence/update system
* liquidity provision by users
* creator-funded liquidity

## 22. Core Pages

### Public pages

* homepage / market list
* market detail page
* user profile page
* leaderboard page
* signup page
* login page

### Authenticated pages

* create market
* trade action
* reset balance
* account settings

## 23. Market Detail Page

Market page shows:

* question
* category
* current Yes percentage
* current No percentage
* close date/time
* resolution criteria
* source of truth
* fallback rule
* creator
* creator-resolution stats
* trading form
* recent trades
* comments
* final resolution, if resolved
* expiry/refund status, if expired

## 24. Trade Flow

1. User opens market.
2. User chooses Yes or No.
3. User enters credit amount.
4. App shows preview:

   * spend
   * average price
   * price impact
   * new market price
5. User submits trade.
6. App updates:

   * user balance
   * user position
   * market price
   * trade history
   * activity count

## 25. Resolution Flow

1. Market reaches close date.
2. Trading stops.
3. Creator sees resolution controls.
4. Creator chooses Yes or No.
5. App calculates payouts.
6. Winning shares receive 1 credit each.
7. Losing shares receive 0.
8. Market becomes resolved.
9. Leaderboards update.

If no resolution after 7 days:

1. market expires
2. users are refunded
3. market appears as expired
4. creator stats record one expired unresolved market

## 26. MVP Success Criteria

The MVP succeeds if:

* users create markets without needing admin help
* users understand how to buy Yes/No
* prices move visibly after trades
* users discuss markets socially
* leaderboards create mild competition
* market resolution is simple enough to operate manually
* the product works for a small, active community without needing deep liquidity
